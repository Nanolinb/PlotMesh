/**
 * server/src/routes/project.js · 项目一等实体 CRUD（v2.0 Phase C 续）
 * ---------------------------------------------------------------
 * 项目从隐式 ownerId 聚合升级为一等实体：
 *   - 显式创建/命名/描述/主题色
 *   - Flex Pool 项目级成员
 *   - 文件夹服务端持久化（多层嵌套）
 *   - 画布归属 projectId
 *
 * 路由清单：
 *   POST   /api/project                  创建项目
 *   GET    /api/project/list             项目列表（当前用户可见的）
 *   GET    /api/project/:id              项目详情（含成员/文件夹/画布概览）
 *   PATCH  /api/project/:id              更新项目（名称/描述/颜色）
 *   DELETE /api/project/:id              删除项目（画布变未分类）
 *   PATCH  /api/project/:id/flex-pool    项目级 Flex Pool 管理
 *   DELETE /api/project/:id/flex-pool/:userId  移除项目成员
 *   PATCH  /api/project/:id/folders      文件夹 CRUD（服务端持久化）
 *   PATCH  /api/project/:id/assign-folder 画布归属文件夹
 *   POST   /api/project/:id/assign-canvas  画布归属项目
 *   POST   /api/project/migrate          迁移：ownerId 分组 → project
 */
import { Router } from 'express';
import { readPayload, mutateStore } from '../utils/storeIO.js';
import { requireAuth } from '../auth/middleware.js';
import { getUserById, getUserByEmail, listAllUsersWithRoles } from '../auth/usersStore.js';
import { addInboxItem } from '../auth/inboxStore.js';
import { listRuns } from '../runner/runStore.js';

const router = Router();
router.use(requireAuth);

const FLEX_ROLES = ['owner', 'admin', 'editor', 'viewer'];
const FOLDER_PRESET_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16'];

// ─── 工具函数 ────────────────────────────────────────────────

/** 获取用户在项目中的角色（含画布级覆盖） */
function getRoleInProject(project, userId) {
  if (!project) return null;
  const entry = (project.flexPool || []).find((e) => e.userId === userId);
  if (entry) return entry.role;
  // 兜底：ownerId
  if (project.ownerId === userId) return 'owner';
  return null;
}

/** 权限检查：owner/admin 可管理 */
function canManage(project, userId) {
  const role = getRoleInProject(project, userId);
  return role === 'owner' || role === 'admin';
}

/** 初始化空 flexPool（迁移用） */
function ensureFlexPool(project) {
  if (Array.isArray(project.flexPool) && project.flexPool.length > 0) return;
  const pool = [];
  if (project.ownerId) {
    pool.push({ userId: project.ownerId, role: 'owner', joinedAt: project.createdAt || Date.now() });
  }
  project.flexPool = pool;
}

