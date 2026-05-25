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
// v1.7 P1：server runner 双引擎
import { runCanvas } from '../runner/runCanvas.js';
import { saveRun, getRun, listRuns } from '../runner/runStore.js';
import { emitRunEvent, disposeRunBus } from '../runner/runEvents.js';
// v1.7 P2-A：跨画布引用
import {
  listConnections,
  findConnectionBySrc,
  findConnectionByDst,
  createConnection,
  deleteConnection,
  deliverOutput,
} from '../runner/crossCanvas.js';

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
  crossOutput: {
    description: '跨画布输出（v1.7 P2-A）：把上游内容投递到另一个画布的 crossInput',
    defaultData: { type: 'crossOutput', label: '🌐 跨画布输出', output: '', status: 'idle' },
    notes: '配 connection 后投递；同画布连到 crossInput = 自动触发远端运行（"我在等"开关）',
  },
  crossInput: {
    description: '跨画布输入（v1.7 P2-A）：接收远端画布 crossOutput 的回写',
    defaultData: { type: 'crossInput', label: '🌐 跨画布输入', text: '', status: 'waiting' },
    notes: 'sourceCanvasId/sourceNodeId 由 server 自动填，readonly；用户不能手改 source',
  },
  group: {
    description: '分组容器（把多个节点装一起）',
    defaultData: { type: 'group', label: '功能组', collapsed: false, childCount: 0, status: 'idle' },
    notes: '子节点通过 parentId 挂入并设 extent="parent"',
  },
  pieChart: {
    description: '饼图节点（v1.7 alpha）：把上游 JSON / 表格 / 行式列表渲染成 SVG 饼图',
    defaultData: { type: 'pieChart', label: '🥧 饼图', slices: [], status: 'idle', output: '' },
    notes: '本地解析 [{label,value}] / Markdown 表 / CSV / 行式自然文本，5 种格式宽容',
  },
  barChart: {
    description: '柱状图节点（v1.7 alpha）：本地 SVG 渲染柱条/条形图',
    defaultData: { type: 'barChart', label: '📊 柱状图', bars: [], status: 'idle', output: '' },
    notes: '与饼图同套路，[{label,value}] 数据；ChartStyle 支持 barOrientation/barWidth/showAxis/axisColor',
  },
  extract: {
    description: '数据/样式提取节点（v1.7 alpha）：调 LLM 把任意文本/图片规整成 JSON',
    defaultData: {
      type: 'extract', label: '📊 数据提取',
      mode: 'data',           // 'data' | 'style'
      dataTarget: 'pie',      // pie / bar / line / sankey / generic（mode=data 时）
      model: 'deepseek',
      customModelName: '',
      instruction: '', items: [], status: 'idle', output: '',
    },
    notes: 'mode=data → 选 dataTarget；mode=style → 固定输出 {palette,background,labelColor,borderColor}；含图片必须用 vision 模型',
  },
  genericChart: {
    description: '自由图形节点（v1.7 alpha）：LLM 看参考图 + 数据 → 直接输出 SVG，能模仿任意形态',
    defaultData: {
      type: 'genericChart', label: '🎨 自由图形',
      model: 'kimi', customModelName: '',
      instruction: '', svg: '', status: 'idle', output: '',
    },
    notes: '双输入：data 端口接数据，reference 端口接图片或 ChartStyle JSON；含图必须用 vision 版',
  },
  dashboard: {
    description: '仪表盘节点（v1.7 alpha）：收集 N 个图形节点的 SVG，合成 HTML grid 页面',
    defaultData: {
      type: 'dashboard', label: '📊 仪表盘',
      gridTitle: '', columns: 2, theme: 'light',
      panels: [], output: '', status: 'idle',
    },
    notes: '多输入 target 边：每条上游需含 data.svg（饼图/自由图形）；输出完整 HTML 文档',
  },
};

// =============================================================
// GET /api/canvas/types
// =============================================================
router.get('/types', (_req, res) => {
  res.json({ types: NODE_TYPES_SCHEMA });
});

// =============================================================
// v1.7 P2-A：跨画布引用（Cross-Canvas Reference）
// 必须放在 /:id 之前，否则会被 /:id 拦截
// =============================================================

// GET /api/canvas/connections  → 列所有 connections
// GET /api/canvas/connections?canvasId=xxx → 按画布筛选（asSrc + asDst）
router.get('/connections', (req, res) => {
  if (req.query.canvasId) {
    res.json(listConnections(String(req.query.canvasId)));
  } else {
    const p = readPayload();
    res.json({ connections: p.connections || [] });
  }
});

