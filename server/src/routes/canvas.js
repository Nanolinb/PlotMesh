/**
 * server/src/routes/canvas.js · 外部 AI 操作画布的 REST API（v1.6 切片 1）
 * ---------------------------------------------------------------
 * 让外部 AI（codex / kimi / curl 脚本等）通过 HTTP 直接读写画布。
 * 数据流：API → store.json → 前端 sync 拉到 → 用户刷新看到
 *
 * 鉴权（middleware/apiToken.js）：
 *   - localhost 默认豁免（方便 dev 用 curl）
 *   - 远端：Authorization: Bearer <token>
 *
 * 路由清单：
 *   GET    /api/canvas/auth/token              查询当前 token（仅本机）
 *   POST   /api/canvas/auth/reset-token        重置 token（仅本机；env token 不可重置）
 *   GET    /api/canvas/list                    列出所有画布（含已软删/默认过滤）
 *   GET    /api/canvas/types                   节点类型 + 默认 data schema
 *   GET    /api/canvas/:id                     读画布全量
 *   GET    /api/canvas/:id/nodes               只读节点
 *   GET    /api/canvas/:id/nodes/:nodeId       读单节点
 *   POST   /api/canvas/:id/nodes               新建节点
 *   PATCH  /api/canvas/:id/nodes/:nodeId       改节点（partial）
 *   DELETE /api/canvas/:id/nodes/:nodeId       删节点（同时清相关边）
 *   POST   /api/canvas/:id/edges               新建边
 *   DELETE /api/canvas/:id/edges/:edgeId       删边
 *
 * 切片 3 会再加：
 *   POST   /api/canvas/:id/run                 触发画布运行（前端 polling worker）
 *   GET    /api/canvas/:id/runs/:jobId         查运行状态
 */
import { Router } from 'express';
import { readPayload, mutateStore } from '../utils/storeIO.js';
import {
  requireApiToken,
  requireLocalhost,
  getApiToken,
  getTokenSource,
  resetApiToken,
} from '../middleware/apiToken.js';
import { getServerConfig, updateServerConfig } from '../utils/serverConfig.js';

const router = Router();

// ─── Auth 子路由（仅本机访问，前端 UI 与本地脚本用） ────────────
// 这两条**不能**走 requireApiToken：让前端在不知道 token 时也能查/重置
// 安全模型：requireLocalhost 严格限制只允许 127.0.0.1 / ::1
router.get('/auth/token', requireLocalhost, (_req, res) => {
  res.json({
    token: getApiToken(),
    source: getTokenSource(), // 'env' | 'file' | 'generated'
    canReset: getTokenSource() !== 'env', // env token 不能从 API 重置
  });
});

router.post('/auth/reset-token', requireLocalhost, (_req, res) => {
  const result = resetApiToken();
  if (!result.ok) {
    return res.status(409).json(result);
  }
  return res.json({
    ok: true,
    token: result.token,
    source: getTokenSource(),
  });
});

// v1.6.2 server 行为开关（远端访问等）
router.get('/auth/server-config', requireLocalhost, (_req, res) => {
  res.json(getServerConfig());
});

router.patch('/auth/server-config', requireLocalhost, (req, res) => {
  const patch = {};
  if (typeof req.body?.remoteAccess === 'boolean') {
    patch.remoteAccess = req.body.remoteAccess;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_changes', message: '至少传一个可更新字段（如 remoteAccess: boolean）' });
  }
  const cfg = updateServerConfig(patch);
  res.json({ ok: true, config: cfg, restartRequired: true });
});

// 全部业务路由（在 auth 之后注册）都要 token；localhost 自动豁免
router.use(requireApiToken);

