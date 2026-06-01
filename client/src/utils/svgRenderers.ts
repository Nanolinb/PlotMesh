/**
 * svgRenderers · 纯函数渲染图形为 SVG 字符串
 * ---------------------------------------------------------------
 * 给执行器和仪表盘节点用：可以离屏生成 SVG 字符串而不依赖 React DOM。
 *
 * 设计原则：
 * - 输入 (data + style) → 输出 string，无副作用
 * - 与 PieChartNode 的 JSX 渲染保持视觉一致（同样的 polar/arcPath/ringPath 几何）
 * - SVG 字符串包含 viewBox，可直接嵌入 HTML
 */
import type { ChartStyle } from '../types/chartStyle';
import { mergeChartStyle } from '../types/chartStyle';

type Slice = { label: string; value: number };

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  if (Math.abs(endAngle - startAngle - 360) < 0.001) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function ringPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
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

/** 简单转义文本，防止用户标签里含 < 之类破坏 SVG */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 根据 slices + style 生成完整的 <svg> 字符串。
 * - 包含 viewBox + 背景矩形（如果 style.background 不是 transparent）
 * - 含图例区（数值 + 百分比 + label）
 * - 视觉与 PieChartNode JSX 渲染保持一致
 */
export function renderPieChartSvg(
  slices: Slice[],
  styleIn: ChartStyle | null | undefined,
  opts: { width?: number; showLegend?: boolean; title?: string } = {},
): string {
  const style = mergeChartStyle(styleIn);
  const width = opts.width ?? 320;
  const showLegend = opts.showLegend ?? true;
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!slices.length || total <= 0) {
    return `<svg viewBox="0 0 ${width} 80" xmlns="http://www.w3.org/2000/svg"><text x="${width/2}" y="40" text-anchor="middle" fill="#94a3b8" font-size="12">无数据</text></svg>`;
  }

  // 图区域：280×280；右侧 / 下方 80px 给图例
  const chartSize = 280;
  const cx = chartSize / 2;
  const cy = chartSize / 2;
  const r = chartSize * style.radiusRatio;
  const rInner = style.donut ? r * style.innerRadiusRatio : 0;
  const startOffset = style.startAngle || 0;
  const gap = style.gapDeg || 0;

  const wedges: string[] = [];
  const labels: string[] = [];
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

  // 图例（绝对位置，每行 16px 高）
  let legendH = 0;
  const legendItems: string[] = [];
  if (showLegend) {
    const legendY0 = chartSize + 12;
    slices.forEach((s, i) => {
      const color = style.palette[i % style.palette.length];
      const percent = ((s.value / total) * 100).toFixed(1);
      const y = legendY0 + i * 18;
      legendItems.push(
        `<rect x="12" y="${y - 8}" width="10" height="10" fill="${color}" rx="2"/>`
        + `<text x="28" y="${y}" fill="${style.labelColor === '#ffffff' && style.background === 'transparent' ? '#1e293b' : style.labelColor}" font-size="11" dominant-baseline="middle">${esc(s.label)} · ${s.value}（${percent}%）</text>`,
      );
    });
    legendH = slices.length * 18 + 16;
  }

  const totalH = chartSize + legendH;
  const bg = style.background !== 'transparent'
    ? `<rect x="0" y="0" width="${width}" height="${totalH}" fill="${style.background}"/>`
    : '';
  // 图区在 viewBox 中居中
  const chartX = (width - chartSize) / 2;

  const titleSvg = opts.title
    ? `<text x="${width / 2}" y="22" text-anchor="middle" fill="${style.labelColor === '#ffffff' && style.background === 'transparent' ? '#1e293b' : style.labelColor}" font-size="14" font-weight="600">${esc(opts.title)}</text>`
    : '';
  const titleH = opts.title ? 32 : 0;

  return `<svg viewBox="0 0 ${width} ${totalH + titleH}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH + titleH}">`
       + (bg.replace(`height="${totalH}"`, `height="${totalH + titleH}"`))
       + titleSvg
       + `<g transform="translate(${chartX}, ${titleH})">${wedges.join('')}${labels.join('')}</g>`
       + `<g transform="translate(0, ${titleH})">${legendItems.join('')}</g>`
       + `</svg>`;
}

