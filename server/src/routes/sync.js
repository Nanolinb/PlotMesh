/**
 * server/src/routes/sync.js · 跨浏览器同步路由（v1.5.1）
 * ---------------------------------------------------------------
 * 让同一台机器的多个浏览器共享一份画布快照。
 *
 * 路由：
 *   GET  /api/sync/meta      返回 { exists, version, updatedAt, hash, summary }
 *                            轻量探测，不传整包。前端启动时拿来比对本地 hash。
 *
 *   GET  /api/sync/snapshot  返回 { version, updatedAt, payload } 或 null（不存在）
 *                            前端冲突弹窗选"远端覆盖本地"时全量拉。
 *
 *   PUT  /api/sync/snapshot  body: { lastKnownVersion, payload, summary? }
 *                            服务端比对当前 version：
 *                              - 一致 / 文件不存在 → 原子写盘，version+1，返 200
 *                              - 不一致 → 409 + 当前 meta，让前端走冲突弹窗
 *
 * 文件格式（store.json 顶层）：
 *   {
 *     "version": 1,           # 单调递增整数，每次 PUT +1
 *     "updatedAt": <ISO>,
 *     "ownerHint": null,      # v2.0 升多用户后填实际 uid
 *     "summary": { canvasCount, nodeCount, sizeBytes },
 *     "payload": { ... }      # 由客户端定义的完整画布数据
 *   }
 *
 * 写盘策略：先写 .tmp 再 fs.rename，避免半截文件。
 *
 * 损坏处理：解析失败时把原文件备份到 store.json.broken-<ts>，再返 500，
 *           客户端按"server 没启动"逻辑降级（只用本地 IDB）。
 */
import { Router } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { requireAuth } from '../auth/middleware.js';
import { getServerConfig } from '../utils/serverConfig.js';
import {
  getStoreFilePath,
  getStoreTempPath,
  getBrokenBackupPath,
} from '../utils/storePath.js';

const router = Router();

// 联网多人模式下，同步快照包含整个共享项目数据，必须使用登录身份保护；
// 离线模式保持原有本机无登录体验。
router.use((req, res, next) => {
  if (getServerConfig().auth?.required) return requireAuth(req, res, next);
  return next();
});

/**
 * 同步读取并解析 store.json；不存在返 null；损坏抛错（调用方决定如何处理）。
 */
function readStoreSync() {
  const filePath = getStoreFilePath();
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

/**
 * 把损坏的 store.json 备份保留，返回备份路径，便于排查。
 */
function quarantineBroken() {
  const filePath = getStoreFilePath();
  if (!fs.existsSync(filePath)) return null;
  const backup = getBrokenBackupPath();
  try {
    fs.copyFileSync(filePath, backup);
  } catch {
    /* swallow */
  }
  return backup;
}

/**
 * 计算 payload 的稳定 hash（SHA-1 短摘要）。
 * 必须与 client 端 syncAdapter.computeLocalSummary 保持一致：
 *   - 剥掉所有实体的 updatedAt 字段
 *   - canvas.nodes 上剥掉 React Flow 渲染时写入的 measured/selected/dragging/resizing
 */
function stripVolatile(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const stripEntity = (x) => {
    if (!x || typeof x !== 'object') return x;
    const { updatedAt: _u, ...rest } = x;
    return rest;
  };
  const stripNodeRuntime = (n) => {
    if (!n || typeof n !== 'object') return n;
    const { measured: _m, selected: _s, dragging: _d, resizing: _r, ...rest } = n;
    return rest;
  };
  const stripCanvas = (c) => {
    const cleaned = stripEntity(c);
    if (cleaned && Array.isArray(cleaned.nodes)) {
      cleaned.nodes = cleaned.nodes.map(stripNodeRuntime);
    }
    return cleaned;
  };
  const stripArr = (arr, fn) => Array.isArray(arr) ? arr.map(fn) : arr;
  return {
    schemaVersion: payload.schemaVersion,
    workspaces: stripArr(payload.workspaces, stripEntity),
    projects: stripArr(payload.projects, stripEntity),
    canvases: stripArr(payload.canvases, stripCanvas),
    packages: stripArr(payload.packages, stripEntity),
    packageGroups: stripArr(payload.packageGroups, stripEntity),
    meta: stripArr(payload.meta, stripEntity),
  };
}

function hashPayload(payload) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(stripVolatile(payload) ?? null));
  return h.digest('hex').slice(0, 16);
}

function projectRole(project, userId) {
  if (!project || !userId) return null;
  if (project.ownerId === userId) return 'owner';
  return (project.flexPool || []).find((entry) => entry.userId === userId)?.role || null;
}

