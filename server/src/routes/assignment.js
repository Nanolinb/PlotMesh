import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { addInboxItem, resolveAssignmentInbox } from '../auth/inboxStore.js';
import { listAllUsersWithRoles } from '../auth/usersStore.js';
import { broadcastInbox } from './events.js';
import { listRuns } from '../runner/runStore.js';
import { mutateStore, readPayload } from '../utils/storeIO.js';

const router = Router();
router.use(requireAuth);

function projectRole(project, userId) {
  if (!project) return null;
  if (project.ownerId === userId) return 'owner';
  return (project.flexPool || []).find((entry) => entry.userId === userId)?.role || null;
}

function isProjectManager(project, userId, systemRole) {
  if (systemRole === 'admin') return true;
  const role = projectRole(project, userId);
  return role === 'owner' || role === 'admin';
}

function canRequestAssignment(project, sourceCanvas, userId, systemRole) {
  return isProjectManager(project, userId, systemRole) || sourceCanvas.ownerId === userId;
}

function assignmentId() {
  return `assignment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function entityId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function findLiveCanvas(payload, canvasId) {
  return (payload.canvases || []).find((canvas) => canvas.id === canvasId && !canvas.deleted);
}

function findSourceNode(canvas, nodeId) {
  return (canvas?.nodes || []).find((node) => node.id === nodeId);
}

function isCrossOutput(node) {
  return (node?.data?.type || node?.type) === 'crossOutput';
}

function notify(userId, item) {
  if (!userId) return;
  try {
    const entry = addInboxItem(userId, item);
    broadcastInbox(userId, entry);
  } catch (error) {
    console.warn('[assignment] notify failed:', error.message);
  }
}

function sourceAuditPatch(node, assignment, assigneeName, extra = {}) {
  node.data = {
    ...(node.data || {}),
    assignmentId: assignment.id,
    assignmentStatus: assignment.decisionStatus,
    assigneeUserId: assignment.targetUserId,
    assigneeName,
    ...extra,
  };
}

function memberLoad(assignments, userId) {
  return {
    activeAssignments: assignments.filter(
      (assignment) => assignment.targetUserId === userId
        && assignment.decisionStatus === 'accepted'
        && assignment.workStatus === 'active',
    ).length,
    pendingRequests: assignments.filter(
      (assignment) => assignment.targetUserId === userId
        && assignment.decisionStatus === 'pending',
    ).length,
  };
}

function runningTargetCount(assignments, userId) {
  const targetIds = new Set(assignments
    .filter((assignment) => assignment.targetUserId === userId
      && assignment.decisionStatus === 'accepted'
      && assignment.workStatus === 'active'
      && assignment.effectiveTargetCanvasId)
    .map((assignment) => assignment.effectiveTargetCanvasId));
  let count = 0;
  for (const canvasId of targetIds) {
    if (listRuns(canvasId, 20).some((run) => run.status === 'running')) count += 1;
  }
  return count;
}

router.get('/candidates', async (req, res) => {
  const sourceCanvasId = String(req.query.sourceCanvasId || '');
  if (!sourceCanvasId) return res.status(400).json({ error: 'sourceCanvasId_required' });

  const payload = readPayload();
  const sourceCanvas = findLiveCanvas(payload, sourceCanvasId);
  if (!sourceCanvas) return res.status(404).json({ error: 'source_canvas_not_found' });
  const project = (payload.projects || []).find((item) => item.id === sourceCanvas.projectId && !item.deleted);
  if (!project) return res.status(404).json({ error: 'source_project_not_found' });

  const role = projectRole(project, req.user.id);
  if (req.user.role !== 'admin' && !role && sourceCanvas.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'no_access' });
  }

  const users = await listAllUsersWithRoles();
  const userMap = new Map(users.map((user) => [user.id, user]));
  const assignments = (payload.assignments || []).filter((assignment) => assignment.projectId === project.id);
  const computedAt = Date.now();
  const candidates = (project.flexPool || []).map((entry) => {
    const user = userMap.get(entry.userId);
    const load = memberLoad(assignments, entry.userId);
    return {
      userId: entry.userId,
      name: user?.name || entry.userId,
      email: user?.email || '',
      color: user?.color || '#6366f1',
      role: entry.role,
      unavailable: entry.unavailable === true,
      availability: {
        ...load,
        runningTargets: runningTargetCount(assignments, entry.userId),
        label: 'relative-load',
        computedAt,
      },
      expertise: { score: null, signals: [] },
    };
  }).sort((left, right) => {
    if (left.unavailable !== right.unavailable) return left.unavailable ? 1 : -1;
    return left.availability.activeAssignments - right.availability.activeAssignments
      || left.availability.runningTargets - right.availability.runningTargets
      || left.availability.pendingRequests - right.availability.pendingRequests
      || left.name.localeCompare(right.name, 'zh-CN');
  });

  res.json({
    project: { id: project.id, name: project.name, color: project.color },
    sourceCanvas: { id: sourceCanvas.id, name: sourceCanvas.name },
    candidates,
    ranking: {
      active: 'relative-load',
      evidence: ['activeAssignments', 'runningTargets', 'pendingRequests'],
      expertise: 'insufficient-data',
    },
  });
});

router.post('/', async (req, res) => {
  const {
    sourceCanvasId,
    sourceNodeId,
    targetUserId,
    targetMode,
    proposedCanvasName,
    targetCanvasId,
    requestedExpertiseTags,
  } = req.body || {};
  if (!sourceCanvasId || !sourceNodeId || !targetUserId) {
    return res.status(400).json({ error: 'missing_required_fields' });
  }
  if (targetMode !== 'create' && targetMode !== 'existing') {
    return res.status(400).json({ error: 'invalid_target_mode' });
  }
  if (targetMode === 'existing' && !targetCanvasId) {
    return res.status(400).json({ error: 'targetCanvasId_required' });
  }

  const users = await listAllUsersWithRoles();
  const targetUser = users.find((user) => user.id === targetUserId);
  let created = null;
  try {
    mutateStore((payload) => {
      const sourceCanvas = findLiveCanvas(payload, sourceCanvasId);
      if (!sourceCanvas) throw new Error('source_canvas_not_found');
      const sourceNode = findSourceNode(sourceCanvas, sourceNodeId);
      if (!sourceNode) throw new Error('source_node_not_found');
      if (!isCrossOutput(sourceNode)) throw new Error('source_node_must_be_crossOutput');

      const project = (payload.projects || []).find((item) => item.id === sourceCanvas.projectId && !item.deleted);
      if (!project) throw new Error('source_project_not_found');
      if (!canRequestAssignment(project, sourceCanvas, req.user.id, req.user.role)) {
        throw new Error('no_permission');
      }
      if (!(project.flexPool || []).some((entry) => entry.userId === targetUserId)) {
        throw new Error('target_not_in_project_flex_pool');
      }
      if (!targetUser) throw new Error('target_user_not_found');

      let existingTarget = null;
      if (targetMode === 'existing') {
        existingTarget = findLiveCanvas(payload, targetCanvasId);
        if (!existingTarget) throw new Error('target_canvas_not_found');
        if (existingTarget.projectId !== project.id) throw new Error('target_canvas_must_be_same_project');
        if (existingTarget.id === sourceCanvas.id) throw new Error('target_canvas_must_differ_from_source');
        const canGrantExisting = isProjectManager(project, req.user.id, req.user.role)
          || existingTarget.ownerId === req.user.id;
        if (!canGrantExisting) throw new Error('cannot_grant_existing_target');
      }

      if (!Array.isArray(payload.assignments)) payload.assignments = [];
      const open = payload.assignments.find((assignment) =>
        assignment.sourceCanvasId === sourceCanvasId
        && assignment.sourceNodeId === sourceNodeId
        && (assignment.decisionStatus === 'pending'
          || (assignment.decisionStatus === 'accepted' && assignment.workStatus === 'active')),
      );
      if (open) throw new Error('open_assignment_exists');

      const now = Date.now();
      const id = assignmentId();
      created = {
        id,
        projectId: project.id,
        sourceCanvasId,
        sourceNodeId,
        requestedByUserId: req.user.id,
        targetUserId,
        targetMode,
        ...(targetMode === 'create' ? { proposedCanvasName: String(proposedCanvasName || '').trim() || `${sourceNode.data?.label || '协作任务'} · ${targetUser.name}` } : {}),
        ...(targetMode === 'existing' ? { targetCanvasId } : {}),
        decisionStatus: 'pending',
        workStatus: null,
        requestedAt: now,
        requestedExpertiseTags: Array.isArray(requestedExpertiseTags)
          ? requestedExpertiseTags.map((tag) => String(tag).trim()).filter(Boolean)
          : [],
        grant: { canvasRole: 'editor', provenance: `assignment:${id}` },
        history: [{ at: now, by: req.user.id, action: 'request', fromStatus: null, toStatus: 'pending' }],
      };
      payload.assignments.push(created);
      sourceAuditPatch(sourceNode, created, targetUser.name);
      sourceCanvas.updatedAt = now;
    });
  } catch (error) {
    const statuses = {
      source_canvas_not_found: 404,
      source_node_not_found: 404,
      source_project_not_found: 404,
      target_user_not_found: 404,
      target_canvas_not_found: 404,
      no_permission: 403,
      cannot_grant_existing_target: 403,
      open_assignment_exists: 409,
    };
    return res.status(statuses[error.message] || 400).json({ error: error.message });
  }

  notify(targetUserId, {
    kind: 'assignment',
    title: '新的协作分配请求',
    body: `${req.user.name || req.user.email || '项目成员'} 邀请你承接「${created.proposedCanvasName || '已有画布任务'}」`,
    from: { userId: req.user.id, name: req.user.name || req.user.email || req.user.id },
    target: { canvasId: sourceCanvasId, nodeId: sourceNodeId, assignmentId: created.id },
    actions: [
      { label: '接受', action: 'accept-assignment', payload: { assignmentId: created.id, sourceCanvasId } },
      { label: '拒绝', action: 'decline-assignment', payload: { assignmentId: created.id, sourceCanvasId } },
    ],
  });

  res.status(201).json({ ok: true, assignment: created });
});

router.post('/:id/accept', async (req, res) => {
  const users = await listAllUsersWithRoles();
  const userMap = new Map(users.map((user) => [user.id, user]));
  let result = null;
  try {
    mutateStore((payload) => {
      const assignment = (payload.assignments || []).find((item) => item.id === req.params.id);
      if (!assignment) throw new Error('assignment_not_found');
      if (assignment.targetUserId !== req.user.id) throw new Error('target_only');
      if (assignment.decisionStatus !== 'pending') throw new Error('assignment_not_pending');

      const project = (payload.projects || []).find((item) => item.id === assignment.projectId && !item.deleted);
      const sourceCanvas = findLiveCanvas(payload, assignment.sourceCanvasId);
      const sourceNode = findSourceNode(sourceCanvas, assignment.sourceNodeId);
      if (!project || !sourceCanvas || !sourceNode || !isCrossOutput(sourceNode)) {
        throw new Error('assignment_source_invalid');
      }
      if (!(project.flexPool || []).some((entry) => entry.userId === assignment.targetUserId)) {
        throw new Error('target_no_longer_in_project_flex_pool');
      }

      const now = Date.now();
      let targetCanvas;
      if (assignment.targetMode === 'create') {
        targetCanvas = {
          id: entityId('canvas'),
          name: assignment.proposedCanvasName || `${sourceNode.data?.label || '协作任务'} · ${req.user.name || req.user.id}`,
          workspaceId: sourceCanvas.workspaceId || 'workspace-default',
          projectId: project.id,
          ownerId: assignment.targetUserId,
          sharedWith: [],
          flexPool: [{ userId: assignment.targetUserId, role: 'owner', joinedAt: now }],
          parentCanvasId: sourceCanvas.id,
          sourceAssignmentId: assignment.id,
          nodes: [],
          edges: [],
          createdAt: now,
          updatedAt: now,
        };
        if (!Array.isArray(payload.canvases)) payload.canvases = [];
        payload.canvases.push(targetCanvas);
        assignment.createdCanvasId = targetCanvas.id;
      } else {
        targetCanvas = findLiveCanvas(payload, assignment.targetCanvasId);
        if (!targetCanvas) throw new Error('target_canvas_not_found');
        if (targetCanvas.projectId !== project.id) throw new Error('target_canvas_must_be_same_project');
        const requester = userMap.get(assignment.requestedByUserId);
        const requesterCanStillGrant = isProjectManager(
          project, assignment.requestedByUserId, requester?.role || 'member',
        ) || targetCanvas.ownerId === assignment.requestedByUserId;
        if (!requesterCanStillGrant) throw new Error('requester_no_longer_can_grant_target');
        if (targetCanvas.ownerId !== assignment.targetUserId) {
          const shared = new Set(targetCanvas.sharedWith || []);
          shared.add(assignment.targetUserId);
          targetCanvas.sharedWith = [...shared];
        }
        if (!Array.isArray(targetCanvas.flexPool)) targetCanvas.flexPool = [];
        const acl = targetCanvas.flexPool.find((entry) => entry.userId === assignment.targetUserId);
        if (acl) acl.role = 'editor';
        else targetCanvas.flexPool.push({ userId: assignment.targetUserId, role: 'editor', joinedAt: now });
        targetCanvas.parentCanvasId = sourceCanvas.id;
        targetCanvas.sourceAssignmentId = assignment.id;
        targetCanvas.updatedAt = now;
      }

      const xs = (targetCanvas.nodes || []).map((node) => (node.position?.x || 0) + 250);
      const targetNode = {
        id: entityId('crossInput'),
        type: 'crossInput',
        position: { x: xs.length ? Math.max(...xs) + 50 : 100, y: 100 },
        data: {
          type: 'crossInput',
          label: `🌐 ← ${sourceCanvas.name || sourceCanvas.id}`,
          sourceCanvasId: sourceCanvas.id,
          sourceCanvasName: sourceCanvas.name || sourceCanvas.id,
          sourceNodeId: sourceNode.id,
          sourceNodeLabel: sourceNode.data?.label || 'crossOutput',
          assignmentId: assignment.id,
          text: '',
          status: 'waiting',
          receivedAt: null,
        },
      };
      targetCanvas.nodes = targetCanvas.nodes || [];
      targetCanvas.nodes.push(targetNode);
      targetCanvas.updatedAt = now;

      if (!Array.isArray(payload.connections)) payload.connections = [];
      payload.connections = payload.connections.filter((connection) =>
        !(connection.srcCanvasId === sourceCanvas.id && connection.srcNodeId === sourceNode.id),
      );
      const connection = {
        id: entityId('conn'),
        srcCanvasId: sourceCanvas.id,
        srcNodeId: sourceNode.id,
        dstCanvasId: targetCanvas.id,
        dstNodeId: targetNode.id,
        assignmentId: assignment.id,
        createdAt: now,
        status: 'accepted',
        requestedBy: assignment.requestedByUserId,
        srcOwnerId: sourceCanvas.ownerId || null,
        dstOwnerId: targetCanvas.ownerId || assignment.targetUserId,
        decidedAt: now,
        cancelledAt: null,
        history: [{
          at: now,
          by: assignment.targetUserId,
          action: 'assignment-accept',
          fromStatus: null,
          toStatus: 'accepted',
          assignmentId: assignment.id,
        }],
      };
      payload.connections.push(connection);

      assignment.decisionStatus = 'accepted';
      assignment.workStatus = 'active';
      assignment.acceptedAt = now;
      assignment.grantedAt = now;
      assignment.effectiveTargetCanvasId = targetCanvas.id;
      assignment.connectionId = connection.id;
      (assignment.history = assignment.history || []).push({
        at: now, by: assignment.targetUserId, action: 'accept', fromStatus: 'pending', toStatus: 'accepted',
      });

      sourceAuditPatch(sourceNode, assignment, userMap.get(assignment.targetUserId)?.name || assignment.targetUserId, {
        targetCanvasId: targetCanvas.id,
        targetCanvasName: targetCanvas.name || targetCanvas.id,
        targetNodeId: targetNode.id,
      });
      sourceCanvas.updatedAt = now;
      result = { assignment, connection, targetCanvas, sourceCanvasId: sourceCanvas.id };
    });
  } catch (error) {
    const statuses = {
      assignment_not_found: 404,
      target_canvas_not_found: 404,
      target_only: 403,
      requester_no_longer_can_grant_target: 403,
      assignment_not_pending: 409,
      target_no_longer_in_project_flex_pool: 409,
    };
    return res.status(statuses[error.message] || 400).json({ error: error.message });
  }

  resolveAssignmentInbox(result.assignment.targetUserId, result.assignment.id, '已接受');
  notify(result.assignment.requestedByUserId, {
    kind: 'assignment',
    title: '协作分配已接受',
    body: `${req.user.name || req.user.email || '成员'} 已接受分配，可打开下游画布继续协作`,
    from: { userId: req.user.id, name: req.user.name || req.user.email || req.user.id },
    target: { canvasId: result.targetCanvas.id, assignmentId: result.assignment.id },
    actions: [{ label: '打开画布', action: 'open-canvas', payload: { canvasId: result.targetCanvas.id } }],
  });

  res.json({
    ok: true,
    assignment: result.assignment,
    connection: result.connection,
    effectiveTargetCanvasId: result.targetCanvas.id,
    sourceCanvasId: result.sourceCanvasId,
  });
});

router.post('/:id/decline', async (req, res) => {
  const users = await listAllUsersWithRoles();
  const userMap = new Map(users.map((user) => [user.id, user]));
  let result = null;
  try {
    mutateStore((payload) => {
      const assignment = (payload.assignments || []).find((item) => item.id === req.params.id);
      if (!assignment) throw new Error('assignment_not_found');
      if (assignment.targetUserId !== req.user.id) throw new Error('target_only');
      if (assignment.decisionStatus !== 'pending') throw new Error('assignment_not_pending');
      const now = Date.now();
      assignment.decisionStatus = 'declined';
      assignment.declinedAt = now;
      (assignment.history = assignment.history || []).push({
        at: now, by: req.user.id, action: 'decline', fromStatus: 'pending', toStatus: 'declined',
      });
      const sourceCanvas = findLiveCanvas(payload, assignment.sourceCanvasId);
      const sourceNode = findSourceNode(sourceCanvas, assignment.sourceNodeId);
      if (sourceNode) {
        sourceAuditPatch(sourceNode, assignment, userMap.get(assignment.targetUserId)?.name || assignment.targetUserId);
        sourceCanvas.updatedAt = now;
      }
      result = assignment;
    });
  } catch (error) {
    const statuses = { assignment_not_found: 404, target_only: 403, assignment_not_pending: 409 };
    return res.status(statuses[error.message] || 400).json({ error: error.message });
  }

  resolveAssignmentInbox(result.targetUserId, result.id, '已拒绝');
  notify(result.requestedByUserId, {
    kind: 'assignment',
    title: '协作分配已拒绝',
    body: `${req.user.name || req.user.email || '成员'} 拒绝了协作分配`,
    from: { userId: req.user.id, name: req.user.name || req.user.email || req.user.id },
    target: { canvasId: result.sourceCanvasId, nodeId: result.sourceNodeId, assignmentId: result.id },
    actions: [{ label: '打开源画布', action: 'open-canvas', payload: { canvasId: result.sourceCanvasId } }],
  });
  res.json({ ok: true, assignment: result, sourceCanvasId: result.sourceCanvasId });
});

router.post('/:id/complete', (req, res) => {
  let result = null;
  try {
    mutateStore((payload) => {
      const assignment = (payload.assignments || []).find((item) => item.id === req.params.id);
      if (!assignment) throw new Error('assignment_not_found');
      const project = (payload.projects || []).find((item) => item.id === assignment.projectId && !item.deleted);
      if (assignment.targetUserId !== req.user.id && !isProjectManager(project, req.user.id, req.user.role)) {
        throw new Error('no_permission');
      }
      if (assignment.decisionStatus !== 'accepted' || assignment.workStatus !== 'active') {
        throw new Error('assignment_not_active');
      }
      const now = Date.now();
      assignment.workStatus = 'completed';
      assignment.completedAt = now;
      (assignment.history = assignment.history || []).push({
        at: now, by: req.user.id, action: 'complete', fromStatus: 'active', toStatus: 'completed',
      });
      const sourceCanvas = findLiveCanvas(payload, assignment.sourceCanvasId);
      const sourceNode = findSourceNode(sourceCanvas, assignment.sourceNodeId);
      if (sourceNode) {
        sourceNode.data = { ...(sourceNode.data || {}), assignmentStatus: 'completed' };
        sourceCanvas.updatedAt = now;
      }
      result = assignment;
    });
  } catch (error) {
    const statuses = { assignment_not_found: 404, no_permission: 403, assignment_not_active: 409 };
    return res.status(statuses[error.message] || 400).json({ error: error.message });
  }
  res.json({ ok: true, assignment: result });
});

router.get('/project/:projectId', async (req, res) => {
  const payload = readPayload();
  const project = (payload.projects || []).find((item) => item.id === req.params.projectId && !item.deleted);
  if (!project) return res.status(404).json({ error: 'project_not_found' });
  const role = projectRole(project, req.user.id);
  if (req.user.role !== 'admin' && !role) return res.status(403).json({ error: 'no_access' });

  const manager = isProjectManager(project, req.user.id, req.user.role);
  const canvases = (payload.canvases || []).filter((canvas) => !canvas.deleted && canvas.projectId === project.id);
  const canvasMap = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  const users = await listAllUsersWithRoles();
  const userMap = new Map(users.map((user) => [user.id, user]));
  const assignments = (payload.assignments || [])
    .filter((assignment) => assignment.projectId === project.id)
    .filter((assignment) => manager
      || assignment.requestedByUserId === req.user.id
      || assignment.targetUserId === req.user.id
      || canvasMap.get(assignment.sourceCanvasId)?.ownerId === req.user.id
      || canvasMap.get(assignment.effectiveTargetCanvasId)?.ownerId === req.user.id)
    .map((assignment) => ({
      ...assignment,
      requesterName: userMap.get(assignment.requestedByUserId)?.name || assignment.requestedByUserId,
      targetUserName: userMap.get(assignment.targetUserId)?.name || assignment.targetUserId,
      sourceCanvasName: canvasMap.get(assignment.sourceCanvasId)?.name || assignment.sourceCanvasId,
      targetCanvasName: canvasMap.get(assignment.effectiveTargetCanvasId || assignment.targetCanvasId)?.name
        || assignment.proposedCanvasName
        || assignment.effectiveTargetCanvasId
        || assignment.targetCanvasId
        || '',
    }));
  res.json({ project: { id: project.id, name: project.name }, assignments });
});

export default router;
