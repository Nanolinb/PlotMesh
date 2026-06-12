/**
 * 一次性脚本：创建《使用案例》项目 + 若干样板画布，写入 store.json。
 * 样板覆盖 v2.0 新功能，供团队学习参考。
 * 运行：node scripts/seed-usecases.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const STORE = path.join(os.homedir(), '.plotmesh', 'store.json');
const OWNER = 'user-mq4tfhyx-3b840a'; // pmtest@plotmesh.dev
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now.toString(36)}-${(seq++).toString(36)}`;

const EDGE_STYLE = { markerEnd: { type: 'arrowclosed', color: '#6366f1' }, style: { stroke: '#6366f1', strokeWidth: 2 } };
const mkEdge = (source, target, extra = {}) => ({
  id: uid('edge'), source, target, sourceHandle: null, targetHandle: null, ...EDGE_STYLE, ...extra,
});

/** 节点工厂：合并 getDefaultData 的形状 */
const mkNode = (type, x, y, data, extra = {}) => ({
  id: extra.id || uid(type),
  type,
  position: { x, y },
  data: { type, status: 'idle', ...data },
  ...extra,
});

/* ── 样板 1：文本提示词「编号顺序合并」───────────────────────── */
function canvasNumberedMerge() {
  const p1 = mkNode('textPrompt', 40, 40, { label: '#1 角色设定', text: '你是一名资深产品经理。', promptNumber: 1 });
  const p2 = mkNode('textPrompt', 40, 200, { label: '#2 任务', text: '请为「智能水杯」写 3 条卖点。', promptNumber: 2 });
  const p3 = mkNode('textPrompt', 40, 360, { label: '#3 风格', text: '语气专业、每条不超过 20 字。', promptNumber: 3 });
  const llm = mkNode('llm', 420, 180, { label: '大模型', model: 'deepseek' });
  const out = mkNode('output', 800, 180, { label: '卖点输出', format: 'markdown' });
  return {
    name: '① 文本提示词·编号顺序合并',
    nodes: [p1, p2, p3, llm, out],
    edges: [mkEdge(p1.id, llm.id), mkEdge(p2.id, llm.id), mkEdge(p3.id, llm.id), mkEdge(llm.id, out.id)],
    note: '三个文本提示词标了 #1/#2/#3，运行时按编号顺序拼接喂给大模型——编号即合并顺序。',
  };
}

/* ── 样板 2：成品聚合节点 → 一键导出 PPT ──────────────────────── */
function canvasAggregate() {
  const s1 = mkNode('textPrompt', 40, 40, { label: '市场分析', text: '# 市场分析\n- 目标人群：25-35 岁白领\n- 市场规模：120 亿\n- 年增速：18%', promptNumber: 1 });
  const s2 = mkNode('textPrompt', 40, 230, { label: '竞品对比', text: '# 竞品对比\n- A 品牌：价高功能全\n- B 品牌：性价比\n- 我们：智能 + 设计', promptNumber: 2 });
  const s3 = mkNode('textPrompt', 40, 420, { label: '推广策略', text: '# 推广策略\n- 小红书种草\n- 抖音达人测评\n- 私域复购', promptNumber: 3 });
  const agg = mkNode('aggregate', 460, 230, { label: '📦 成品汇总', docTitle: '智能水杯营销方案', format: 'pptx' });
  return {
    name: '② 成品聚合·一键导出 PPT',
    nodes: [s1, s2, s3, agg],
    edges: [mkEdge(s1.id, agg.id), mkEdge(s2.id, agg.id), mkEdge(s3.id, agg.id)],
    note: '三段内容连进「成品汇总」，每段=一页幻灯（用上游名作页标题）。运行后在节点上选格式点导出，得到 PPT/PDF/Word。',
  };
}

/* ── 样板 3：AI 构建器 ──────────────────────────────────────── */
function canvasAIBuilder() {
  const ai = mkNode('aiBuilder', 200, 120, {
    label: '🤖 AI 构建器',
    prompt: '帮我搭一个「抓取网页→提炼要点→输出 Markdown」的流程',
    contextScope: 'canvas', model: 'deepseek',
  });
  return {
    name: '③ AI 构建器·让 AI 帮你搭流程',
    nodes: [ai],
    edges: [],
    note: '在 AI 构建器里写一句需求 → 生成结构方案（dry-run 半透明预览）→ 点✓一键落盘，可一步撤销。勾上「自动挂输出节点」会给每个结论节点配一个输出。',
  };
}