/** 工具：生成节点/边 id */
function genNodeId(type) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function genEdgeId(source, target) {
  return `e-${source}-${target}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 工具：找到画布（默认排除软删除） */
function findCanvas(payload, id, includeDeleted = false) {
  const list = payload.canvases || [];
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  if (c.deleted && !includeDeleted) return null;
  return c;
}

/** 节点类型 schema（让 AI 知道每种节点该填什么 data） */
const NODE_TYPES_SCHEMA = {
  textPrompt: {
    description: '文本提示词节点（手工输入文本作为下游输入）',
    defaultData: { type: 'textPrompt', label: '✏️ 文本提示词', text: '', promptNumber: 1, status: 'idle' },
    notes: 'text 字段是主要内容；promptNumber 是显示序号',
  },
  fileUpload: {
    description: '文件上传节点（上传文件解析为文本）',
    defaultData: { type: 'fileUpload', label: '📁 文件上传', files: [], status: 'idle' },
    notes: 'files 数组由前端上传后填充；外部 AI 不应直接写 files',
  },
  llm: {
    description: '大模型节点（调用 LLM 处理上游文本）',
    defaultData: {
      type: 'llm', label: '🤖 大模型', model: 'deepseek',
      customModelName: '', systemPrompt: '', temperature: 0.7,
      status: 'idle', output: '', streamOutput: '',
    },
    notes: 'model 取值: hunyuan/deepseek/glm/gpt/claude/kimi/qwen；customModelName 可填具体版本号',
  },
  output: {
    description: '输出节点（保存最终文本结果）',
    defaultData: { type: 'output', label: '📤 输出', format: 'markdown', status: 'idle', output: '' },
    notes: 'format 取值: text/markdown/web/excel/tencentDocs；output 字段执行时被覆盖',
  },
  textTransform: {
    description: '文本处理节点（正则、剪切、模板等）',
    defaultData: { type: 'textTransform', label: '🔤 文本处理', mode: 'passthrough', status: 'idle' },
  },
  condition: {
    description: '条件分支节点',
    defaultData: { type: 'condition', label: '🔀 条件分支', condition: '', status: 'idle' },
  },
  splitter: {
    description: '分叉节点（按段拆分上游文本，自动派生 OutputNode）',
    defaultData: {
      type: 'splitter', label: '分叉', splitMode: 'auto', portMode: 'auto',
      manualCount: 3, autoCommittedCount: 0, delimiter: '---', regex: '\\n\\n',
      upstreamText: '', status: 'idle',
      autoOutputs: true, outputLayout: 'right-vertical', outputLabelMode: 'index', derivedOutputIds: [],
    },
  },
  timeline: {
    description: '时间轴节点（视频/动画镜头编排）',
    defaultData: {
      type: 'timeline', label: '时间轴', durationSec: 15, fps: 30,
      pixelsPerSecond: 60, heightPx: 130, resizeMode: 'compress',
      timeMode: 'seconds', cuts: [], status: 'idle',
    },
  },
  swimlane: {
    description: '项目泳道节点（横向 group / 多泳道行）',
    defaultData: {
      type: 'swimlane', label: '🏊 项目泳道', unit: 'days', durationValue: 7,
      pixelsPerUnit: 90, lanes: [], rulerHeight: 36, paddingLeft: 80,
      autoOutputs: true,
    },
    notes: 'lanes 数组每项 { id, label, height, color? }；startISO 仅 hours/days 模式',
  },
  webLink: {
    description: 'Web 链接节点（抓取网页/腾讯文档作为输入）',
    defaultData: { type: 'webLink', label: '🔗 Web 链接', url: '', status: 'idle' },
    notes: 'url 是 docs.qq.com 时自动走 MCP；可填 tencentDocsToken',
  },
  group: {
    description: '分组容器（把多个节点装一起）',
    defaultData: { type: 'group', label: '功能组', collapsed: false, childCount: 0, status: 'idle' },
    notes: '子节点通过 parentId 挂入并设 extent="parent"',
  },
};

// =============================================================
// GET /api/canvas/types
// =============================================================
router.get('/types', (_req, res) => {
  res.json({ types: NODE_TYPES_SCHEMA });
});

// =============================================================
// GET /api/canvas/list
// =============================================================
router.get('/list', (_req, res) => {
  const p = readPayload();
  const includeDeleted = false;
  const out = (p.canvases || [])
    .filter((c) => includeDeleted || !c.deleted)
    .map((c) => ({
      id: c.id,
      name: c.name,
      workspaceId: c.workspaceId,
      projectId: c.projectId,
      nodeCount: (c.nodes || []).length,
      edgeCount: (c.edges || []).length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  res.json({ canvases: out });
});

// =============================================================
// GET /api/canvas/:id
// =============================================================
router.get('/:id', (req, res) => {
  const p = readPayload();
  const c = findCanvas(p, req.params.id);
  if (!c) return res.status(404).json({ error: 'canvas_not_found', id: req.params.id });
  res.json({ canvas: c });
});

// =============================================================
// GET /api/canvas/:id/nodes
// =============================================================
router.get('/:id/nodes', (req, res) => {
  const p = readPayload();
  const c = findCanvas(p, req.params.id);
  if (!c) return res.status(404).json({ error: 'canvas_not_found' });
  res.json({ nodes: c.nodes || [] });
});

// =============================================================
// GET /api/canvas/:id/nodes/:nodeId
// =============================================================
router.get('/:id/nodes/:nodeId', (req, res) => {
  const p = readPayload();
  const c = findCanvas(p, req.params.id);
  if (!c) return res.status(404).json({ error: 'canvas_not_found' });
  const n = (c.nodes || []).find((x) => x.id === req.params.nodeId);
  if (!n) return res.status(404).json({ error: 'node_not_found' });
  res.json({ node: n });
});

// =============================================================
// POST /api/canvas/:id/nodes
// body: { type, position?, data?, id?, parentId?, extent?, className?, width?, height?, style? }
// =============================================================
router.post('/:id/nodes', (req, res) => {
  const { type, position, data, id, parentId, extent, className, width, height, style } = req.body || {};
  if (!type) return res.status(400).json({ error: 'missing_field', field: 'type' });
  if (!NODE_TYPES_SCHEMA[type]) {
    return res.status(400).json({
      error: 'invalid_type',
      message: `Unknown node type: ${type}`,
      validTypes: Object.keys(NODE_TYPES_SCHEMA),
    });
  }
  const newId = id || genNodeId(type);
  const finalData = { ...(NODE_TYPES_SCHEMA[type].defaultData || {}), ...(data || {}), type };
  const newNode = {
    id: newId,
    type,
    position: position || { x: 100, y: 100 },
    data: finalData,
  };
  if (parentId) newNode.parentId = parentId;
  if (extent) newNode.extent = extent;
  if (className) newNode.className = className;
  if (typeof width === 'number') newNode.width = width;
  if (typeof height === 'number') newNode.height = height;
  if (style) newNode.style = style;

  let result;
  try {
    result = mutateStore((payload) => {
      const c = findCanvas(payload, req.params.id);
      if (!c) throw new Error('canvas_not_found');
      if ((c.nodes || []).some((x) => x.id === newId)) {
        throw new Error('node_id_conflict');
      }
      // React Flow v12 要求 parent 在 children 之前；如果指定了 parentId，
      // 把新节点插在父节点之后即可（这里直接 push 到末尾，因为父先存在）
      c.nodes = c.nodes || [];
      c.nodes.push(newNode);
      c.updatedAt = Date.now();
    });
  } catch (e) {
    if (e.message === 'canvas_not_found') return res.status(404).json({ error: 'canvas_not_found' });
    if (e.message === 'node_id_conflict') return res.status(409).json({ error: 'node_id_conflict', id: newId });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.status(201).json({ node: newNode, store: result });
});

// =============================================================
// PATCH /api/canvas/:id/nodes/:nodeId
// body: { position?, data?, label?, className?, width?, height?, style?, parentId?, extent? }
// data 是浅合并（你传的字段覆盖；不传的保留）
// =============================================================
router.patch('/:id/nodes/:nodeId', (req, res) => {
  const { position, data, label, className, width, height, style, parentId, extent } = req.body || {};
  let result;
  let updatedNode;
  try {
    result = mutateStore((payload) => {
      const c = findCanvas(payload, req.params.id);
      if (!c) throw new Error('canvas_not_found');
      const idx = (c.nodes || []).findIndex((x) => x.id === req.params.nodeId);
      if (idx < 0) throw new Error('node_not_found');
      const n = c.nodes[idx];
      const next = { ...n };
      if (position) next.position = position;
      if (data) next.data = { ...(n.data || {}), ...data };
      if (label != null) next.data = { ...(next.data || {}), label };
      if (className !== undefined) next.className = className;
      if (typeof width === 'number') next.width = width;
      if (typeof height === 'number') next.height = height;
      if (style) next.style = { ...(n.style || {}), ...style };
      if (parentId !== undefined) {
        if (parentId) next.parentId = parentId; else delete next.parentId;
      }
      if (extent !== undefined) {
        if (extent) next.extent = extent; else delete next.extent;
      }
      c.nodes[idx] = next;
      c.updatedAt = Date.now();
      updatedNode = next;
    });
  } catch (e) {
    if (e.message === 'canvas_not_found') return res.status(404).json({ error: 'canvas_not_found' });
    if (e.message === 'node_not_found') return res.status(404).json({ error: 'node_not_found' });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.json({ node: updatedNode, store: result });
});

// =============================================================
// DELETE /api/canvas/:id/nodes/:nodeId
// 同时清掉所有以它为 source 或 target 的边
// =============================================================
router.delete('/:id/nodes/:nodeId', (req, res) => {
  let result;
  let removedEdges = 0;
  try {
    result = mutateStore((payload) => {
      const c = findCanvas(payload, req.params.id);
      if (!c) throw new Error('canvas_not_found');
      const before = (c.nodes || []).length;
      c.nodes = (c.nodes || []).filter((x) => x.id !== req.params.nodeId);
      if (c.nodes.length === before) throw new Error('node_not_found');
      const beforeE = (c.edges || []).length;
      c.edges = (c.edges || []).filter(
        (e) => e.source !== req.params.nodeId && e.target !== req.params.nodeId
      );
      removedEdges = beforeE - c.edges.length;
      c.updatedAt = Date.now();
    });
  } catch (e) {
    if (e.message === 'canvas_not_found') return res.status(404).json({ error: 'canvas_not_found' });
    if (e.message === 'node_not_found') return res.status(404).json({ error: 'node_not_found' });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.json({ deleted: req.params.nodeId, removedEdges, store: result });
});

// =============================================================
// POST /api/canvas/:id/edges
// body: { source, target, sourceHandle?, targetHandle?, id? }
// 注意：targetHandle 留空会让 RF 用目标节点的默认 target handle，对 OutputNode 这种没设 id 的更安全
// =============================================================
router.post('/:id/edges', (req, res) => {
  const { source, target, sourceHandle, targetHandle, id } = req.body || {};
  if (!source) return res.status(400).json({ error: 'missing_field', field: 'source' });
  if (!target) return res.status(400).json({ error: 'missing_field', field: 'target' });
  const newId = id || genEdgeId(source, target);
  const newEdge = { id: newId, source, target };
  if (sourceHandle) newEdge.sourceHandle = sourceHandle;
  if (targetHandle) newEdge.targetHandle = targetHandle;

  let result;
  try {
    result = mutateStore((payload) => {
      const c = findCanvas(payload, req.params.id);
      if (!c) throw new Error('canvas_not_found');
      const nodes = c.nodes || [];
      if (!nodes.some((n) => n.id === source)) throw new Error('source_node_not_found');
      if (!nodes.some((n) => n.id === target)) throw new Error('target_node_not_found');
      c.edges = c.edges || [];
      if (c.edges.some((e) => e.id === newId)) throw new Error('edge_id_conflict');
      c.edges.push(newEdge);
      c.updatedAt = Date.now();
    });
  } catch (e) {
    if (e.message === 'canvas_not_found') return res.status(404).json({ error: 'canvas_not_found' });
    if (e.message === 'source_node_not_found') return res.status(404).json({ error: 'source_node_not_found', id: source });
    if (e.message === 'target_node_not_found') return res.status(404).json({ error: 'target_node_not_found', id: target });
    if (e.message === 'edge_id_conflict') return res.status(409).json({ error: 'edge_id_conflict', id: newId });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.status(201).json({ edge: newEdge, store: result });
});

// =============================================================
// DELETE /api/canvas/:id/edges/:edgeId
// =============================================================
router.delete('/:id/edges/:edgeId', (req, res) => {
  let result;
  try {
    result = mutateStore((payload) => {
      const c = findCanvas(payload, req.params.id);
      if (!c) throw new Error('canvas_not_found');
      const before = (c.edges || []).length;
      c.edges = (c.edges || []).filter((e) => e.id !== req.params.edgeId);
      if (c.edges.length === before) throw new Error('edge_not_found');
      c.updatedAt = Date.now();
    });
  } catch (e) {
    if (e.message === 'canvas_not_found') return res.status(404).json({ error: 'canvas_not_found' });
    if (e.message === 'edge_not_found') return res.status(404).json({ error: 'edge_not_found' });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.json({ deleted: req.params.edgeId, store: result });
});

// =============================================================
// POST /api/canvas (新建画布)
// body: { name?, projectId?, workspaceId? }
// =============================================================
router.post('/', (req, res) => {
  const { name, projectId, workspaceId } = req.body || {};
  const now = Date.now();
  const newCanvas = {
    id: `canvas-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `画布 ${new Date(now).toLocaleString('zh-CN')}`,
    workspaceId: workspaceId || 'workspace-default',
    projectId: projectId || 'project-default',
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  let result;
  try {
    result = mutateStore((payload) => {
      payload.canvases = payload.canvases || [];
      payload.canvases.push(newCanvas);
    });
  } catch (e) {
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.status(201).json({ canvas: newCanvas, store: result });
});

