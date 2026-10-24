/**
 * 共享常用功能库：公共模板 + 项目 Team 分享。
 * 本地 packages 仍是个人工作区数据；本路由只存服务器侧的可分享副本。
 */
import { Router } from 'express';
import { readPayload, mutateStore } from '../utils/storeIO.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth);

const TEAM_TAG = 'team';

function ensureLibrary(payload) {
  if (!Array.isArray(payload.packageLibrary)) payload.packageLibrary = [];
  return payload.packageLibrary;
}

function roleInProject(project, userId) {
  const member = (project?.flexPool || []).find((item) => item.userId === userId);
  return member?.role || (project?.ownerId === userId ? 'owner' : null);
}

function canViewProject(project, user) {
  return user?.role === 'admin' || !!roleInProject(project, user?.id);
}

function canEditProject(project, user) {
  if (user?.role === 'admin') return true;
  return ['owner', 'admin', 'editor'].includes(roleInProject(project, user?.id));
}

function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean))].slice(0, 12);
}

function visibleRecord(record) {
  const { nodes, edges, ...summary } = record;
  return { ...summary, nodeCount: Array.isArray(nodes) ? nodes.length : 0 };
}

function publicSafe(record) {
  return record.scope === 'public' && !(record.tags || []).some((tag) => tag === TEAM_TAG || tag.startsWith('project:'));
}

// GET /api/package-library?scope=public|team&projectId=&q=
router.get('/', (req, res) => {
  const scope = req.query.scope === 'team' ? 'team' : 'public';
  const projectId = String(req.query.projectId || '');
  const q = String(req.query.q || '').trim().toLowerCase();
  const payload = readPayload();
  const entries = ensureLibrary(payload);

  if (scope === 'team' && !projectId) return res.status(400).json({ error: 'projectId_required' });
  const project = scope === 'team' ? (payload.projects || []).find((item) => item.id === projectId) : null;
  if (scope === 'team' && (!project || !canViewProject(project, req.user))) return res.status(403).json({ error: 'project_access_denied' });

  const records = entries.filter((entry) => {
    if (entry.deleted) return false;
    if (scope === 'public' ? !publicSafe(entry) : entry.scope !== 'team' || entry.projectId !== projectId) return false;
    if (!q) return true;
    return [entry.name, entry.description, ...(entry.tags || [])].join(' ').toLowerCase().includes(q);
  });
  res.json({ packages: records.map(visibleRecord), project: project ? { id: project.id, name: project.name, color: project.color } : null });
});

// GET /api/package-library/:id — 返回可导入的完整图数据
router.get('/:id', (req, res) => {
  const payload = readPayload();
  const record = ensureLibrary(payload).find((item) => item.id === req.params.id && !item.deleted);
  if (!record) return res.status(404).json({ error: 'library_package_not_found' });
  if (record.scope === 'public' ? !publicSafe(record) : !canViewProject((payload.projects || []).find((project) => project.id === record.projectId), req.user)) {
    return res.status(403).json({ error: 'library_access_denied' });
  }
  res.json({ package: record });
});

// POST /api/package-library — 发布当前个人常用功能的副本
router.post('/', (req, res) => {
  const { scope, projectId, sourcePackageId, name, description, tags, nodes, edges } = req.body || {};
  if (!['public', 'team'].includes(scope)) return res.status(400).json({ error: 'invalid_scope' });
  if (!name || !Array.isArray(nodes) || !Array.isArray(edges)) return res.status(400).json({ error: 'name_nodes_edges_required' });
  const cleanTags = normalizeTags(tags);
  if (scope === 'public' && cleanTags.some((tag) => tag === TEAM_TAG || tag.startsWith('project:'))) {
    return res.status(400).json({ error: 'team_tag_cannot_be_public' });
  }

  try {
    let created;
    mutateStore((payload) => {
      if (scope === 'team') {
        const project = (payload.projects || []).find((item) => item.id === projectId);
        if (!project || !canEditProject(project, req.user)) throw new Error('project_edit_denied');
      }
      const list = ensureLibrary(payload);
      const now = Date.now();
      created = {
        id: `libpkg-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        scope,
        projectId: scope === 'team' ? projectId : undefined,
        sourcePackageId: String(sourcePackageId || ''),
        ownerId: req.user.id,
        ownerName: req.user.name || req.user.email || '成员',
        name: String(name).trim().slice(0, 80),
        description: String(description || '').trim().slice(0, 500),
        tags: scope === 'team' ? [...new Set([TEAM_TAG, `project:${projectId}`, ...cleanTags])] : cleanTags,
        nodes,
        edges,
        createdAt: now,
        updatedAt: now,
      };
      list.push(created);
    });
    res.status(201).json({ package: visibleRecord(created) });
  } catch (error) {
    res.status(error.message === 'project_edit_denied' ? 403 : 500).json({ error: error.message || 'library_publish_failed' });
  }
});

// DELETE /api/package-library/:id — 公共模板仅系统管理员；Team 模板允许作者或项目管理员删除
router.delete('/:id', (req, res) => {
  try {
    mutateStore((payload) => {
      const record = ensureLibrary(payload).find((item) => item.id === req.params.id && !item.deleted);
      if (!record) throw new Error('library_package_not_found');
      const isPublic = record.scope === 'public';
      const project = (payload.projects || []).find((item) => item.id === record.projectId);
      const allowed = isPublic
        ? req.user.role === 'admin'
        : record.ownerId === req.user.id || canEditProject(project, req.user);
      if (!allowed) throw new Error('library_delete_denied');
      record.deleted = true;
      record.deletedAt = Date.now();
      record.deletedBy = req.user.id;
    });
    res.json({ ok: true });
  } catch (error) {
    const code = /denied/.test(error.message) ? 403 : error.message === 'library_package_not_found' ? 404 : 500;
    res.status(code).json({ error: error.message || 'library_delete_failed' });
  }
});

export default router;