// GET /api/canvas/connections/by-src?canvasId=&nodeId= → 查某 src 节点的关联
router.get('/connections/by-src', (req, res) => {
  const c = findConnectionBySrc(String(req.query.canvasId), String(req.query.nodeId));
  res.json({ connection: c || null });
});

// GET /api/canvas/connections/by-dst?canvasId=&nodeId=
router.get('/connections/by-dst', (req, res) => {
  const c = findConnectionByDst(String(req.query.canvasId), String(req.query.nodeId));
  res.json({ connection: c || null });
});

// POST /api/canvas/connections
// body: { srcCanvasId, srcNodeId, dstCanvasId, dstNodeId?, srcNodeFallback? }
//   - srcNodeFallback: 当 server 上还没有 srcNode 时（前端 IDB 同步未完成的赛跑场景）
//     用此对象自动 create 一份 src 节点。结构 = {id, type, position, data}
router.post('/connections', (req, res) => {
  const { srcCanvasId, srcNodeId, dstCanvasId, dstNodeId, srcNodeFallback } = req.body || {};
  if (!srcCanvasId || !srcNodeId || !dstCanvasId) {
    return res.status(400).json({ error: 'missing_field', need: ['srcCanvasId', 'srcNodeId', 'dstCanvasId'] });
  }
  try {
    const result = createConnection(srcCanvasId, srcNodeId, dstCanvasId, dstNodeId || null, srcNodeFallback || null);
    res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(400).json({ error: 'create_failed', message: e.message });
  }
});

// DELETE /api/canvas/connections/:connId
router.delete('/connections/:connId', (req, res) => {
  try {
    const removed = deleteConnection(req.params.connId);
    res.json({ ok: true, removed });
  } catch (e) {
    return res.status(404).json({ error: 'not_found', message: e.message });
  }
});

// v1.7 P2-A：前端 ▶️ 跑到 crossOutput 时调这里 → server 写入 dst.crossInput；
// 如同画布连线（"我在等"开关开），还自动 cascade 触发远端画布运行
// body: { srcCanvasId, srcNodeId, content }
router.post('/cross-deliver', async (req, res) => {
  const { srcCanvasId, srcNodeId, content } = req.body || {};
  if (!srcCanvasId || !srcNodeId) {
    return res.status(400).json({ error: 'missing_field', need: ['srcCanvasId', 'srcNodeId'] });
  }
  try {
    const deliver = deliverOutput(srcCanvasId, srcNodeId, content || '');
    if (!deliver.delivered) {
      return res.json({ delivered: false, reason: deliver.reason });
    }
    let cascadeTriggered = false;
    if (deliver.hasInternalWaitEdge) {
      // 异步触发远端画布，立即返回（前端不等远端跑完）
      runCanvasJob(deliver.dstCanvasId, {
        trigger: 'cross-cascade',
        reason: `cross from ${srcCanvasId}/${srcNodeId}`,
      }).catch(() => {/* swallow */});
      cascadeTriggered = true;
    }
    res.json({
      delivered: true,
      dstCanvasId: deliver.dstCanvasId,
      dstNodeId: deliver.dstNodeId,
      hasInternalWaitEdge: deliver.hasInternalWaitEdge,
      cascadeTriggered,
    });
  } catch (e) {
    res.status(500).json({ error: 'internal', message: e.message });
  }
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
// v1.7 alpha P1 第二刀：定时任务 CRUD（schedules）
// 注意：必须在 GET /:id 之前注册，避免 /_schedules 被误吞为 canvasId
// =============================================================
import {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  describeExpr,
} from '../runner/scheduler.js';

router.get('/_schedules', (_req, res) => {
  const schedules = listSchedules().map((s) => ({
    ...s,
    description: describeExpr(s.expr),
  }));
  res.json({ schedules });
});

router.get('/_schedules/:id', (req, res) => {
  const s = getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: 'schedule_not_found' });
  res.json({ schedule: { ...s, description: describeExpr(s.expr) } });
});