/**
 * 柱状图 SVG（v1.7-alpha 后期新增）。
 * - 默认竖向（barOrientation='vertical'），数据系列从左到右排列
 * - 'horizontal' 横向条形，从上到下排列
 * - 包含 viewBox + 背景 + 轴线 + 柱 + 顶端数值标签
 */
export function renderBarChartSvg(
  bars: { label: string; value: number }[],
  styleIn: ChartStyle | null | undefined,
  opts: { width?: number; height?: number; title?: string } = {},
): string {
  const style = mergeChartStyle(styleIn);
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
  // 默认在 transparent 背景下用深色文本
  const lc = (style.labelColor === '#ffffff' && style.background === 'transparent') ? '#1e293b' : style.labelColor;
  const ax = style.axisColor || '#94a3b8';

  const bg = style.background !== 'transparent'
    ? `<rect x="0" y="0" width="${width}" height="${height + titleH}" fill="${style.background}"/>`
    : '';
  const titleSvg = opts.title
    ? `<text x="${width / 2}" y="20" text-anchor="middle" fill="${lc}" font-size="14" font-weight="600">${esc(opts.title)}</text>`
    : '';

  const cells: string[] = [];
  const labels: string[] = [];
  const valLabels: string[] = [];
  const axes: string[] = [];
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
      // 类目标签在左侧
      labels.push(`<text x="${padding.left - 6}" y="${y + barW / 2}" text-anchor="end" dominant-baseline="middle" fill="${lc}" font-size="${style.fontSize}">${esc(b.label)}</text>`);
      // 数值标签在柱右端
      valLabels.push(`<text x="${x + w + 4}" y="${y + barW / 2}" text-anchor="start" dominant-baseline="middle" fill="${lc}" font-size="${style.fontSize}" font-weight="600">${b.value}</text>`);
    } else {
      const x = padding.left + i * slot + barOffset;
      const h = innerW > 0 ? Math.max(0, ratio * innerH) : 0;
      const y = padding.top + (innerH - h);
      cells.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" stroke="${style.borderColor}" stroke-width="${style.borderWidth}" rx="2"/>`);
      // 类目标签在底部
      labels.push(`<text x="${x + barW / 2}" y="${padding.top + innerH + 14}" text-anchor="middle" fill="${lc}" font-size="${style.fontSize}">${esc(b.label)}</text>`);
      // 数值标签在柱顶
      valLabels.push(`<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="${lc}" font-size="${style.fontSize}" font-weight="600">${b.value}</text>`);
    }
  });

  if (style.showAxis) {
    if (horizontal) {
      // 左侧竖轴 + 底部横轴
      axes.push(`<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerH}" stroke="${ax}" stroke-width="1"/>`);
      axes.push(`<line x1="${padding.left}" y1="${padding.top + innerH}" x2="${padding.left + innerW}" y2="${padding.top + innerH}" stroke="${ax}" stroke-width="1"/>`);
    } else {
      // 左侧竖轴 + 底部横轴
      axes.push(`<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerH}" stroke="${ax}" stroke-width="1"/>`);
      axes.push(`<line x1="${padding.left}" y1="${padding.top + innerH}" x2="${padding.left + innerW}" y2="${padding.top + innerH}" stroke="${ax}" stroke-width="1"/>`);
      // y 轴最大值刻度
      axes.push(`<text x="${padding.left - 4}" y="${padding.top + 4}" text-anchor="end" dominant-baseline="middle" fill="${ax}" font-size="${(style.fontSize || 10) - 1}">${safeMax}</text>`);
      axes.push(`<text x="${padding.left - 4}" y="${padding.top + innerH}" text-anchor="end" dominant-baseline="middle" fill="${ax}" font-size="${(style.fontSize || 10) - 1}">0</text>`);
    }
  }

  return `<svg viewBox="0 0 ${width} ${height + titleH}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + titleH}">`
       + bg + titleSvg
       + `<g transform="translate(0, ${titleH})">`
       + axes.join('')
       + cells.join('')
       + labels.join('')
       + valLabels.join('')
       + `</g>`
       + `</svg>`;
}