function visibleCanvasIds(payload, user) {
  const canvases = (payload.canvases || []).filter((canvas) => !canvas.deleted);
  if (!user || user.role === 'admin') return new Set(canvases.map((canvas) => canvas.id));
  const projects = payload.projects || [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const visible = new Set();
  for (const canvas of canvases) {
    const role = projectRole(projectById.get(canvas.projectId), user.id);
    if (role === 'owner' || role === 'admin'
      || canvas.ownerId === user.id
      || (canvas.sharedWith || []).includes(user.id)) {
      visible.add(canvas.id);
    }
  }
  for (const assignment of (payload.assignments || [])) {
    if (assignment.targetUserId === user.id && assignment.effectiveTargetCanvasId) {
      visible.add(assignment.effectiveTargetCanvasId);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of (payload.assignments || [])) {
      if (assignment.decisionStatus !== 'accepted' || !assignment.effectiveTargetCanvasId) continue;
      if (visible.has(assignment.sourceCanvasId) && !visible.has(assignment.effectiveTargetCanvasId)) {
        visible.add(assignment.effectiveTargetCanvasId);
        changed = true;
      }
    }
  }
  return visible;
}

function filterPayloadForUser(payload, user) {
  if (!payload || !user || user.role === 'admin') return payload;
  const visible = visibleCanvasIds(payload, user);
  const visibleCanvases = (payload.canvases || []).filter((canvas) => visible.has(canvas.id));
  const visibleProjectIds = new Set(visibleCanvases.map((canvas) => canvas.projectId).filter(Boolean));
  for (const project of (payload.projects || [])) {
    if (projectRole(project, user.id)) visibleProjectIds.add(project.id);
  }
  return {
    ...payload,
    projects: (payload.projects || []).filter((project) =>
      !Array.isArray(project.flexPool) || visibleProjectIds.has(project.id)
    ),
    canvases: visibleCanvases,
    connections: (payload.connections || []).filter((connection) =>
      visible.has(connection.srcCanvasId) && visible.has(connection.dstCanvasId)
    ),
    assignments: (payload.assignments || []).filter((assignment) =>
      assignment.requestedByUserId === user.id
      || assignment.targetUserId === user.id
      || visible.has(assignment.sourceCanvasId)
      || visible.has(assignment.effectiveTargetCanvasId)
    ),
  };
}

function summaryForPayload(payload) {
  const canvases = (payload?.canvases || []).filter((canvas) => !canvas.deleted);
  return {
    canvasCount: canvases.length,
    nodeCount: canvases.reduce((sum, canvas) => sum + (canvas.nodes || []).length, 0),
    sizeBytes: Buffer.byteLength(JSON.stringify(payload || null), 'utf8'),
  };
}

function canEditCanvas(payload, canvas, user) {
  if (!user || user.role === 'admin') return true;
  if (canvas.ownerId === user.id || (canvas.sharedWith || []).includes(user.id)) return true;
  const project = (payload.projects || []).find((item) => item.id === canvas.projectId && !item.deleted);
  const role = projectRole(project, user.id);
  return role === 'owner' || role === 'admin';
}

function canCreateCanvas(payload, canvas, user) {
  if (!user || user.role === 'admin') return true;
  const project = (payload.projects || []).find((item) => item.id === canvas.projectId && !item.deleted);
  if (!project || !Array.isArray(project.flexPool)) return true;
  const role = projectRole(project, user.id);
  return role === 'owner' || role === 'admin' || role === 'editor';
}

/**
 * 原子写盘：先写 tmp 再 rename。
 */
function writeStoreAtomic(obj) {
  const filePath = getStoreFilePath();
  const tmpPath = getStoreTempPath();
  const json = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * GET /api/sync/meta
 * 轻量元数据。前端启动时调它判断是否需要弹冲突窗。
 */
router.get('/meta', (req, res) => {
  let store;
  try {
    store = readStoreSync();
  } catch (err) {
    const backup = quarantineBroken();
    return res.status(500).json({
      error: 'store_corrupted',
      message: err.message,
      backup,
    });
  }
  if (!store) {
    return res.json({
      exists: false,
      version: 0,
      updatedAt: null,
      hash: null,
      summary: null,
    });
  }
  const visiblePayload = filterPayloadForUser(store.payload, req.user);
  return res.json({
    exists: true,
    version: store.version || 0,
    updatedAt: store.updatedAt || null,
    hash: hashPayload(visiblePayload),
    summary: summaryForPayload(visiblePayload),
  });
});

/**
 * GET /api/sync/snapshot
 * 完整快照。文件不存在返 200 + null（不返 404，避免前端 fetch 误把 404 当致命错）。
 */
router.get('/snapshot', (req, res) => {
  let store;
  try {
    store = readStoreSync();
  } catch (err) {
    const backup = quarantineBroken();
    return res.status(500).json({
      error: 'store_corrupted',
      message: err.message,
      backup,
    });
  }
  if (!store) return res.json(null);
  const visiblePayload = filterPayloadForUser(store.payload || null, req.user);
  return res.json({
    version: store.version || 0,
    updatedAt: store.updatedAt || null,
    payload: visiblePayload,
    summary: summaryForPayload(visiblePayload),
  });
});

/**
 * PUT /api/sync/snapshot
 * body: { lastKnownVersion: number, payload: any, summary?: object }
 *
 * 行为：
 *   - 文件不存在：直接写，version=1（lastKnownVersion 应为 0，但不强制）
 *   - 文件存在 且 lastKnownVersion === store.version：写盘，version+1
 *   - 文件存在 且 lastKnownVersion !== store.version：409 + 当前 meta，让前端弹冲突
 */
router.put('/snapshot', (req, res) => {
  const { lastKnownVersion, payload, summary } = req.body || {};

  if (typeof lastKnownVersion !== 'number') {
    return res.status(400).json({
      error: 'bad_request',
      message: 'lastKnownVersion (number) is required',
    });
  }
  if (payload === undefined) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'payload is required',
    });
  }

  let current;
  try {
    current = readStoreSync();
  } catch (err) {
    const backup = quarantineBroken();
    return res.status(500).json({
      error: 'store_corrupted',
      message: err.message,
      backup,
    });
  }

  const currentVersion = current?.version || 0;
  if (current && lastKnownVersion !== currentVersion) {
    return res.status(409).json({
      error: 'version_conflict',
      message: 'Server snapshot is newer than your lastKnownVersion',
      current: {
        version: currentVersion,
        updatedAt: current.updatedAt || null,
        hash: hashPayload(current.payload),
        summary: current.summary || null,
      },
    });
  }

  // v1.7 P2-A 修复：前端 SnapshotPayload 不含 connections（前端不管这块），
  // 但 server 端有自己的 connections（跨画布关联）。如果直接用前端 payload 覆盖，
  // server 的 connections 会被擦掉。这里把旧 payload 的 connections 合并进新 payload。
  //
  // v2.0 修复：projects（项目一等实体）完全由 server 端 /api/project 管理，
  // 前端 IndexedDB 根本不携带 projects。若不保护，客户端每次 sync 都会把
  // server 上的项目擦成空数组 → 表现为"项目创建后又消失/无法创建"。
  // 这里对 server 权威集合做合并保护：
  //   - projects：前端没带（undefined）就保留 server 旧的；前端明确带了才覆盖
  //   - canvases.projectId：项目归属也在 server 端设置，前端 IDB 可能是旧值，
  //     合并时以 server 端已有的 projectId 为准（前端未显式改动时不回退）
  let mergedPayload = payload;
  try {
    const cur = current && current.payload ? current.payload : null;
    const patch = {};

    // connections / assignments 是 server 权威集合。当前客户端不管理它们；即使旧客户端
    // 显式传空数组，也不能覆盖服务端状态机数据。
    if (cur && Array.isArray(cur.connections)) patch.connections = cur.connections;
    if (cur && Array.isArray(cur.assignments)) patch.assignments = cur.assignments;

    // 一等项目及其人员池由 /api/project 管理；客户端快照只能携带旧式本地 Project，
    // 不得通过同 id 对象覆盖 owner/flexPool/folders 等服务端字段。
    if (cur && Array.isArray(cur.projects)) {
      const serverProjectById = new Map(cur.projects.map((project) => [project.id, project]));
      const frontProjects = Array.isArray(payload.projects) ? payload.projects : [];
      const mergedProjects = frontProjects.map((project) => {
        const serverProject = serverProjectById.get(project?.id);
        return serverProject && Array.isArray(serverProject.flexPool) ? serverProject : project;
      });
      const frontIds = new Set(frontProjects.map((project) => project && project.id));
      const serverMissing = cur.projects.filter(
        (project) => project && Array.isArray(project.flexPool) && !frontIds.has(project.id),
      );
      patch.projects = [...mergedProjects, ...serverMissing];
    }

    // Canvas 元数据合并保护：旧客户端在保存 nodes/edges 时会重建对象，可能丢掉
    // server 管理的 owner/shared/legacy ACL/projectId；Assignment 接受后由 server 创建的
    // 下游画布也必须做 union，否则尚未拉到本地的客户端快照会把它整张擦掉。
    if (cur && Array.isArray(cur.canvases) && Array.isArray(payload.canvases)) {
      const oldById = new Map(cur.canvases.map((c) => [c.id, c]));
      const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
      const authorizedFrontCanvases = payload.canvases.map((canvas) => {
        const old = oldById.get(canvas?.id);
        if (old) return canEditCanvas(cur, old, req.user) ? canvas : old;
        if (!canCreateCanvas(cur, canvas, req.user)) return null;
        return { ...canvas, ownerId: canvas.ownerId || req.user?.id || null, sharedWith: canvas.sharedWith || [] };
      }).filter(Boolean);
      const frontIds = new Set(authorizedFrontCanvases.map((c) => c && c.id));
      const terminalAssignmentStates = new Set(['accepted', 'declined', 'completed']);
      const assignmentById = new Map((cur.assignments || []).map((assignment) => [assignment.id, assignment]));
      const isProtectedAssignmentNode = (node) => {
        const id = node?.data?.assignmentId;
        if (!id) return false;
        const assignment = assignmentById.get(id);
        return !!assignment && assignment.decisionStatus !== 'cancelled';
      };
      const mergedCanvases = authorizedFrontCanvases.map((c) => {
        const old = oldById.get(c.id);
        if (!old) return c;

        const next = {
          ...c,
          projectId: old.projectId,
          ownerId: old.ownerId || null,
          sharedWith: old.sharedWith || [],
          ...(hasOwn(old, 'flexPool') ? { flexPool: old.flexPool } : {}),
          ...(hasOwn(old, 'parentCanvasId') ? { parentCanvasId: old.parentCanvasId } : {}),
          ...(hasOwn(old, 'sourceAssignmentId') ? { sourceAssignmentId: old.sourceAssignmentId } : {}),
        };

        for (const key of ['kind', 'template', 'sourceTemplateId', 'sourceTemplateUpdatedAt']) {
          if (!hasOwn(c, key) && hasOwn(old, key)) next[key] = old[key];
        }

        // Assignment 状态与接受后生成的 target 链接由 server 状态机管理。
        // 只在同一 assignment 上保护终态/已接受态，避免旧浏览器把它回写成 pending。
        if (Array.isArray(c.nodes) && Array.isArray(old.nodes)) {
          const oldNodeById = new Map(old.nodes.map((node) => [node.id, node]));
          const frontNodeIds = new Set(c.nodes.map((node) => node && node.id));
          const mergedNodes = c.nodes.map((node) => {
            const serverNode = oldNodeById.get(node.id);
            const serverData = serverNode?.data || {};
            const frontData = node?.data || {};
            if (!serverData.assignmentId) return node;
            const shouldProtect = terminalAssignmentStates.has(serverData.assignmentStatus)
              || isProtectedAssignmentNode(serverNode)
              || !!serverData.assignmentId;
            if (!shouldProtect) return node;
            const protectedData = { ...frontData };
            for (const key of [
              'assignmentId', 'assignmentStatus', 'assigneeUserId', 'assigneeName',
              'targetCanvasId', 'targetCanvasName', 'targetNodeId',
              'sourceCanvasId', 'sourceCanvasName', 'sourceNodeId', 'sourceNodeLabel',
            ]) {
              if (hasOwn(serverData, key)) protectedData[key] = serverData[key];
            }
            return { ...node, data: protectedData };
          });
          const missingAssignmentNodes = old.nodes.filter(
            (node) => !frontNodeIds.has(node.id) && isProtectedAssignmentNode(node),
          );
          next.nodes = [...mergedNodes, ...missingAssignmentNodes];
        }
        return next;
      });
      // 客户端只收到其可见子集，因此任何未出现在本次快照中的 server 画布都必须保留。
      // 删除继续走 deleted 软标记，而不是依赖数组缺失。
      const serverMissing = cur.canvases.filter((canvas) => canvas && !frontIds.has(canvas.id));
      patch.canvases = [...mergedCanvases, ...serverMissing];
    }

    if (Object.keys(patch).length) {
      mergedPayload = { ...payload, ...patch };
    }
  } catch (error) {
    console.warn('[sync] 合并 server 权威数据失败，保留关键集合：', error.message);
    const cur = current?.payload || {};
    mergedPayload = {
      ...payload,
      ...(Array.isArray(cur.connections) ? { connections: cur.connections } : {}),
      ...(Array.isArray(cur.assignments) ? { assignments: cur.assignments } : {}),
      ...(Array.isArray(cur.projects) ? { projects: cur.projects } : {}),
      ...(Array.isArray(cur.canvases) ? { canvases: cur.canvases } : {}),
    };
  }

  const next = {
    version: currentVersion + 1,
    updatedAt: new Date().toISOString(),
    ownerHint: null, // v2.0 升级填 uid
    summary: summary || null,
    payload: mergedPayload,
  };

  try {
    writeStoreAtomic(next);
  } catch (err) {
    return res.status(500).json({
      error: 'write_failed',
      message: err.message,
    });
  }

  return res.json({
    ok: true,
    version: next.version,
    updatedAt: next.updatedAt,
    hash: hashPayload(next.payload),
  });
});

export default router;