router.post('/_schedules', (req, res) => {
  const { canvasId, name, expr, enabled } = req.body || {};
  if (!canvasId || !expr) {
    return res.status(400).json({ error: 'canvasId and expr are required' });
  }
  const payload = readPayload();
  if (!(payload.canvases || []).find((c) => c.id === canvasId && !c.deleted)) {
    return res.status(404).json({ error: 'canvas_not_found' });
  }
  try {
    const sch = createSchedule({ canvasId, name, expr, enabled });
    res.json({ schedule: { ...sch, description: describeExpr(sch.expr) } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/_schedules/:id', (req, res) => {
  const allowedKeys = ['name', 'expr', 'enabled'];
  const patch = {};
  for (const k of allowedKeys) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  try {
    const next = updateSchedule(req.params.id, patch);
    if (!next) return res.status(404).json({ error: 'schedule_not_found' });
    res.json({ schedule: { ...next, description: describeExpr(next.expr) } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/_schedules/:id', (req, res) => {
  const ok = deleteSchedule(req.params.id);
  if (!ok) return res.status(404).json({ error: 'schedule_not_found' });
  res.json({ ok: true });
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

/**
/**
 * 内部函数：在 server 端跑一次画布。POST /:id/run 和跨画布 cascade 都用它。
 * v1.7 alpha：导出供定时调度器调用。
 * @param {string} canvasId
 * @param {{trigger?:string, traceId?:string, traceDepth?:number, subset?:string[], reason?:string, jobId?:string}} opts
 * @returns Promise<{jobId, status, run}>
 */
export async function runCanvasJob(canvasId, opts = {}) {
  const now = Date.now();
  const jobId = opts.jobId || `run-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const traceId = opts.traceId || `trace-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const traceDepth = opts.traceDepth || 0;

  // 拿 snapshot
  const payload = readPayload();
  const c = (payload.canvases || []).find((x) => x.id === canvasId && !x.deleted);
  if (!c) {
    return { jobId, status: 'failed', error: 'canvas_not_found' };
  }
  const canvas = { nodes: c.nodes || [], edges: c.edges || [] };

  // 起 run 记录
  const run = {
    jobId,
    canvasId,
    status: 'running',
    trigger: opts.trigger || 'api',
    reason: opts.reason || null,
    traceId,
    traceDepth,
    requestedAt: now,
    startedAt: now,
    logs: [],
    results: {},
    errors: [],
    nodeStatus: {},
    cascadeTriggered: [], // 此次 run 触发了哪些 cascade 子 run
  };
  saveRun(run);
  // SSE：开始事件
  emitRunEvent(jobId, 'status', { status: 'running' });

  const subsetIds = Array.isArray(opts.subset) && opts.subset.length ? new Set(opts.subset) : undefined;

  try {
    const result = await runCanvas(canvas, {
      subsetIds,
      canvasId,
      traceId,
      traceDepth,
      onLog: (msg) => {
        const ts = new Date().toISOString();
        run.logs.push(`[${ts}] ${msg}`);
        emitRunEvent(jobId, 'log', { ts, msg });
      },
      onNodeStatus: (nodeId, status, dataPatch) => {
        run.nodeStatus[nodeId] = status;
        emitRunEvent(jobId, 'node', { nodeId, status, dataPatch: dataPatch || null });
        if (dataPatch) {
          try {
            mutateStore((payload) => {
              const c = (payload.canvases || []).find((x) => x.id === canvasId);
              if (!c || !Array.isArray(c.nodes)) return;
              const idx = c.nodes.findIndex((n) => n.id === nodeId);
              if (idx < 0) return;
              c.nodes[idx] = {
                ...c.nodes[idx],
                data: { ...c.nodes[idx].data, ...dataPatch, status },
              };
              c.updatedAt = Date.now();
            });
          } catch {/* swallow */}
        } else {
          try {
            mutateStore((payload) => {
              const c = (payload.canvases || []).find((x) => x.id === canvasId);
              if (!c || !Array.isArray(c.nodes)) return;
              const idx = c.nodes.findIndex((n) => n.id === nodeId);
              if (idx < 0) return;
              c.nodes[idx] = {
                ...c.nodes[idx],
                data: { ...c.nodes[idx].data, status },
              };
              c.updatedAt = Date.now();
            });
          } catch {/* swallow */}
        }
      },
      onNodeData: () => {/* noop */},
      onCrossDelivery: async (info) => {
        // 同画布连线触发：远端画布自动跑
        if (!info.hasInternalWaitEdge) return;
        if (traceDepth >= 10) {
          run.logs.push(`[${new Date().toISOString()}]  ⚠️ 跨画布 cascade 已达深度上限 10，停止递归（防循环）`);
          return;
        }
        try {
          // 异步触发，不 await（让当前 run 继续完成自己的下游）
          const subRun = await runCanvasJob(info.dstCanvasId, {
            trigger: 'cross-cascade',
            traceId,
            traceDepth: traceDepth + 1,
            reason: `cross from ${canvasId}/${info.srcNodeId}`,
          });
          run.cascadeTriggered.push({ canvasId: info.dstCanvasId, jobId: subRun.jobId, status: subRun.status });
          run.logs.push(`[${new Date().toISOString()}]  🌐 触发远端画布 ${info.dstCanvasId} → 子 jobId=${subRun.jobId}`);
          emitRunEvent(jobId, 'cascade', { canvasId: info.dstCanvasId, jobId: subRun.jobId, status: subRun.status });
          saveRun(run);
        } catch (e) {
          run.logs.push(`[${new Date().toISOString()}]  ❌ 触发远端画布失败：${e.message}`);
        }
      },
      ctx: {
        webFetchUrl: `http://localhost:${process.env.PORT || 3001}/api/web-fetch`,
        llmChatUrl: `http://localhost:${process.env.PORT || 3001}/api/llm/chat`,
        // 让 chartNodes 能直接读 uploads 目录的图片转 base64（不走 HTTP）
        uploadsDir: process.env.PLOTMESH_UPLOADS_DIR || undefined,
      },
    });
    run.results = result.results;
    run.errors = result.errors;
    run.status = result.ok ? 'succeeded' : 'failed';
    run.completedAt = Date.now();
    saveRun(run);
    emitRunEvent(jobId, 'status', { status: run.status });
  } catch (e) {
    run.status = 'failed';
    run.errors.push({ nodeId: null, error: e.message });
    run.completedAt = Date.now();
    saveRun(run);
    emitRunEvent(jobId, 'status', { status: 'failed', error: e.message });
  }
  // SSE 总线清理（订阅端会先收到最终 status 再断流）
  setTimeout(() => disposeRunBus(jobId), 5000);

  return { jobId, status: run.status, run };
}

// POST /api/canvas/:id/run  → 触发运行（v1.7 P1：server 直接执行；P2-A：支持跨画布 cascade）
router.post('/:id/run', async (req, res) => {
  const { reason, hint, subset, trigger } = req.body || {};
  void hint;
  const canvasId = req.params.id;

  // 简单验证画布存在
  const payload = readPayload();
  const c = (payload.canvases || []).find((x) => x.id === canvasId && !x.deleted);
  if (!c) return res.status(404).json({ error: 'canvas_not_found' });

  // 预分配 jobId 让客户端立刻能订阅 SSE
  const now = Date.now();
  const jobId = `run-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  res.status(202).json({ jobId, status: 'running' });

  // 走内部 helper（异步）
  runCanvasJob(canvasId, {
    jobId,
    trigger: trigger || 'api',
    reason: reason || null,
    subset,
  }).catch(() => {/* 已在 runCanvasJob 内处理写盘 */});
});

// GET /api/canvas/:id/runs/:jobId  → 查运行状态（v1.7 P1：从 runStore 取）
router.get('/:id/runs/:jobId', (req, res) => {
  const run = getRun(req.params.jobId);
  if (!run || run.canvasId !== req.params.id) {
    return res.status(404).json({ error: 'job_not_found' });
  }
  res.json({ job: run });
});

// GET /api/canvas/:id/runs/:jobId/stream  → SSE 实时推送 run 进度（v1.7 alpha P1 第二刀）
router.get('/:id/runs/:jobId/stream', async (req, res) => {
  const { id: canvasId, jobId } = req.params;
  // 路由前置 requireApiToken 已校验 Bearer，这里直接连
  // 设置 SSE 响应头
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 1) 先 dump 现有 run 状态（让晚到的订阅者也能看到完整历史）
  const existing = getRun(jobId);
  if (!existing || existing.canvasId !== canvasId) {
    send('error', { error: 'job_not_found' });
    return res.end();
  }
  send('snapshot', {
    status: existing.status,
    logs: existing.logs || [],
    nodeStatus: existing.nodeStatus || {},
    cascadeTriggered: existing.cascadeTriggered || [],
  });
  // 已结束的 run 不需要订阅，立刻断流
  if (existing.status !== 'running') {
    send('status', { status: existing.status });
    return res.end();
  }

  // 2) 订阅运行中事件
  const { subscribeRun } = await import('../runner/runEvents.js');
  const unsubscribe = subscribeRun(jobId, ({ type, payload }) => {
    send(type, payload);
    // run 终态后自动断流
    if (type === 'status' && payload?.status && payload.status !== 'running') {
      setTimeout(() => res.end(), 200);
    }
  });

  // 3) 心跳，防止某些代理 30s 断连
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// GET /api/canvas/:id/runs  → 列出该画布的最近运行（默认 20 条，元数据，不含 logs/results）
router.get('/:id/runs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const jobs = listRuns(req.params.id, limit);
  res.json({ jobs });
});

// =============================================================
// v1.6 前端 polling worker 接口（v1.7 P1 起前端不再用，但暂留兼容）
// 未来某版本会删除。新代码走 POST /:id/run（server 直接执行）。
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

// =============================================================
// schedules CRUD 已在 GET /:id 之前注册（路由顺序敏感）
// =============================================================

export default router;
