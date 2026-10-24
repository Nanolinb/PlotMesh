/**
 * server/src/runner/chartNodes.js · v1.7 alpha
 * ----------------------------------------------------------------
 * 4 个图形相关节点的 server 端执行函数：extract / pieChart / genericChart / dashboard
 *
 * 这些与 client/src/components/Canvas.tsx 内的 executeFlow 分支保持 1:1 对齐。
 * 改一处必须两边都改。
 *
 * - extract: 调 server LLM，输出 JSON
 * - pieChart: 解析数据 + 离屏渲染 SVG
 * - genericChart: 调 vision LLM 吐 SVG（含图片 base64 内联）
 * - dashboard: 收集上游 data.svg → 拼 HTML grid
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const FILE_PREFIX = '__PM_FILE__\n';
const IMAGES_PREFIX = '__PM_IMAGES__\n';

// =============================================================
// 共享：剥前缀 + 抽图片
// =============================================================

function stripFilePrefix(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  const imgMatch = out.match(/^__PM_IMAGES__\n[^\n]*\n/);
  if (imgMatch) out = out.slice(imgMatch[0].length);
  if (out.startsWith(FILE_PREFIX)) out = out.replace(FILE_PREFIX, '');
  return out;
}

function extractImages(s) {
  if (typeof s !== 'string') return [];
  const m = s.match(/^__PM_IMAGES__\n([^\n]*)\n/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// =============================================================
// pieChart 数据宽容解析（与 client/src/components/nodes/PieChartNode.tsx 一致）
// =============================================================

export function parsePieData(raw) {
  if (raw == null) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = codeBlock ? codeBlock[1].trim() : text;
    let candidate = jsonText;
    if (!/^[[{]/.test(candidate)) {
      const m = jsonText.match(/[[{][\s\S]*[\]}]/);
      if (m) candidate = m[0];
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return parseTextual(text);
    }
  }
  if (Array.isArray(parsed)) {
    const slices = [];
    for (const item of parsed) {
      if (item == null) continue;
      if (typeof item === 'object') {
        const label = String(item.label ?? item.name ?? item.key ?? item[0] ?? '').trim();
        const value = Number(item.value ?? item.v ?? item.count ?? item[1] ?? 0);
        if (label && Number.isFinite(value) && value > 0) slices.push({ label, value });
      } else if (typeof item === 'string') {
        const one = parseLine(item);
        if (one) slices.push(one);
      }
    }
    return slices.length ? slices : null;
  }
  if (typeof parsed === 'object') {
    const slices = [];
    for (const [k, v] of Object.entries(parsed)) {
      const value = Number(v);
      if (k && Number.isFinite(value) && value > 0) slices.push({ label: k, value });
    }
    return slices.length ? slices : null;
  }
  return null;
}

function parseTextual(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.some((l) => /^\|.+\|$/.test(l))) {
    const slices = [];
    for (const line of lines) {
      if (!/^\|.+\|$/.test(line)) continue;
      if (/^\|\s*[:\- ]+\s*\|/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) continue;
      const label = cells[0];
      const value = extractNumber(cells[1]);
      if (label && value != null && value > 0 && !/^[-=:]+$/.test(label)) {
        slices.push({ label, value });
      }
    }
    if (slices.length) return slices;
  }
  if (lines.some((l) => /[,;\t]/.test(l))) {
    const slices = [];
    for (const line of lines) {
      const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
      const cells = line.split(sep).map((c) => c.trim());
      if (cells.length < 2) continue;
      const label = cells[0].replace(/^["']|["']$/g, '');
      const value = extractNumber(cells.slice(1).join(' '));
      if (label && value != null && value > 0) slices.push({ label, value });
    }
    if (slices.length) return slices;
  }
  const slices = [];
  for (const line of lines) {
    const one = parseLine(line);
    if (one) slices.push(one);
  }
  return slices.length ? slices : null;
}

function parseLine(line) {
  let s = line.replace(/^[\s\-*•·]+/, '').replace(/^\d+[.)、]\s*/, '').trim();
  if (!s) return null;
  const value = extractNumber(s);
  if (value == null || value <= 0) return null;
  const m = s.match(/-?\d+(?:\.\d+)?(?!.*-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const idx = m.index ?? -1;
  let label = s.slice(0, idx).replace(/[\s:：=,，\-—––\u00B7]+$/, '').replace(/占$/, '').trim();
  if (!label) {
    label = s.slice(idx + m[0].length).replace(/^[\s:：=,，\-—––\u00B7%个件次台块项条款]+/, '').trim();
  }
  if (!label) return null;
  return { label, value };
}

function extractNumber(s) {
  if (typeof s !== 'string') return null;
  const matches = s.match(/-?\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const v = Number(matches[matches.length - 1]);
  return Number.isFinite(v) ? v : null;
}

// =============================================================
// ChartStyle 解析（同 client/src/types/chartStyle.ts mergeChartStyle）
// =============================================================

const DEFAULT_CHART_STYLE = {
  palette: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'],
  background: 'transparent',
  labelColor: '#ffffff',
  borderColor: '#ffffff',
  borderWidth: 1.5,
  fontFamily: '',
  fontSize: 10,
  radiusRatio: 0.45,
  donut: false,
  innerRadiusRatio: 0.55,
  gapDeg: 0,
  startAngle: 0,
  labelMode: 'inside',
  // bar
  barOrientation: 'vertical',
  barWidth: 0.7,
  showAxis: true,
  axisColor: '#94a3b8',
};

function parseChartStyle(raw) {
  if (raw == null) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = codeBlock ? codeBlock[1].trim() : text;
    let candidate = jsonText;
    if (!/^[[{]/.test(candidate)) {
      const m = jsonText.match(/[[{][\s\S]*[\]}]/);
      if (m) candidate = m[0];
    }
    try { parsed = JSON.parse(candidate); } catch { return null; }
  }
  if (Array.isArray(parsed)) parsed = parsed[0];
  if (!parsed || typeof parsed !== 'object') return null;
  const out = {};
  // palette / colors
  const pal = parsed.palette || parsed.colors;
  if (Array.isArray(pal)) out.palette = pal.filter((c) => typeof c === 'string');
  if (typeof parsed.background === 'string') out.background = parsed.background;
  else if (typeof parsed.bg === 'string') out.background = parsed.bg;
  if (typeof parsed.labelColor === 'string') out.labelColor = parsed.labelColor;
  else if (typeof parsed.textColor === 'string') out.labelColor = parsed.textColor;
  if (typeof parsed.borderColor === 'string') out.borderColor = parsed.borderColor;
  if (typeof parsed.donut === 'boolean') out.donut = parsed.donut;
  const ir = parsed.innerRadiusRatio ?? parsed.innerRadius;
  if (typeof ir === 'number') {
    out.innerRadiusRatio = Math.max(0, Math.min(0.9, ir));
    if (out.donut === undefined && out.innerRadiusRatio > 0) out.donut = true;
  }
  if (typeof parsed.gapDeg === 'number') out.gapDeg = Math.max(0, Math.min(10, parsed.gapDeg));
  if (typeof parsed.startAngle === 'number') out.startAngle = parsed.startAngle % 360;
  if (typeof parsed.labelMode === 'string') {
    const lm = parsed.labelMode.toLowerCase();
    if (['inside', 'outside', 'none'].includes(lm)) out.labelMode = lm;
  }
  // 柱状图扩展
  if (typeof parsed.barOrientation === 'string') {
    const o = parsed.barOrientation.toLowerCase();
    if (o === 'horizontal' || /横/i.test(parsed.barOrientation)) out.barOrientation = 'horizontal';
    else if (o === 'vertical' || /竖|纵/i.test(parsed.barOrientation)) out.barOrientation = 'vertical';
  }
  if (typeof parsed.barWidth === 'number') out.barWidth = Math.max(0.2, Math.min(1.0, parsed.barWidth));
  if (typeof parsed.showAxis === 'boolean') out.showAxis = parsed.showAxis;
  if (typeof parsed.axisColor === 'string') out.axisColor = parsed.axisColor;
  return Object.keys(out).length ? out : null;
}

function mergeStyle(s) {
  return { ...DEFAULT_CHART_STYLE, ...(s || {}) };
}

// =============================================================
// SVG 渲染（与 client/src/utils/svgRenderers.ts 1:1 对齐）
// =============================================================

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  if (Math.abs(endAngle - startAngle - 360) < 0.001) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function ringPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const sweep = endAngle - startAngle;
  if (Math.abs(sweep - 360) < 0.001) {
    return `M ${cx - rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy} Z `
         + `M ${cx - rInner} ${cy} A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy} A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy} Z`;
  }
  const oStart = polar(cx, cy, rOuter, startAngle);
  const oEnd = polar(cx, cy, rOuter, endAngle);
  const iStart = polar(cx, cy, rInner, startAngle);
  const iEnd = polar(cx, cy, rInner, endAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${oStart.x} ${oStart.y} `
       + `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x} ${oEnd.y} `
       + `L ${iEnd.x} ${iEnd.y} `
       + `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x} ${iStart.y} `
       + `Z`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderPieChartSvg(slices, styleIn, opts = {}) {
  const style = mergeStyle(styleIn);
  const width = opts.width ?? 320;
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!slices.length || total <= 0) {
    return `<svg viewBox="0 0 ${width} 80" xmlns="http://www.w3.org/2000/svg"><text x="${width/2}" y="40" text-anchor="middle" fill="#94a3b8" font-size="12">无数据</text></svg>`;
  }
  const chartSize = 280;
  const cx = chartSize / 2;
  const cy = chartSize / 2;
  const r = chartSize * style.radiusRatio;
  const rInner = style.donut ? r * style.innerRadiusRatio : 0;
  const startOffset = style.startAngle || 0;
  const gap = style.gapDeg || 0;
  const wedges = [];
  const labels = [];
  let angle = startOffset;
  slices.forEach((s, i) => {
    const sweep = (s.value / total) * 360;
    const startA = angle;
    const endA = angle + Math.max(0.1, sweep - gap);
    angle += sweep;
    const midA = (startA + endA) / 2;
    const color = style.palette[i % style.palette.length];
    const path = style.donut
      ? ringPath(cx, cy, r, rInner, startA, endA)
      : arcPath(cx, cy, r, startA, endA);
    wedges.push(`<path d="${path}" fill="${color}" stroke="${style.borderColor}" stroke-width="${style.borderWidth}"/>`);
    const percent = ((s.value / total) * 100).toFixed(1);
    if (style.labelMode === 'inside' && parseFloat(percent) >= 6) {
      const innerLabelR = style.donut ? (r + rInner) / 2 : r * 0.65;
      const p = polar(cx, cy, innerLabelR, midA);
      labels.push(`<text x="${p.x}" y="${p.y}" fill="${style.labelColor}" font-size="${style.fontSize}" font-weight="600" text-anchor="middle" dominant-baseline="central">${esc(percent)}%</text>`);
    } else if (style.labelMode === 'outside' && parseFloat(percent) >= 3) {
      const start = polar(cx, cy, r, midA);
      const corner = polar(cx, cy, r + 14, midA);
      const labelP = polar(cx, cy, r + 22, midA);
      const anchor = midA % 360 < 180 ? 'start' : 'end';
      labels.push(`<line x1="${start.x}" y1="${start.y}" x2="${corner.x}" y2="${corner.y}" stroke="${style.labelColor}" stroke-width="1" opacity="0.6"/>`
                + `<text x="${labelP.x}" y="${labelP.y}" fill="${style.labelColor}" font-size="${style.fontSize}" font-weight="600" text-anchor="${anchor}" dominant-baseline="central">${esc(percent)}%</text>`);
    }
  });
  let legendH = 0;
  const legendItems = [];
  const legendY0 = chartSize + 12;
  slices.forEach((s, i) => {
    const color = style.palette[i % style.palette.length];
    const percent = ((s.value / total) * 100).toFixed(1);
    const y = legendY0 + i * 18;
    const legendColor = (style.labelColor === '#ffffff' && style.background === 'transparent') ? '#1e293b' : style.labelColor;
    legendItems.push(
      `<rect x="12" y="${y - 8}" width="10" height="10" fill="${color}" rx="2"/>`
      + `<text x="28" y="${y}" fill="${legendColor}" font-size="11" dominant-baseline="middle">${esc(s.label)} · ${s.value}（${percent}%）</text>`,
    );
  });
  legendH = slices.length * 18 + 16;
  const totalH = chartSize + legendH;
  const titleH = opts.title ? 32 : 0;
  const fullH = totalH + titleH;
  const bg = style.background !== 'transparent'
    ? `<rect x="0" y="0" width="${width}" height="${fullH}" fill="${style.background}"/>`
    : '';
  const titleColor = (style.labelColor === '#ffffff' && style.background === 'transparent') ? '#1e293b' : style.labelColor;
  const titleSvg = opts.title
    ? `<text x="${width / 2}" y="22" text-anchor="middle" fill="${titleColor}" font-size="14" font-weight="600">${esc(opts.title)}</text>`
    : '';
  const chartX = (width - chartSize) / 2;
  return `<svg viewBox="0 0 ${width} ${fullH}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullH}">`
       + bg + titleSvg
       + `<g transform="translate(${chartX}, ${titleH})">${wedges.join('')}${labels.join('')}</g>`
       + `<g transform="translate(0, ${titleH})">${legendItems.join('')}</g>`
       + `</svg>`;
}

/** 柱状图 SVG 渲染（与 client/src/utils/svgRenderers.ts:renderBarChartSvg 一致） */
function renderBarChartSvg(bars, styleIn, opts = {}) {
  const style = mergeStyle(styleIn);
  const width = opts.width ?? 360;
  const height = opts.height ?? 240;
  const horizontal = style.barOrientation === 'horizontal';
  if (!bars.length) {
    return `<svg viewBox="0 0 ${width} 60" xmlns="http://www.w3.org/2000/svg"><text x="${width/2}" y="30" text-anchor="middle" fill="#94a3b8" font-size="12">无数据</text></svg>`;
  }
  const titleH = opts.title ? 28 : 0;
  const padding = { top: 12, right: 16, bottom: 32, left: 48 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - titleH - padding.top - padding.bottom;
  const max = Math.max(...bars.map((b) => b.value));
  const safeMax = max <= 0 ? 1 : max;
  const lc = (style.labelColor === '#ffffff' && style.background === 'transparent') ? '#1e293b' : style.labelColor;
  const ax = style.axisColor || '#94a3b8';
  const bg = style.background !== 'transparent'
    ? `<rect x="0" y="0" width="${width}" height="${height + titleH}" fill="${style.background}"/>` : '';
  const titleSvg = opts.title
    ? `<text x="${width / 2}" y="20" text-anchor="middle" fill="${lc}" font-size="14" font-weight="600">${esc(opts.title)}</text>` : '';
  const cells = []; const labels = []; const valLabels = []; const axes = [];
  const slot = (horizontal ? innerH : innerW) / bars.length;
  const barW = slot * (style.barWidth ?? 0.7);
  const barOffset = (slot - barW) / 2;
  bars.forEach((b, i) => {
    const color = style.palette[i % style.palette.length];
    const ratio = b.value / safeMax;
    if (horizontal) {
      const y = padding.top + i * slot + barOffset;
      const w = innerH > 0 ? Math.max(0, ratio * innerW) : 0;
      const x = padding.left;
      cells.push(`<rect x="${x}" y="${y}" width="${w}" height="${barW}" fill="${color}" stroke="${style.borderColor}" stroke-width="${style.borderWidth}" rx="2"/>`);
      labels.push(`<text x="${padding.left - 6}" y="${y + barW / 2}" text-anchor="end" dominant-baseline="middle" fill="${lc}" font-size="${style.fontSize}">${esc(b.label)}</text>`);
      valLabels.push(`<text x="${x + w + 4}" y="${y + barW / 2}" text-anchor="start" dominant-baseline="middle" fill="${lc}" font-size="${style.fontSize}" font-weight="600">${b.value}</text>`);
    } else {
      const x = padding.left + i * slot + barOffset;
      const h = innerW > 0 ? Math.max(0, ratio * innerH) : 0;
      const y = padding.top + (innerH - h);
      cells.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" stroke="${style.borderColor}" stroke-width="${style.borderWidth}" rx="2"/>`);
      labels.push(`<text x="${x + barW / 2}" y="${padding.top + innerH + 14}" text-anchor="middle" fill="${lc}" font-size="${style.fontSize}">${esc(b.label)}</text>`);
      valLabels.push(`<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="${lc}" font-size="${style.fontSize}" font-weight="600">${b.value}</text>`);
    }
  });
  if (style.showAxis !== false) {
    axes.push(`<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerH}" stroke="${ax}" stroke-width="1"/>`);
    axes.push(`<line x1="${padding.left}" y1="${padding.top + innerH}" x2="${padding.left + innerW}" y2="${padding.top + innerH}" stroke="${ax}" stroke-width="1"/>`);
    if (!horizontal) {
      axes.push(`<text x="${padding.left - 4}" y="${padding.top + 4}" text-anchor="end" dominant-baseline="middle" fill="${ax}" font-size="${(style.fontSize || 10) - 1}">${safeMax}</text>`);
      axes.push(`<text x="${padding.left - 4}" y="${padding.top + innerH}" text-anchor="end" dominant-baseline="middle" fill="${ax}" font-size="${(style.fontSize || 10) - 1}">0</text>`);
    }
  }
  return `<svg viewBox="0 0 ${width} ${height + titleH}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + titleH}">`
       + bg + titleSvg
       + `<g transform="translate(0, ${titleH})">${axes.join('')}${cells.join('')}${labels.join('')}${valLabels.join('')}</g>`
       + `</svg>`;
}