// =============================================================
// v1.6 切片 3：触发运行 + 状态查询（B 路线 - 前端 polling worker）
// ----------------------------------------------------------------
// 数据模型：在 payload.runs[] 队列里记录每个运行任务
//   { jobId, canvasId, status, requestedAt, startedAt?, completedAt?,
//     log?: string[], error?: string, results?: { [nodeId]: { output, error? } } }
// 前端 App.tsx 跑一个 polling worker（5s）：
//   - 扫 status==='pending' 且 canvasId 是\"当前活动画布\"或可切换到的画布
//   - 取一个 → 切到该画布 → 调 executeFlow → 跑完写 status=succeeded/failed
//
// 这条路线的取舍（v1.6 切片 3）：
//   ✅ 不重写执行引擎 ✅ 状态可视化保留
//   ⚠ 必须前端浏览器开着才会消费队列
//   ⚠ 多设备开着同一画布时谁先抢到 lock：用 leaderId（每个浏览器启动随机 id）
//      worker 拿任务时把 leaderId 写到 job 上，5s 心跳更新；其它浏览器看到
//      heartbeat 还新就跳过。心跳超 30s 视作死亡 → 别人接手。
// =============================================================

/** 工具：保证 payload.runs 是数组 */
function ensureRunsArray(payload) {
  if (!Array.isArray(payload.runs)) payload.runs = [];
}

