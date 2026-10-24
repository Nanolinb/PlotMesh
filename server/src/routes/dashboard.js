/**
 * server/src/routes/dashboard.js · 总控画布 + Flex Pool API（v2.0 Phase C）
 * ---------------------------------------------------------------
 * 总控画布 = 项目（同一 owner 的画布集合）的聚合俯瞰图：
 *   - 子画布运行状态色标
 *   - 跨画布引用依赖图
 *   - 堵车预警（stuck/failed 节点）
 *   - owner 宏观操作（一键提醒、批量重试）
 *
 * Flex Pool 三层人员：
 *   - 画布从简单 ownerId + sharedWith[] 升级为 flexPool: [{userId, role, joinedAt}]
 *   - role: owner / admin / editor / viewer
 *   - 兼容旧数据（自动迁移：ownerId→owner，sharedWith→editor）
 *
 * 路由清单：
 *   GET  /api/dashboard/project/:projectId?      项目总控数据
 *   GET  /api/dashboard/overview                  所有项目概览
 *   GET  /api/canvas/:id/flex-pool                读取画布 Flex Pool
 *   PATCH /api/canvas/:id/flex-pool               更新画布 Flex Pool（加人/改角色）
 *   DELETE /api/canvas/:id/flex-pool/:userId       移除成员
 *   POST /api/dashboard/broadcast                 owner 一键提醒
 *   POST /api/dashboard/batch-retry               owner 批量重试失败画布
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { readPayload, mutateStore } from '../utils/storeIO.js';
import { getDataDir } from '../utils/storePath.js';
import { requireAuth } from '../auth/middleware.js';
import { getUserById, getUserByEmail, listAllUsersWithRoles } from '../auth/usersStore.js';
import { addInboxItem } from '../auth/inboxStore.js';
import { listRuns } from '../runner/runStore.js';

const router = Router();
router.use(requireAuth);

// ─── Flex Pool 数据模型 ──────────────────────────────────────────

const FLEX_ROLES = ['owner', 'admin', 'editor', 'viewer'];

/**
 * 将旧格式 ownerId + sharedWith 迁移为 flexPool。
 * 迁移规则：ownerId → role:'owner'；sharedWith 每人 → role:'editor'。
 * 不写盘（只返回迁移后的结构），写盘在 mutateStore 里做。
 */
function migrateToFlexPool(canvas) {
  if (Array.isArray(canvas.flexPool) && canvas.flexPool.length > 0) return;
  const pool = [];
  if (canvas.ownerId) {
    pool.push({ userId: canvas.ownerId, role: 'owner', joinedAt: canvas.createdAt || Date.now() });
  }
  if (Array.isArray(canvas.sharedWith)) {
    for (const uid of canvas.sharedWith) {
      if (uid !== canvas.ownerId) {
        pool.push({ userId: uid, role: 'editor', joinedAt: Date.now() });
      }
    }
  }
  canvas.flexPool = pool;
}

/**
 * 从 flexPool 获取某用户在画布中的角色（兼容旧数据）
 */
function getRoleInCanvas(canvas, userId) {
  if (!canvas) return null;
  migrateToFlexPool(canvas);
  const entry = (canvas.flexPool || []).find((e) => e.userId === userId);
  if (entry) return entry.role;
  // 兜底：ownerId
  if (canvas.ownerId === userId) return 'owner';
  if (Array.isArray(canvas.sharedWith) && canvas.sharedWith.includes(userId)) return 'editor';
  return null;
}

/**
 * 权限检查：只有 owner/admin 可以管理 Flex Pool
 */
function canManagePool(canvas, userId) {
  const role = getRoleInCanvas(canvas, userId);
  return role === 'owner' || role === 'admin';
}

// ─── Flex Pool API ──────────────────────────────────────────────

// GET /api/canvas/:id/flex-pool → 读取画布 Flex Pool
router.get('/canvas/:id/flex-pool', async (req, res) => {
  const userId = req.user?.id;
  const p = readPayload();
  const canvas = (p.canvases || []).find((c) => c.id === req.params.id && !c.deleted);
  if (!canvas) return res.status(404).json({ error: 'canvas_not_found' });

  // 任何人只要在 pool 里就能读
  const myRole = getRoleInCanvas(canvas, userId);
  if (!myRole && (canvas.ownerId || []).length > 0) {
    // 无主画布任何人可读；有主但不在 pool → 403
    return res.status(403).json({ error: 'no_access' });
  }

  migrateToFlexPool(canvas);
  // 丰富用户信息
  const allUsers = await listAllUsersWithRoles();
  const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
  const pool = (canvas.flexPool || []).map((e) => ({
    ...e,
    name: userMap[e.userId]?.name || e.userId,
    email: userMap[e.userId]?.email || '',
    color: userMap[e.userId]?.color || '#6366f1',
  }));

  res.json({ pool, myRole });
});