// =============================================================
// SVG sanitize（同 client/src/components/nodes/GenericChartNode.tsx）
// 简化版：用正则白名单（server 端不打 DOMParser）
// =============================================================

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line',
  'polyline', 'polygon', 'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop',
  'pattern', 'mask', 'clipPath', 'filter',
  'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feComposite', 'feBlend',
  'use', 'symbol',
]);

function sanitizeSvgServer(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  // 拆出代码块或裸 SVG
  const fence = s.match(/```(?:html|svg|xml)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('<svg');
  const end = s.lastIndexOf('</svg>');
  if (start < 0 || end < 0) return '';
  s = s.slice(start, end + 6);
  // 删除危险标签
  s = s.replace(/<\/?(?:script|foreignObject|iframe|object|embed|link|meta)[\s\S]*?>/gi, '');
  // 删除 on* 事件属性
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  // 删除 javascript: / data:text/html
  s = s.replace(/\s+(href|xlink:href)\s*=\s*("[^"]*javascript:[^"]*"|'[^']*javascript:[^']*'|"[^"]*data:text\/html[^"]*"|'[^']*data:text\/html[^']*')/gi, '');
  // 删除 style="..." 属性（避免 expression()）
  s = s.replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, '');
  // 黑名单标签兜底
  s = s.replace(/<(\/?)([\w:-]+)([\s\S]*?)>/gi, (m, slash, tag, rest) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    return `<${slash}${tag}${rest}>`;
  });
  return s;
}

// =============================================================
// 节点执行函数
// =============================================================

const VISION_DENY_FAMILIES = ['deepseek'];
const VISION_DEFAULTS = {
  hunyuan: 'hunyuan-vision', glm: 'glm-4v-plus', gpt: 'gpt-4o',
  claude: 'claude-3-5-sonnet-20241022', kimi: 'moonshot-v1-8k-vision-preview',
  qwen: 'qwen-vl-plus',
};
const EXTRACT_SCHEMAS_KEYS = {
  pie: ['label', 'value'],
  bar: ['label', 'value'],
  line: ['name', 'value'],
  sankey: ['source', 'target', 'value'],
  generic: ['name', 'value'],
};

/** 把 server 端 uploads/<file> 读成 base64 data URL（vision API 不接 localhost URL） */
async function loadImageAsDataUrl(img, ctx) {
  // 先尝试本地文件路径
  try {
    const filename = img.filename || img.url?.split('/').pop();
    if (filename) {
      const dataDir = ctx.uploadsDir || path.resolve(process.cwd(), 'uploads');
      const fp = path.join(dataDir, filename);
      if (fs.existsSync(fp)) {
        const buf = fs.readFileSync(fp);
        const mime = img.mime || 'image/png';
        return `data:${mime};base64,${buf.toString('base64')}`;
      }
    }
  } catch {/* fall through to http fetch */}
  // 兜底：HTTP 拉
  const url = img.url?.startsWith('http') ? img.url : `http://localhost:${process.env.PORT || 3001}${img.url}`;
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  const mime = r.headers['content-type'] || img.mime || 'image/png';
  return `data:${mime};base64,${Buffer.from(r.data).toString('base64')}`;
}

/** extract: 调 LLM 把上游文本/图片规整成 JSON */
export async function runExtract(node, _upstreamList, ctx = {}) {
  const d = node.data || {};
  const byHandle = ctx.upstreamByHandle || {};
  // 支持单端口 / 多端口；扁平合并
  const allUp = Object.values(byHandle).flat().map((x) => x.value);
  let upstreamRaw = allUp[0] || '';
  for (const v of allUp.slice(1)) {
    if (v) upstreamRaw = v; // 取最后一个非空（与 client 行为一致）
  }
  const images = extractImages(upstreamRaw);
  const upstream = stripFilePrefix(upstreamRaw);
  const hasText = !!upstream.trim();
  if (!hasText && images.length === 0) {
    return { output: '', status: 'error', error: '上游无输入' };
  }
  const mode = d.mode || (d.schema ? 'data' : 'data');
  const dataTarget = d.dataTarget || (d.schema === 'source-target-value' ? 'sankey' : 'pie');
  const instruction = (d.instruction || '').trim();
  let keys;
  let isObjectShape;
  if (mode === 'style') {
    keys = ['palette', 'background', 'labelColor', 'borderColor', 'donut', 'innerRadiusRatio', 'gapDeg', 'startAngle', 'labelMode'];
    isObjectShape = true;
  } else if (d.schema && d.schema !== 'custom') {
    const map = { 'label-value': ['label', 'value'], 'name-value': ['name', 'value'], 'category-count': ['category', 'count'], 'source-target-value': ['source', 'target', 'value'] };
    keys = map[d.schema] || ['label', 'value'];
    isObjectShape = d.outputShape === 'object';
  } else if (d.schema === 'custom') {
    keys = (d.customKeys || 'label,value').split(',').map((k) => k.trim()).filter(Boolean);
    isObjectShape = d.outputShape === 'object';
  } else {
    keys = EXTRACT_SCHEMAS_KEYS[dataTarget] || ['label', 'value'];
    isObjectShape = false;
  }
  if (keys.length < 2) keys.push('value');
  const model = d.model || 'deepseek';
  let customModelName = (d.customModelName || '').trim();
  if (images.length > 0 && !customModelName && VISION_DEFAULTS[model]) {
    customModelName = VISION_DEFAULTS[model];
  }
  // 模型支持图片检查
  if (images.length > 0 && VISION_DENY_FAMILIES.includes(model) && !customModelName) {
    return { output: '', status: 'error', error: `${model} 不支持图片，请换厂商或填 vision 模型版本` };
  }

  const objSample = mode === 'style'
    ? `{"palette":["#fbbf24","#ef4444","#10b981","#a855f7"],"background":"#1a1a1a","labelColor":"#ffffff","borderColor":"#ffffff","donut":false,"innerRadiusRatio":0,"gapDeg":0,"startAngle":0,"labelMode":"inside"}`
    : `{${keys.map((k, i) => `"${k}": ${i === keys.length - 1 ? 30 : `"示例"`}`).join(', ')}}`;
  const sample = isObjectShape ? objSample : `[${objSample}]`;
  const dataTargetHint = mode === 'data'
    ? ({ pie: '饼图', bar: '柱状图', line: '折线图', sankey: '桑吉图', generic: '通用键值对' })[dataTarget] || ''
    : '';

  const sysPrompt = [
    mode === 'style'
      ? '你是一个图表视觉风格抽取助手。从用户给你的图片或文本中，提炼出可用于绘制饼图/环形图的样式参数，以 JSON 对象返回。'
      : `你是一个数据抽取助手。把用户给你的任意文本（或图片）中蕴含的数据，提炼成一个 JSON 数组${dataTargetHint ? `，用于绘制${dataTargetHint}` : ''}。`,
    isObjectShape
      ? `输出对象必须包含以下键：${keys.map((k) => `"${k}"`).join(', ')}。`
      : `每个数组项必须是包含以下键的对象：${keys.map((k) => `"${k}"`).join(', ')}。`,
    '严格规则：',
    `1. 只输出 ${isObjectShape ? '原始 JSON 对象' : '原始 JSON 数组'}，不要任何解释。`,
    '2. 不要 ```json``` 代码块。',
    mode === 'style' ? '3. 颜色一律 #RRGGBB hex；布尔 true/false。' : '3. 数值字段必须是数字（"30%" → 30）。',
    '4. 字符串保留原文。',
    isObjectShape ? '5. 没数据返回 {}。' : '5. 没数据返回 []。',
    instruction ? `特别指引：${instruction}` : '',
    `示例：${sample}`,
  ].filter(Boolean).join('\n');

  // 构建 user content
  const userTextParts = [];
  if (hasText) userTextParts.push(upstream);
  if (images.length > 0) userTextParts.push(`参考图片 ${images.length} 张，请从中读取数据。`);
  const userText = userTextParts.join('\n\n');
  let userContent = userText;
  if (images.length > 0) {
    const dataUrls = await Promise.all(images.map(async (img) => {
      try {
        const dataUrl = await loadImageAsDataUrl(img, ctx);
        return { ...img, dataUrl };
      } catch { return null; }
    }));
    const valid = dataUrls.filter(Boolean);
    userContent = [
      { type: 'text', text: userText },
      ...valid.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
    ];
  }

  try {
    const r = await axios.post(
      ctx.llmChatUrl || `http://localhost:${process.env.PORT || 3001}/api/llm/chat`,
      {
        model,
        customModelName: customModelName || undefined,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        stream: false,
      },
      { timeout: 120000 },
    );
    const content = r.data?.choices?.[0]?.message?.content || r.data?.content?.[0]?.text || r.data?.output || '';
    if (!content) throw new Error('模型返回空内容');
    // 解析数组或对象
    let candidate = content.trim();
    const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) candidate = fence[1].trim();
    if (!/^[[{]/.test(candidate)) {
      const m = candidate.match(/[[{][\s\S]*[\]}]/);
      if (m) candidate = m[0];
    }
    const parsed = JSON.parse(candidate);
    let arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : null);
    if (!arr || !arr.length) throw new Error(isObjectShape ? '模型输出无法解析为 JSON 对象' : '模型输出无法解析为 JSON 数组');
    // 数值规整
    const normalized = arr.map((item) => {
      if (item && typeof item === 'object') {
        const out = { ...item };
        for (const k of keys) {
          if (['value', 'count', 'amount'].includes(k)) {
            const n = Number(out[k]);
            if (Number.isFinite(n)) out[k] = n;
          }
        }
        return out;
      }
      return item;
    }).filter((x) => x && typeof x === 'object');
    const outValue = isObjectShape ? (normalized[0] || {}) : normalized;
    const out = JSON.stringify(outValue);
    return { output: out, status: 'success', dataPatch: { items: normalized, output: out } };
  } catch (e) {
    const msg = e.response?.data?.error || e.message || '提取失败';
    return { output: '', status: 'error', error: msg };
  }
}

/** pieChart: 解析数据 + 渲染 SVG */
export function runPieChart(node, _upstreamList, ctx = {}) {
  const byHandle = ctx.upstreamByHandle || {};
  // runCanvas 会把无 targetHandle 的旧边统一归入 data。
  const dataItems = (byHandle.data || byHandle.null || []).map((x) => x.value);
  const styleItems = (byHandle.style || []).map((x) => x.value);
  const hasDataConnection = dataItems.length > 0;
  let dataUp = dataItems[0] || '';
  for (const v of dataItems.slice(1)) if (v) dataUp = v;
  let styleUp = styleItems[0] || '';
  for (const v of styleItems.slice(1)) if (v) styleUp = v;

  dataUp = stripFilePrefix(dataUp);
  styleUp = stripFilePrefix(styleUp);
  const slices = parsePieData(dataUp) || (!hasDataConnection ? parsePieData(node.data?.slices) : null);
  const styleIn = styleUp ? parseChartStyle(styleUp) : null;
  if (!slices || slices.length === 0) {
    if (!hasDataConnection) return { output: '', status: 'idle', dataPatch: { error: '' } };
    return { output: '', status: 'error', error: dataUp ? '上游数据不是合法的饼图数据' : '上游节点没有产生可用数据' };
  }
  const label = node.data?.label || '饼图';
  const svg = renderPieChartSvg(slices, styleIn, { title: label });
  const out = JSON.stringify(slices);
  return {
    output: out,
    status: 'success',
    dataPatch: { slices, styleIn: styleIn || undefined, output: out, svg, error: '' },
  };
}

/** barChart: 与 pieChart 同套路 */
export function runBarChart(node, _upstreamList, ctx = {}) {
  const byHandle = ctx.upstreamByHandle || {};
  const dataItems = (byHandle.data || byHandle.null || []).map((x) => x.value);
  const styleItems = (byHandle.style || []).map((x) => x.value);
  const hasDataConnection = dataItems.length > 0;
  let dataUp = dataItems[0] || '';
  for (const v of dataItems.slice(1)) if (v) dataUp = v;
  let styleUp = styleItems[0] || '';
  for (const v of styleItems.slice(1)) if (v) styleUp = v;
  dataUp = stripFilePrefix(dataUp);
  styleUp = stripFilePrefix(styleUp);
  const bars = parsePieData(dataUp) || (!hasDataConnection ? parsePieData(node.data?.bars) : null);
  const styleIn = styleUp ? parseChartStyle(styleUp) : null;
  if (!bars || bars.length === 0) {
    if (!hasDataConnection) return { output: '', status: 'idle', dataPatch: { error: '' } };
    return { output: '', status: 'error', error: dataUp ? '上游数据不是合法的柱状图数据' : '上游节点没有产生可用数据' };
  }
  const label = node.data?.label || '柱状图';
  const svg = renderBarChartSvg(bars, styleIn, { title: label });
  const out = JSON.stringify(bars);
  return {
    output: out,
    status: 'success',
    dataPatch: { bars, styleIn: styleIn || undefined, output: out, svg, error: '' },
  };
}

/** genericChart: 调 vision LLM 吐 SVG */
export async function runGenericChart(node, _upstreamList, ctx = {}) {
  const byHandle = ctx.upstreamByHandle || {};
  const dataItems = (byHandle.data || []).map((x) => x.value);
  const refItems = (byHandle.reference || []).map((x) => x.value);
  let dataRaw = dataItems[0] || '';
  for (const v of dataItems.slice(1)) if (v) dataRaw = v;
  let refRaw = refItems[0] || '';
  for (const v of refItems.slice(1)) if (v) refRaw = v;
  const refImages = extractImages(refRaw);
  const dataText = stripFilePrefix(dataRaw);
  const refText = stripFilePrefix(refRaw);
  if (!dataText.trim() && !refText.trim() && refImages.length === 0) {
    return { output: '', status: 'error', error: '需要数据 + 参考输入' };
  }
  const d = node.data || {};
  const model = d.model || 'kimi';
  let customModelName = (d.customModelName || '').trim();
  if (refImages.length > 0 && !customModelName && VISION_DEFAULTS[model]) {
    customModelName = VISION_DEFAULTS[model];
  }
  const instruction = (d.instruction || '').trim();
  const sysPrompt = [
    '你是一个 SVG 图表生成助手。根据用户给的数据 + 视觉参考（图片或样式 JSON），输出一段完整的 SVG 字符串，模仿参考图的视觉形态。',
    '',
    '严格规则：',
    '1. 只输出原始 <svg ...>...</svg> 字符串，不要解释，不要 markdown 代码块。',
    '2. SVG 必须用 viewBox="0 0 400 280"。',
    '3. 用参考图的配色、形态、布局；用户给的数据是 [{label,value}] 数组。',
    '4. 禁止 <script>, <foreignObject>, <iframe>, <object>，禁止 on* 事件属性，禁止 href="javascript:..."。',
    '5. 文字、标签、图例都直接画在 SVG 里。',
    instruction ? `特别指引：${instruction}` : '',
  ].filter(Boolean).join('\n');
  const userText = `数据：${dataText || '（无）'}\n\n${refText ? `样式参考 JSON：${refText}\n\n` : ''}${refImages.length > 0 ? `参考图片 ${refImages.length} 张如下，请模仿其视觉形态。` : ''}`;
  let userContent = userText;
  if (refImages.length > 0) {
    const dataUrls = await Promise.all(refImages.map(async (img) => {
      try { return { ...img, dataUrl: await loadImageAsDataUrl(img, ctx) }; }
      catch { return null; }
    }));
    const valid = dataUrls.filter(Boolean);
    userContent = [
      { type: 'text', text: userText },
      ...valid.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
    ];
  }
  try {
    const r = await axios.post(
      ctx.llmChatUrl || `http://localhost:${process.env.PORT || 3001}/api/llm/chat`,
      {
        model, customModelName: customModelName || undefined,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.4, stream: false,
      },
      { timeout: 120000 },
    );
    const content = r.data?.choices?.[0]?.message?.content || r.data?.content?.[0]?.text || r.data?.output || '';
    if (!content) throw new Error('模型返回空内容');
    const safeSvg = sanitizeSvgServer(content);
    if (!safeSvg) throw new Error('模型返回的不是合法 SVG');
    return { output: safeSvg, status: 'success', dataPatch: { svg: safeSvg, output: safeSvg } };
  } catch (e) {
    const msg = e.response?.data?.error || e.message || '渲染失败';
    return { output: '', status: 'error', error: msg };
  }
}

/** dashboard: 收集上游 SVG → 拼 HTML grid */
export function runDashboard(node, _upstreamList, ctx = {}) {
  // 需要从 liveNodes（runCanvas 注入）拿上游节点的 data.svg
  const liveNodes = ctx.liveNodes || [];
  const byHandle = ctx.upstreamByHandle || {};
  // v1.7-alpha 后期：layout 端口单独收集成布局参考字符串（不当数据 panel）
  let layoutRaw = '';
  const layoutItems = byHandle.layout || [];
  for (const item of layoutItems) {
    const v = stripFilePrefix(item.value || '');
    if (v) layoutRaw = v;
  }
  // 收集所有非 layout 端口的上游 source id
  const sourceIds = [];
  for (const [handle, list] of Object.entries(byHandle)) {
    if (handle === 'layout') continue;
    for (const item of list) sourceIds.push(item.sourceId);
  }
  const seen = new Set();
  const panels = [];
  for (const sid of sourceIds) {
    if (seen.has(sid)) continue;
    seen.add(sid);
    const src = liveNodes.find((n) => n.id === sid);
    if (!src) continue;
    const svg = src.data?.svg || '';
    if (!svg || typeof svg !== 'string' || !svg.includes('<svg')) continue;
    panels.push({ title: src.data?.label || sid, svg });
  }
  if (panels.length === 0) {
    return { output: '', status: 'error', error: '上游没有可用的图形（饼图/柱状/自由图形 需先成功运行）' };
  }
  const d = node.data || {};
  const layout = layoutRaw ? parseLayout(layoutRaw) : null;
  const html = buildDashboardHtml(panels, {
    title: (d.gridTitle || '').trim() || (d.label || '仪表盘'),
    columns: d.columns || 2,
    theme: d.theme || 'light',
    layout,
  });
  return {
    output: html,
    status: 'success',
    dataPatch: { panels, layoutIn: layout || undefined, output: html },
  };
}

/** 解析仪表盘 layout 字符串（与 client/src/utils/dashboardLayout.ts:parseLayout 对齐） */
function parseLayout(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  let matrix = null;
  // Markdown 表格
  if (lines.some((l) => /^\|.+\|$/.test(l))) {
    matrix = [];
    for (const line of lines) {
      if (!/^\|.+\|$/.test(line)) continue;
      if (/^\|\s*[:\- ]+\s*\|/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map(normalizeLayoutId);
      if (cells.length > 0) matrix.push(cells);
    }
  } else if (lines.every((l) => /^["'].*["']$/.test(l))) {
    // CSS grid-template-areas
    matrix = lines.map((l) => {
      const inner = l.replace(/^["']|["']$/g, '');
      return inner.split(/\s+/).filter(Boolean).map(normalizeLayoutId);
    });
  } else {
    // 行式简写
    matrix = lines.map((l) => l.split(/\s+/).filter(Boolean).map(normalizeLayoutId));
  }
  if (!matrix || !matrix.length) return null;
  const maxCols = Math.max(...matrix.map((r) => r.length));
  if (maxCols === 0) return null;
  const padded = matrix.map((row) => {
    while (row.length < maxCols) row.push('.');
    return row;
  });
  const ids = [];
  for (const row of padded) {
    for (const cell of row) {
      if (cell !== '.' && !ids.includes(cell)) ids.push(cell);
    }
  }
  return {
    rows: padded.length,
    cols: maxCols,
    matrix: padded,
    ids,
    gridTemplateAreas: padded.map((row) => `"${row.join(' ')}"`).join(' '),
  };
}

function normalizeLayoutId(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '.';
  let s = trimmed.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  if (/[\u4e00-\u9fa5]/.test(s)) {
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    s = `c${Math.abs(hash).toString(36)}`;
  }
  if (/^\d/.test(s)) s = 'c' + s;
  return s;
}

/** 与 client/src/components/nodes/DashboardNode.tsx:buildDashboardHtml 对齐 */
function buildDashboardHtml(panels, opts = {}) {
  const cols = Math.max(1, Math.min(4, opts.columns ?? 2));
  const theme = opts.theme ?? 'light';
  const bg = theme === 'dark' ? '#0d0d0d' : '#f8fafc';
  const fg = theme === 'dark' ? '#e2e8f0' : '#1e293b';
  const cardBg = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  const cardBorder = theme === 'dark' ? '#2d2d2d' : '#e2e8f0';
  const title = opts.title || '仪表盘';
  const safeTitle = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const layout = opts.layout || null;
  const cards = panels.map((p, i) => {
    const cardTitle = p.title
      ? String(p.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : `图 ${i + 1}`;
    const cellId = layout ? layout.ids[i] : null;
    const styleAttr = cellId ? ` style="grid-area:${cellId};"` : '';
    return `<div class="card"${styleAttr}><div class="card-title">${cardTitle}</div><div class="card-body">${p.svg}</div></div>`;
  }).join('\n');
  const gridStyle = layout
    ? `grid-template-columns:repeat(${layout.cols},1fr);grid-template-areas:${layout.gridTemplateAreas};`
    : `grid-template-columns:repeat(${cols},1fr);`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;padding:32px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:${bg};color:${fg};}
  .dashboard{max-width:1280px;margin:0 auto;}
  h1{margin:0 0 24px;font-size:24px;font-weight:600;}
  .grid{display:grid;${gridStyle}gap:16px;}
  @media (max-width:768px){.grid{grid-template-columns:1fr;grid-template-areas:none;}.card{grid-area:auto !important;}}
  .card{background:${cardBg};border:1px solid ${cardBorder};border-radius:8px;padding:16px;overflow:hidden;}
  .card-title{font-size:14px;font-weight:600;margin-bottom:12px;color:${fg};opacity:.85;}
  .card-body{width:100%;text-align:center;}
  .card-body svg{max-width:100%;height:auto;}
  .meta{margin-top:24px;font-size:12px;color:${fg};opacity:.5;text-align:center;}
</style>
</head>
<body>
<div class="dashboard">
  <h1>${safeTitle}</h1>
  <div class="grid">${cards}</div>
  <div class="meta">由 PlotMesh 仪表盘节点生成 · ${new Date().toLocaleString('zh-CN')}</div>
</div>
</body>
</html>`;
}