/* ── 样板 4：数据提取 → 图形 → 仪表盘 ─────────────────────────── */
function canvasChart() {
  const src = mkNode('textPrompt', 40, 120, { label: '原始数据', text: '一季度各区销售：华东 320 万，华南 210 万，华北 180 万，西部 90 万', promptNumber: 1 });
  const ext = mkNode('extract', 380, 120, { label: '📊 数据提取', mode: 'data', dataTarget: 'pie', model: 'deepseek' });
  const pie = mkNode('pieChart', 720, 40, { label: '🥧 饼图' });
  const bar = mkNode('barChart', 720, 240, { label: '📊 柱状图' });
  const dash = mkNode('dashboard', 1060, 120, { label: '📊 仪表盘', columns: 2, theme: 'light' });
  return {
    name: '④ 数据提取·图形可视化·仪表盘',
    nodes: [src, ext, pie, bar, dash],
    edges: [mkEdge(src.id, ext.id), mkEdge(ext.id, pie.id), mkEdge(ext.id, bar.id), mkEdge(pie.id, dash.id), mkEdge(bar.id, dash.id)],
    note: '自由文本经「数据提取」规整成 JSON，同时喂给饼图和柱图（本地 SVG，0 token），再用仪表盘合成一个 HTML 页面。',
  };
}

/* ── 样板 5：主题节点（定调 × 样式 广播）──────────────────────── */
function canvasTheme() {
  const tone = mkNode('themeNode', 40, 40, { label: '🎨 定调', role: 'tone', tone: '专业严谨', audience: '企业客户', taboo: '夸张,绝对化' });
  const style = mkNode('themeNode', 40, 240, { label: '🎨 样式', role: 'style', palette: '科技紫', font: '无衬线', layout: '标准' });
  const merged = mkNode('themeNode', 400, 140, { label: '🎨 合并主题', role: 'merged', effectiveTheme: null });
  const prompt = mkNode('textPrompt', 400, 320, { label: '内容', text: '介绍我们的企业级数据中台。', promptNumber: 1 });
  const llm = mkNode('llm', 760, 220, { label: '大模型', model: 'deepseek' });
  const out = mkNode('output', 1100, 220, { label: '输出', format: 'markdown' });
  return {
    name: '⑤ 主题节点·定调×样式广播',
    nodes: [tone, style, merged, prompt, llm, out],
    edges: [mkEdge(tone.id, merged.id), mkEdge(style.id, merged.id), mkEdge(merged.id, llm.id), mkEdge(prompt.id, llm.id), mkEdge(llm.id, out.id)],
    note: '「定调」（管理者）×「样式」（设计师）合并成有效主题，沿连线广播给下游 LLM / 输出节点，子节点显示 🎨 主题 chip。',
  };
}

const BUILDERS = [canvasNumberedMerge, canvasAggregate, canvasAIBuilder, canvasChart, canvasTheme];

/* ── 写入 store.json ──────────────────────────────────────── */
const raw = fs.readFileSync(STORE, 'utf8');
const store = JSON.parse(raw);
const payload = store.payload;
payload.projects = payload.projects || [];
payload.canvases = payload.canvases || [];

const projectId = `proj-usecases-${now.toString(36)}`;
payload.projects.push({
  id: projectId,
  name: '使用案例',
  description: 'v2.0 新功能样板画布合集，供团队学习参考',
  color: '#0ea5e9',
  ownerId: OWNER,
  flexPool: [{ userId: OWNER, role: 'owner', joinedAt: now }],
  folders: [],
  canvasFolderMap: {},
  createdAt: now,
  updatedAt: now,
});

const created = [];
for (const build of BUILDERS) {
  const c = build();
  const canvasId = uid('canvas');
  // 在画布左上角放一个说明便签（用一个 textPrompt 当注释，编号 0 不参与主流程也无妨——这里用 note 写进画布名足够）
  payload.canvases.push({
    id: canvasId,
    workspaceId: 'workspace-default',
    projectId,
    name: c.name,
    nodes: c.nodes,
    edges: c.edges,
    createdAt: now,
    updatedAt: now,
  });
  created.push({ id: canvasId, name: c.name, nodes: c.nodes.length, note: c.note });
}

store.version = (store.version || 0) + 1;
store.updatedAt = new Date().toISOString();

const tmp = STORE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
fs.renameSync(tmp, STORE);

console.log('✅ 项目《使用案例》已创建 id=' + projectId);
console.log('✅ 样板画布 ' + created.length + ' 张：');
for (const c of created) console.log(`   - ${c.name}（${c.nodes} 节点）`);