// PATCH /api/canvas/:id/flex-pool → 更新画布 Flex Pool（加人/改角色）
// body: { action: 'add' | 'setRole', userId, role?, email? }
router.patch('/canvas/:id/flex-pool', async (req, res) => {
  const userId = req.user?.id;
  const { action, userId: targetUserId, role, email } = req.body || {};

  try {
    // 预解析用户（async 操作不能在 mutateStore 回调内）
    let resolvedUserId = targetUserId || null;
    if (!resolvedUserId && email) {
      const found = await getUserByEmail(email);
      if (!found) return res.status(404).json({ error: 'user_not_found' });
      resolvedUserId = found.id;
    }

    let result = null;
    mutateStore((payload) => {
      const canvas = (payload.canvases || []).find((c) => c.id === req.params.id && !c.deleted);
      if (!canvas) throw new Error('canvas_not_found');
      if (!canManagePool(canvas, userId)) throw new Error('no_permission');

      migrateToFlexPool(canvas);
      const pool = canvas.flexPool;

      if (action === 'add') {
        if (!resolvedUserId) throw new Error('missing_userId_or_email');
        const targetRole = role || 'editor';
        if (!FLEX_ROLES.includes(targetRole)) throw new Error('invalid_role');
        // 已在 pool → 改角色
        const existing = pool.find((e) => e.userId === resolvedUserId);
        if (existing) {
          existing.role = targetRole;
        } else {
          pool.push({ userId: resolvedUserId, role: targetRole, joinedAt: Date.now() });
        }
        // 同步 sharedWith（向后兼容）
        canvas.sharedWith = pool.filter((e) => e.role !== 'owner').map((e) => e.userId);
      } else if (action === 'setRole') {
        if (!targetUserId) throw new Error('missing_userId');
        if (!FLEX_ROLES.includes(role)) throw new Error('invalid_role');
        const entry = pool.find((e) => e.userId === targetUserId);
        if (!entry) throw new Error('not_in_pool');
        // 不允许降级最后一个 owner
        if (entry.role === 'owner' && role !== 'owner') {
          const ownerCount = pool.filter((e) => e.role === 'owner').length;
          if (ownerCount <= 1) throw new Error('cannot_demote_last_owner');
        }
        entry.role = role;
        canvas.sharedWith = pool.filter((e) => e.role !== 'owner').map((e) => e.userId);
      } else {
        throw new Error('invalid_action');
      }

      canvas.updatedAt = Date.now();
      result = { pool: canvas.flexPool };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.message === 'canvas_not_found' ? 404
      : e.message === 'no_permission' ? 403
      : e.message === 'user_not_found' ? 404
      : 400;
    res.status(status).json({ error: e.message });
  }
});

// DELETE /api/canvas/:id/flex-pool/:targetUserId → 移除成员
router.delete('/canvas/:id/flex-pool/:targetUserId', (req, res) => {
  const userId = req.user?.id;
  try {
    mutateStore((payload) => {
      const canvas = (payload.canvases || []).find((c) => c.id === req.params.id && !c.deleted);
      if (!canvas) throw new Error('canvas_not_found');
      if (!canManagePool(canvas, userId)) throw new Error('no_permission');

      migrateToFlexPool(canvas);
      const pool = canvas.flexPool;
      const target = pool.find((e) => e.userId === req.params.targetUserId);
      if (!target) throw new Error('not_in_pool');
      if (target.role === 'owner') throw new Error('cannot_remove_owner');

      canvas.flexPool = pool.filter((e) => e.userId !== req.params.targetUserId);
      canvas.sharedWith = canvas.flexPool.filter((e) => e.role !== 'owner').map((e) => e.userId);
      canvas.updatedAt = Date.now();
    });
    res.json({ ok: true });
  } catch (e) {
    const status = e.message === 'canvas_not_found' ? 404
      : e.message === 'no_permission' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── 总控画布 API ──────────────────────────────────────────────

/**
 * GET /api/dashboard/overview → 所有项目概览
 * "项目" = 同一 owner 的画布集合（含无主画布作为独立项目）
 */
router.get('/overview', async (req, res) => {
  const userId = req.user?.id;
  const systemAdmin = req.user?.role === 'admin';
  const p = readPayload();
  const allUsers = await listAllUsersWithRoles();
  const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
  const connections = p.connections || [];

  // 按 ownerId 分组；所有无主画布统一归入一个“待整理”组，避免一张画布铺成一个项目。
  const projects = new Map(); // ownerId / __orphan → [canvas]
  for (const c of (p.canvases || []).filter((c) => !c.deleted)) {
    const key = c.ownerId || '__orphan';
    if (!projects.has(key)) projects.set(key, []);
    projects.get(key).push(c);
  }

  const result = [];
  for (const [ownerKey, canvases] of projects) {
    // 只返回当前用户有权限看的项目（owner/admin/editor/viewer 或无主画布）
    const realOwnerId = ownerKey === '__orphan' ? null : ownerKey;
    const memberCanvases = canvases.filter((c) => {
      if (systemAdmin) return true;
      const role = getRoleInCanvas(c, userId);
      return role || !c.ownerId; // 在 pool 里 或 无主
    });
    if (memberCanvases.length === 0) continue;

    // 聚合运行状态
    const canvasStats = memberCanvases.map((c) => {
      const runs = listRuns(c.id, 5);
      const lastRun = runs[0] || null;
      const nodeCount = (c.nodes || []).length;
      // 检测堵车：failed/stuck 节点
      const stuckNodes = (c.nodes || []).filter((n) => {
        const st = n.data?.status;
        return st === 'error' || st === 'failed' || st === 'stuck';
      });

      // 跨画布依赖
      const deps = connections.filter(
        (conn) => conn.srcCanvasId === c.id || conn.dstCanvasId === c.id
      );

      return {
        id: c.id,
        name: c.name,
        nodeCount,
        lastRunStatus: lastRun?.status || null,
        lastRunAt: lastRun?.completedAt || lastRun?.requestedAt || null,
        stuckCount: stuckNodes.length,
        stuckNodes: stuckNodes.slice(0, 10).map((n) => ({
          id: n.id,
          type: n.data?.type || n.type,
          label: n.data?.label || n.id,
          status: n.data?.status,
        })),
        connectionCount: deps.length,
        updatedAt: c.updatedAt,
      };
    });

    const totalStuck = canvasStats.reduce((s, c) => s + c.stuckCount, 0);

    // 聚合项目成员（所有画布的 flexPool 并集）
    const memberSet = new Map(); // userId → { role, name, email, color }
    for (const c of memberCanvases) {
      migrateToFlexPool(c);
      for (const e of (c.flexPool || [])) {
        const existing = memberSet.get(e.userId);
        if (!existing || FLEX_ROLES.indexOf(e.role) < FLEX_ROLES.indexOf(existing.role)) {
          memberSet.set(e.userId, {
            userId: e.userId,
            role: e.role,
            name: userMap[e.userId]?.name || e.userId,
            email: userMap[e.userId]?.email || '',
            color: userMap[e.userId]?.color || '#6366f1',
          });
        }
      }
    }

    result.push({
      ownerId: realOwnerId,
      ownerName: realOwnerId ? (userMap[realOwnerId]?.name || realOwnerId) : '(无主)',
      canvasCount: memberCanvases.length,
      totalStuck,
      canvases: canvasStats,
      members: Array.from(memberSet.values()),
      connections: connections
        .filter((conn) => memberCanvases.some((c) => c.id === conn.srcCanvasId || c.id === conn.dstCanvasId))
        .map((conn) => ({
          id: conn.id,
          srcCanvasId: conn.srcCanvasId,
          srcCanvasName: (memberCanvases.find((c) => c.id === conn.srcCanvasId) || {}).name || conn.srcCanvasId,
          dstCanvasId: conn.dstCanvasId,
          dstCanvasName: (memberCanvases.find((c) => c.id === conn.dstCanvasId) || {}).name || conn.dstCanvasId,
          status: conn.status || 'active',
        })),
    });
  }

  res.json({ projects: result });
});

/**
 * GET /api/dashboard/project/:ownerId → 单个项目详细总控数据
 */
router.get('/project/:ownerId', async (req, res) => {
  const userId = req.user?.id;
  const p = readPayload();
  const allUsers = await listAllUsersWithRoles();
  const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
  const connections = p.connections || [];
  const targetOwnerId = req.params.ownerId === '__orphan' ? null : req.params.ownerId;

  const canvases = (p.canvases || []).filter(
    (c) => !c.deleted && (c.ownerId === targetOwnerId || (!c.ownerId && !targetOwnerId))
  );
  if (canvases.length === 0) return res.status(404).json({ error: 'project_not_found' });

  // 权限：至少是某个画布的成员
  const visible = canvases.filter((c) => {
    const role = getRoleInCanvas(c, userId);
    return role || !c.ownerId;
  });
  if (visible.length === 0) return res.status(403).json({ error: 'no_access' });

  // 详细数据
  const canvasDetails = visible.map((c) => {
    const runs = listRuns(c.id, 10);
    const stuckNodes = (c.nodes || []).filter((n) => {
      const st = n.data?.status;
      return st === 'error' || st === 'failed' || st === 'stuck';
    });
    const deps = connections.filter(
      (conn) => conn.srcCanvasId === c.id || conn.dstCanvasId === c.id
    );

    migrateToFlexPool(c);
    const pool = (c.flexPool || []).map((e) => ({
      ...e,
      name: userMap[e.userId]?.name || e.userId,
      email: userMap[e.userId]?.email || '',
      color: userMap[e.userId]?.color || '#6366f1',
    }));

    return {
      id: c.id,
      name: c.name,
      nodeCount: (c.nodes || []).length,
      edgeCount: (c.edges || []).length,
      lastRunStatus: runs[0]?.status || null,
      lastRunAt: runs[0]?.completedAt || runs[0]?.requestedAt || null,
      recentRuns: runs,
      stuckCount: stuckNodes.length,
      stuckNodes: stuckNodes.map((n) => ({
        id: n.id,
        type: n.data?.type || n.type,
        label: n.data?.label || n.id,
        status: n.data?.status,
      })),
      connectionCount: deps.length,
      connections: deps,
      flexPool: pool,
      updatedAt: c.updatedAt,
    };
  });

  // 依赖图
  const depGraph = connections
    .filter((conn) => visible.some((c) => c.id === conn.srcCanvasId || c.id === conn.dstCanvasId))
    .map((conn) => ({
      id: conn.id,
      src: { canvasId: conn.srcCanvasId, nodeId: conn.srcNodeId },
      dst: { canvasId: conn.dstCanvasId, nodeId: conn.dstNodeId },
      status: conn.status || 'active',
    }));

  res.json({
    ownerId: targetOwnerId,
    ownerName: targetOwnerId ? (userMap[targetOwnerId]?.name || targetOwnerId) : '(无主)',
    canvases: canvasDetails,
    depGraph,
  });
});

// ─── 宏观操作 ──────────────────────────────────────────────────

/**
 * POST /api/dashboard/broadcast → owner 一键提醒项目成员
 * body: { projectOwnerId, message, canvasId? }
 */
router.post('/broadcast', async (req, res) => {
  const userId = req.user?.id;
  const { projectOwnerId, message, canvasId } = req.body || {};
  if (!message) return res.status(400).json({ error: 'missing_message' });

  const p = readPayload();
  const targetOwnerId = projectOwnerId || null;
  const canvases = (p.canvases || []).filter(
    (c) => !c.deleted && (c.ownerId === targetOwnerId || (!c.ownerId && !targetOwnerId))
  );

  // 权限：owner/admin 才能广播
  const canBroadcast = canvases.some((c) => {
    const role = getRoleInCanvas(c, userId);
    return role === 'owner' || role === 'admin';
  });
  if (!canBroadcast) return res.status(403).json({ error: 'no_permission' });

  // 收集项目成员（排除自己）
  const memberSet = new Set();
  for (const c of canvases) {
    migrateToFlexPool(c);
    for (const e of (c.flexPool || [])) {
      if (e.userId !== userId) memberSet.add(e.userId);
    }
  }

  // 投递 inbox
  let sent = 0;
  for (const targetId of memberSet) {
    try {
      addInboxItem(targetId, {
        kind: 'mention',
        title: `📢 项目广播：${message.slice(0, 60)}`,
        body: message,
        from: { userId, name: req.user?.name || '' },
        target: canvasId ? { canvasId } : null,
        actions: canvasId ? [{ label: '查看画布', action: 'open-canvas', payload: { canvasId } }] : [],
      });
      sent++;
    } catch { /* ignore */ }
  }

  res.json({ ok: true, sent, totalMembers: memberSet.size });
});

/**
 * POST /api/dashboard/batch-retry → owner 批量重试失败画布
 * body: { canvasIds: string[] }
 */
router.post('/batch-retry', async (req, res) => {
  const userId = req.user?.id;
  const { canvasIds } = req.body || {};
  if (!Array.isArray(canvasIds) || canvasIds.length === 0) {
    return res.status(400).json({ error: 'missing_canvasIds' });
  }

  const p = readPayload();
  const results = [];

  for (const cid of canvasIds) {
    const canvas = (p.canvases || []).find((c) => c.id === cid && !c.deleted);
    if (!canvas) {
      results.push({ canvasId: cid, ok: false, error: 'not_found' });
      continue;
    }
    const role = getRoleInCanvas(canvas, userId);
    if (role !== 'owner' && role !== 'admin' && role !== 'editor') {
      results.push({ canvasId: cid, ok: false, error: 'no_permission' });
      continue;
    }
    try {
      // 触发运行（复用 runner）
      const { runCanvas } = await import('../runner/runCanvas.js');
      const job = await runCanvas(cid, { trigger: 'batch-retry', triggeredBy: userId });
      results.push({ canvasId: cid, ok: true, jobId: job.jobId });
    } catch (e) {
      results.push({ canvasId: cid, ok: false, error: e.message });
    }
  }

  res.json({ ok: true, results });
});

export default router;