/** 生成项目 ID */
function genProjectId() {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── 项目 CRUD ──────────────────────────────────────────────

// POST /api/project → 创建项目
router.post('/', async (req, res) => {
  const userId = req.user?.id;
  const { name, description, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });

  try {
    let project = null;
    mutateStore((payload) => {
      if (!payload.projects) payload.projects = [];
      const now = Date.now();
      project = {
        id: genProjectId(),
        name: name.trim(),
        description: (description || '').trim(),
        color: color || FOLDER_PRESET_COLORS[payload.projects.length % FOLDER_PRESET_COLORS.length],
        ownerId: userId,
        flexPool: [{ userId, role: 'owner', joinedAt: now }],
        folders: [],
        canvasFolderMap: {},
        createdAt: now,
        updatedAt: now,
      };
      payload.projects.push(project);
    });
    res.status(201).json({ ok: true, project });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/project/list → 项目列表
router.get('/list', async (req, res) => {
  const userId = req.user?.id;
  const p = readPayload();
  const projects = (p.projects || []).filter((proj) => !proj.deleted);
  const allUsers = await listAllUsersWithRoles();
  const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
  const canvases = (p.canvases || []).filter((c) => !c.deleted);

  const result = projects.map((proj) => {
    const role = getRoleInProject(proj, userId);
    // owner/admin/editor/viewer 可见；不在 pool 也返回（可能后续被邀请）
    const projectCanvases = canvases.filter((c) => c.projectId === proj.id);
    const memberCount = (proj.flexPool || []).length;

    return {
      id: proj.id,
      name: proj.name,
      description: proj.description || '',
      color: proj.color,
      ownerId: proj.ownerId,
      ownerName: userMap[proj.ownerId]?.name || proj.ownerId,
      myRole: role,
      canvasCount: projectCanvases.length,
      memberCount,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
    };
  }).filter((r) => r.myRole); // 只返回自己有权限的

  // 也返回"未分类"虚拟项目（没有 projectId 的画布）
  const unassigned = canvases.filter((c) => !c.projectId);
  if (unassigned.length > 0) {
    result.push({
      id: '__unassigned',
      name: '未分类',
      description: '',
      color: '#94a3b8',
      ownerId: null,
      ownerName: '',
      myRole: 'owner', // 自己的未分类画布
      canvasCount: unassigned.length,
      memberCount: 0,
      createdAt: null,
      updatedAt: null,
    });
  }

  res.json({ projects: result });
});

// GET /api/project/:id → 项目详情
router.get('/:id', async (req, res) => {
  const userId = req.user?.id;
  const p = readPayload();

  // 未分类虚拟项目
  if (req.params.id === '__unassigned') {
    const canvases = (p.canvases || []).filter((c) => !c.deleted && !c.projectId);
    return res.json({
      id: '__unassigned',
      name: '未分类',
      description: '',
      color: '#94a3b8',
      ownerId: null,
      flexPool: [],
      folders: [],
      canvasFolderMap: {},
      canvases: canvases.map((c) => ({
        id: c.id, name: c.name, nodeCount: (c.nodes || []).length,
        folderId: null, updatedAt: c.updatedAt,
      })),
      connections: [],
    });
  }

  const project = (p.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const role = getRoleInProject(project, userId);
  if (!role) return res.status(403).json({ error: 'no_access' });

  const allUsers = await listAllUsersWithRoles();
  const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));
  const connections = p.connections || [];
  const projectCanvases = (p.canvases || []).filter((c) => !c.deleted && c.projectId === project.id);

  // 丰富成员信息
  ensureFlexPool(project);
  const pool = (project.flexPool || []).map((e) => ({
    ...e,
    name: userMap[e.userId]?.name || e.userId,
    email: userMap[e.userId]?.email || '',
    color: userMap[e.userId]?.color || '#6366f1',
  }));

  // 画布概览（含运行状态）
  const canvasStats = projectCanvases.map((c) => {
    const runs = listRuns(c.id, 3);
    const stuckNodes = (c.nodes || []).filter((n) => {
      const st = n.data?.status;
      return st === 'error' || st === 'failed' || st === 'stuck';
    });
    const deps = connections.filter(
      (conn) => conn.srcCanvasId === c.id || conn.dstCanvasId === c.id
    );
    return {
      id: c.id,
      name: c.name,
      nodeCount: (c.nodes || []).length,
      folderId: (project.canvasFolderMap || {})[c.id] || null,
      lastRunStatus: runs[0]?.status || null,
      lastRunAt: runs[0]?.completedAt || runs[0]?.requestedAt || null,
      stuckCount: stuckNodes.length,
      connectionCount: deps.length,
      updatedAt: c.updatedAt,
    };
  });

  // 跨画布依赖
  const projectConnections = connections
    .filter((conn) => projectCanvases.some((c) => c.id === conn.srcCanvasId || c.id === conn.dstCanvasId))
    .map((conn) => ({
      id: conn.id,
      srcCanvasId: conn.srcCanvasId,
      srcCanvasName: (projectCanvases.find((c) => c.id === conn.srcCanvasId) || {}).name || conn.srcCanvasId,
      dstCanvasId: conn.dstCanvasId,
      dstCanvasName: (projectCanvases.find((c) => c.id === conn.dstCanvasId) || {}).name || conn.dstCanvasId,
      status: conn.status || 'active',
    }));

  res.json({
    id: project.id,
    name: project.name,
    description: project.description || '',
    color: project.color,
    ownerId: project.ownerId,
    ownerName: userMap[project.ownerId]?.name || project.ownerId,
    myRole: role,
    flexPool: pool,
    folders: project.folders || [],
    canvasFolderMap: project.canvasFolderMap || {},
    canvases: canvasStats,
    connections: projectConnections,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
});

// PATCH /api/project/:id → 更新项目
router.patch('/:id', (req, res) => {
  const userId = req.user?.id;
  const { name, description, color } = req.body || {};

  try {
    let result = null;
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (!canManage(project, userId)) throw new Error('no_permission');

      if (name !== undefined) project.name = name.trim();
      if (description !== undefined) project.description = description.trim();
      if (color !== undefined) project.color = color;
      project.updatedAt = Date.now();
      result = { id: project.id, name: project.name, description: project.description, color: project.color };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'no_permission' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// DELETE /api/project/:id → 删除项目（画布变未分类）
router.delete('/:id', (req, res) => {
  const userId = req.user?.id;

  try {
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (getRoleInProject(project, userId) !== 'owner') throw new Error('only_owner_can_delete');

      // 画布移出项目
      for (const c of (payload.canvases || [])) {
        if (c.projectId === project.id) {
          c.projectId = null;
        }
      }
      // 软删除
      project.deleted = true;
      project.updatedAt = Date.now();
    });
    res.json({ ok: true });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'only_owner_can_delete' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── 项目级 Flex Pool ───────────────────────────────────────

// GET /api/project/:id/flex-pool → 读取项目成员池
router.get('/:id/flex-pool', async (req, res) => {
  const userId = req.user?.id;
  const p = readPayload();

  const project = (p.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const role = getRoleInProject(project, userId);
  if (!role) return res.status(403).json({ error: 'no_access' });

  ensureFlexPool(project);
  const allUsers = await listAllUsersWithRoles();
  const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u]));

  const pool = (project.flexPool || []).map((e) => ({
    ...e,
    name: userMap[e.userId]?.name || e.userId,
    email: userMap[e.userId]?.email || '',
    color: userMap[e.userId]?.color || '#6366f1',
  }));

  res.json({ ok: true, pool, myRole: role });
});

// PATCH /api/project/:id/flex-pool → 加人/改角色
router.patch('/:id/flex-pool', async (req, res) => {
  const userId = req.user?.id;
  const { action, userId: targetUserId, role, email } = req.body || {};

  try {
    // 预解析用户
    let resolvedUserId = targetUserId || null;
    if (!resolvedUserId && email) {
      const found = await getUserByEmail(email);
      if (!found) return res.status(404).json({ error: 'user_not_found' });
      resolvedUserId = found.id;
    }

    let result = null;
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (!canManage(project, userId)) throw new Error('no_permission');

      ensureFlexPool(project);
      const pool = project.flexPool;

      if (action === 'add') {
        if (!resolvedUserId) throw new Error('missing_userId_or_email');
        const targetRole = role || 'editor';
        if (!FLEX_ROLES.includes(targetRole)) throw new Error('invalid_role');
        const existing = pool.find((e) => e.userId === resolvedUserId);
        if (existing) {
          existing.role = targetRole;
        } else {
          pool.push({ userId: resolvedUserId, role: targetRole, joinedAt: Date.now() });
        }
      } else if (action === 'setRole') {
        if (!targetUserId) throw new Error('missing_userId');
        if (!FLEX_ROLES.includes(role)) throw new Error('invalid_role');
        const entry = pool.find((e) => e.userId === targetUserId);
        if (!entry) throw new Error('not_in_pool');
        if (entry.role === 'owner' && role !== 'owner') {
          const ownerCount = pool.filter((e) => e.role === 'owner').length;
          if (ownerCount <= 1) throw new Error('cannot_demote_last_owner');
        }
        entry.role = role;
      } else {
        throw new Error('invalid_action');
      }

      project.updatedAt = Date.now();
      result = { pool };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'no_permission' ? 403
      : e.message === 'user_not_found' ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// DELETE /api/project/:id/flex-pool/:targetUserId → 移除项目成员
router.delete('/:id/flex-pool/:targetUserId', (req, res) => {
  const userId = req.user?.id;

  try {
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (!canManage(project, userId)) throw new Error('no_permission');

      ensureFlexPool(project);
      const pool = project.flexPool;
      const target = pool.find((e) => e.userId === req.params.targetUserId);
      if (!target) throw new Error('not_in_pool');
      if (target.role === 'owner') throw new Error('cannot_remove_owner');

      project.flexPool = pool.filter((e) => e.userId !== req.params.targetUserId);
      project.updatedAt = Date.now();
    });
    res.json({ ok: true });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'no_permission' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── 文件夹管理（服务端持久化） ─────────────────────────────────

// PATCH /api/project/:id/folders → 文件夹 CRUD
// body: { action: 'add'|'rename'|'setColor'|'reorder'|'delete', folderId?, name?, color?, order?, parentId? }
router.patch('/:id/folders', (req, res) => {
  const userId = req.user?.id;
  const { action, folderId, name, color, order, parentId } = req.body || {};

  try {
    let result = null;
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (!canManage(project, userId)) throw new Error('no_permission');

      if (!project.folders) project.folders = [];
      if (!project.canvasFolderMap) project.canvasFolderMap = {};
      const folders = project.folders;

      if (action === 'add') {
        const now = Date.now();
        const folder = {
          id: `folder-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: (name || '新文件夹').trim(),
          color: color || FOLDER_PRESET_COLORS[folders.length % FOLDER_PRESET_COLORS.length],
          parentId: parentId || null,  // 支持多层嵌套
          order: order ?? now,
          collapsed: false,
          createdAt: now,
          updatedAt: now,
        };
        folders.push(folder);
        result = folder;
      } else if (action === 'rename') {
        if (!folderId) throw new Error('missing_folderId');
        const f = folders.find((f) => f.id === folderId);
        if (!f) throw new Error('folder_not_found');
        f.name = (name || f.name).trim();
        f.updatedAt = Date.now();
        result = f;
      } else if (action === 'setColor') {
        if (!folderId) throw new Error('missing_folderId');
        const f = folders.find((f) => f.id === folderId);
        if (!f) throw new Error('folder_not_found');
        f.color = color || f.color;
        f.updatedAt = Date.now();
        result = f;
      } else if (action === 'reorder') {
        if (!folderId) throw new Error('missing_folderId');
        const f = folders.find((f) => f.id === folderId);
        if (!f) throw new Error('folder_not_found');
        f.order = order ?? f.order;
        f.updatedAt = Date.now();
        result = f;
      } else if (action === 'setParent') {
        if (!folderId) throw new Error('missing_folderId');
        const f = folders.find((f) => f.id === folderId);
        if (!f) throw new Error('folder_not_found');
        // 防循环：不能把自己设为自己的后代的子
        if (parentId) {
          let current = folders.find((f) => f.id === parentId);
          const visited = new Set([folderId]);
          while (current) {
            if (visited.has(current.id)) throw new Error('circular_reference');
            visited.add(current.id);
            current = current.parentId ? folders.find((f) => f.id === current.parentId) : null;
          }
        }
        f.parentId = parentId || null;
        f.updatedAt = Date.now();
        result = f;
      } else if (action === 'delete') {
        if (!folderId) throw new Error('missing_folderId');
        // 子文件夹提升到被删文件夹的父级
        for (const f of folders) {
          if (f.parentId === folderId) {
            const deleted = folders.find((f) => f.id === folderId);
            f.parentId = deleted?.parentId || null;
          }
        }
        // 画布从该文件夹移出
        const map = project.canvasFolderMap;
        for (const [cid, fid] of Object.entries(map)) {
          if (fid === folderId) delete map[cid];
        }
        project.folders = folders.filter((f) => f.id !== folderId);
        result = { deleted: folderId };
      } else {
        throw new Error('invalid_action');
      }

      project.updatedAt = Date.now();
    });
    res.json({ ok: true, result });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'no_permission' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// PATCH /api/project/:id/assign-folder → 画布归属文件夹
// body: { canvasId, folderId? } (folderId=null → 移出文件夹)
router.patch('/:id/assign-folder', (req, res) => {
  const userId = req.user?.id;
  const { canvasId, folderId } = req.body || {};

  if (!canvasId) return res.status(400).json({ error: 'missing_canvasId' });

  try {
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (!canManage(project, userId)) throw new Error('no_permission');

      // 校验画布属于此项目
      const canvas = (payload.canvases || []).find((c) => c.id === canvasId && !c.deleted);
      if (!canvas) throw new Error('canvas_not_found');
      if (canvas.projectId !== project.id) throw new Error('canvas_not_in_project');

      // 校验文件夹存在
      if (folderId && !(project.folders || []).find((f) => f.id === folderId)) {
        throw new Error('folder_not_found');
      }

      if (!project.canvasFolderMap) project.canvasFolderMap = {};
      if (folderId) {
        project.canvasFolderMap[canvasId] = folderId;
      } else {
        delete project.canvasFolderMap[canvasId];
      }
      project.updatedAt = Date.now();
    });
    res.json({ ok: true });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'no_permission' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── 画布归属项目 ────────────────────────────────────────────

// POST /api/project/:id/assign-canvas → 将画布归属到项目
// body: { canvasId }
// body: { canvasId, unassign: true } → 取消归属（画布变为未分类）
router.post('/:id/assign-canvas', (req, res) => {
  const userId = req.user?.id;
  const { canvasId, unassign } = req.body || {};
  if (!canvasId) return res.status(400).json({ error: 'missing_canvasId' });

  try {
    mutateStore((payload) => {
      const project = (payload.projects || []).find((pr) => pr.id === req.params.id && !pr.deleted);
      if (!project) throw new Error('project_not_found');
      if (!canManage(project, userId)) throw new Error('no_permission');

      const canvas = (payload.canvases || []).find((c) => c.id === canvasId && !c.deleted);
      if (!canvas) throw new Error('canvas_not_found');

      if (unassign) {
        // 取消归属：画布变为未分类
        canvas.projectId = null;
      } else {
        // 归属到项目
        canvas.projectId = project.id;
      }
      canvas.updatedAt = Date.now();
      project.updatedAt = Date.now();
    });
    res.json({ ok: true });
  } catch (e) {
    const status = e.message === 'project_not_found' ? 404
      : e.message === 'no_permission' ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── 迁移：ownerId 分组 → project ───────────────────────────

// POST /api/project/migrate → 自动把现有 ownerId 分组的画布包装为项目
router.post('/migrate', async (req, res) => {
  const userId = req.user?.id;
  // 只有 admin 可以触发迁移
  const allUsers = await listAllUsersWithRoles();
  const me = allUsers.find((u) => u.id === userId);
  if (!me || me.role !== 'admin') return res.status(403).json({ error: 'admin_only' });

  try {
    const migrationLog = [];
    mutateStore((payload) => {
      if (!payload.projects) payload.projects = [];
      const canvases = (payload.canvases || []).filter((c) => !c.deleted);

      // 按 ownerId 分组（跳过无主画布）
      const byOwner = new Map();
      for (const c of canvases) {
        if (!c.ownerId) continue;
        if (!c.projectId || c.projectId === 'project-default') {
          if (!byOwner.has(c.ownerId)) byOwner.set(c.ownerId, []);
          byOwner.get(c.ownerId).push(c);
        }
      }

      for (const [ownerId, ownerCanvases] of byOwner) {
        // 检查是否已有项目包含这些画布
        const existing = payload.projects.find((p) => p.ownerId === ownerId && !p.deleted);
        if (existing) {
          // 把画布归入已有项目
          for (const c of ownerCanvases) {
            if (c.projectId !== existing.id) {
              c.projectId = existing.id;
            }
          }
          migrationLog.push({ action: 'merge', ownerId, projectId: existing.id, canvasCount: ownerCanvases.length });
          continue;
        }

        // 创建新项目
        const now = Date.now();
        const project = {
          id: genProjectId(),
          name: `${ownerCanvases[0]?.name?.split(/[-_/]/)[0] || ownerId} 的项目`,
          description: `自动迁移自 ownerId=${ownerId}`,
          color: FOLDER_PRESET_COLORS[payload.projects.length % FOLDER_PRESET_COLORS.length],
          ownerId,
          flexPool: [{ userId: ownerId, role: 'owner', joinedAt: now }],
          folders: [],
          canvasFolderMap: {},
          createdAt: now,
          updatedAt: now,
        };

        // 迁移画布级 flexPool → 项目级（取并集）
        const memberMap = new Map();
        memberMap.set(ownerId, 'owner');
        for (const c of ownerCanvases) {
          if (Array.isArray(c.flexPool)) {
            for (const e of c.flexPool) {
              if (!memberMap.has(e.userId) || FLEX_ROLES.indexOf(e.role) < FLEX_ROLES.indexOf(memberMap.get(e.userId))) {
                memberMap.set(e.userId, e.role);
              }
            }
          }
          c.projectId = project.id;
        }
        project.flexPool = Array.from(memberMap.entries()).map(([uid, role]) => {
          const existing = (ownerCanvases.flatMap((c) => c.flexPool || [])).find((e) => e.userId === uid);
          return { userId: uid, role, joinedAt: existing?.joinedAt || now };
        });

        payload.projects.push(project);
        migrationLog.push({ action: 'create', ownerId, projectId: project.id, canvasCount: ownerCanvases.length, memberCount: project.flexPool.length });
      }
    });
    res.json({ ok: true, migrated: migrationLog });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