// POST /api/canvas/:id/run  → 触发运行；返回 { jobId }
// body: { reason?: string, hint?: string }（hint 是给执行器的可选提示，目前不读）
router.post('/:id/run', (req, res) => {
  const { reason, hint } = req.body || {};
  const now = Date.now();
  const jobId = `run-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let result;
  try {
    result = mutateStore((payload) => {
      const c = findCanvas(payload, req.params.id);
      if (!c) throw new Error('canvas_not_found');
      ensureRunsArray(payload);
      payload.runs.push({
        jobId,
        canvasId: req.params.id,
        status: 'pending',
        requestedAt: now,
        reason: reason || null,
        hint: hint || null,
        log: [],
        results: {},
      });
    });
  } catch (e) {
    if (e.message === 'canvas_not_found') return res.status(404).json({ error: 'canvas_not_found' });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.status(202).json({ jobId, status: 'pending', store: result });
});

// GET /api/canvas/:id/runs/:jobId  → 查运行状态
router.get('/:id/runs/:jobId', (req, res) => {
  const p = readPayload();
  const job = (p.runs || []).find((r) => r.jobId === req.params.jobId && r.canvasId === req.params.id);
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  res.json({ job });
});

// GET /api/canvas/:id/runs  → 列出该画布下所有 job（debug 用，按 requestedAt 倒序）
router.get('/:id/runs', (req, res) => {
  const p = readPayload();
  const jobs = (p.runs || [])
    .filter((r) => r.canvasId === req.params.id)
    .sort((a, b) => b.requestedAt - a.requestedAt);
  res.json({ jobs });
});

// =============================================================
// 给前端 polling worker 用的内部接口（不需要鉴权额外限制，已经过 token 中间件）
// =============================================================

// GET /api/canvas/_runs/pending  → 拿所有 pending（前端轮询用）
//                                  注意：路径用 '_runs' 避免和 :id 冲突
// 返回：{ jobs: [{jobId, canvasId, status, requestedAt, leaderId?, leaderHeartbeat?}, ...] }
router.get('/_runs/pending', (_req, res) => {
  const p = readPayload();
  const dead = Date.now() - 30 * 1000; // 30s 心跳超时
  const jobs = (p.runs || []).filter((r) => {
    if (r.status !== 'pending' && r.status !== 'running') return false;
    if (r.status === 'running' && (r.leaderHeartbeat || 0) > dead) return false; // 还在跑且心跳新 → 别人在做
    return true;
  });
  res.json({ jobs });
});

// POST /api/canvas/_runs/:jobId/claim  → 前端 worker 抢锁
// body: { leaderId }
// 返回：{ ok, job? } —— 抢到才返回 job
router.post('/_runs/:jobId/claim', (req, res) => {
  const { leaderId } = req.body || {};
  if (!leaderId) return res.status(400).json({ error: 'missing_field', field: 'leaderId' });
  let claimed = null;
  try {
    mutateStore((payload) => {
      ensureRunsArray(payload);
      const idx = payload.runs.findIndex((r) => r.jobId === req.params.jobId);
      if (idx < 0) throw new Error('job_not_found');
      const j = payload.runs[idx];
      const dead = Date.now() - 30 * 1000;
      // 只有 pending，或者 running 但心跳过期才能抢
      if (j.status === 'running' && (j.leaderHeartbeat || 0) > dead) {
        throw new Error('already_running');
      }
      if (j.status === 'succeeded' || j.status === 'failed') {
        throw new Error('already_finished');
      }
      payload.runs[idx] = {
        ...j,
        status: 'running',
        leaderId,
        leaderHeartbeat: Date.now(),
        startedAt: j.startedAt || Date.now(),
      };
      claimed = payload.runs[idx];
    });
  } catch (e) {
    if (e.message === 'job_not_found') return res.status(404).json({ error: 'job_not_found' });
    if (e.message === 'already_running') return res.status(409).json({ error: 'already_running' });
    if (e.message === 'already_finished') return res.status(409).json({ error: 'already_finished' });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.json({ ok: true, job: claimed });
});

// PATCH /api/canvas/_runs/:jobId  → worker 上报进度 / 心跳
// body: { leaderId, log?: string[]( append), results?: object (merge), status?: 'succeeded'|'failed'|'running', error? }
router.patch('/_runs/:jobId', (req, res) => {
  const { leaderId, log, results, status, error } = req.body || {};
  if (!leaderId) return res.status(400).json({ error: 'missing_field', field: 'leaderId' });
  let updated = null;
  try {
    mutateStore((payload) => {
      ensureRunsArray(payload);
      const idx = payload.runs.findIndex((r) => r.jobId === req.params.jobId);
      if (idx < 0) throw new Error('job_not_found');
      const j = payload.runs[idx];
      if (j.leaderId !== leaderId) throw new Error('not_leader');
      const next = { ...j, leaderHeartbeat: Date.now() };
      if (Array.isArray(log) && log.length) next.log = [...(j.log || []), ...log];
      if (results && typeof results === 'object') next.results = { ...(j.results || {}), ...results };
      if (status) {
        next.status = status;
        if (status === 'succeeded' || status === 'failed') next.completedAt = Date.now();
      }
      if (error !== undefined) next.error = error;
      payload.runs[idx] = next;
      updated = next;
    });
  } catch (e) {
    if (e.message === 'job_not_found') return res.status(404).json({ error: 'job_not_found' });
    if (e.message === 'not_leader') return res.status(409).json({ error: 'not_leader' });
    return res.status(500).json({ error: 'internal', message: e.message });
  }
  res.json({ ok: true, job: updated });
});

export default router;
