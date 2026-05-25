/**
 * ChartStyle · 图形节点共享的样式契约（v1.7 alpha）
 * ---------------------------------------------------------------
 * 所有图形节点（PieChart / 未来 BarChart / SankeyChart 等）共用同一份
 * 样式接口，方便用一份样式 JSON 同时驱动多个图。
 *
 * 设计原则：
 *  - 所有字段可选，缺失时 fallback 到节点自己的默认值
 *  - palette 数组循环使用，长度不足时回环
 *  - 颜色统一用 CSS 兼容字符串（hex / rgb / rgba / 颜色名）
 *
 * 数据流约定：
 *  - 用户用 ExtractNode 输出形状=对象 + customKeys=palette,background,...
 *    输出 `{palette:[...], background:"..."}`，连到图形节点的样式端口
 *  - 图形节点合并 props： mergedStyle = { ...defaults, ...incoming }
 */

export interface ChartStyle {
  /** 扇区/柱条颜色循环数组 */
  palette?: string[];
  /** 节点内部画布背景色 */
  background?: string;
  /** 标签文字颜色（扇区上的百分比、柱条上的数字） */
  labelColor?: string;
  /** 边框 / 分隔线颜色（扇区之间的描边） */
  borderColor?: string;
  /** 边框 / 分隔线宽度（px） */
  borderWidth?: number;
  /** 字体（CSS font-family，留空 = 继承节点） */
  fontFamily?: string;
  /** 标签字号（px） */
  fontSize?: number;
  /** 半径占节点最小边的比例（饼图专属，0~0.5）；未来柱图可借用为内边距 */
  radiusRatio?: number;
  // ── 饼图形态扩展（v1.7.0-alpha）──
  /** 环形（donut）模式开关 */
  donut?: boolean;
  /** 环形内圆半径占外半径的比例（0~0.9）。0 = 实心，0.6 = 厚环，0.85 = 细环 */
  innerRadiusRatio?: number;
  /** 扇区之间的间隙角度（度数 0~10）。0 = 紧贴 */
  gapDeg?: number;
  /** 起始角度（度数，0 = 12 点方向，顺时针递增） */
  startAngle?: number;
  /** 标签位置：'inside' 扇区内，'outside' 扇区外带引线，'none' 不显示 */
  labelMode?: 'inside' | 'outside' | 'none';
  // ── 柱状图扩展（v1.7.0-alpha 后期）──
  /** 柱状图方向：'vertical' 默认，'horizontal' 横向条形 */
  barOrientation?: 'vertical' | 'horizontal';
  /** 柱条宽度占类目格的比例 0.2~1.0，默认 0.7 */
  barWidth?: number;
  /** 是否显示坐标轴/刻度线，默认 true */
  showAxis?: boolean;
  /** 坐标轴/网格线颜色 */
  axisColor?: string;
}

/** 默认样式 —— 不传任何参考时的回退值 */
export const DEFAULT_CHART_STYLE: Required<Omit<ChartStyle, 'fontFamily'>> & { fontFamily: string } = {
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
  barOrientation: 'vertical',
  barWidth: 0.7,
  showAxis: true,
  axisColor: '#94a3b8',
};

/**
 * 把上游字符串解析为 ChartStyle。容错策略：
 *   1. 先 JSON.parse（去掉 ```json``` 围栏 + 找首个 [ 或 {）
 *   2. 数组形式：取首项当对象（兼容 ExtractNode 数组输出 + 单 schema 的回退）
 *   3. 对象形式：直接消费
 *   4. 字段名宽容：palette / colors / colorPalette 同义；background / bg 同义；
 *      labelColor / textColor / fontColor 同义
 */
export function parseChartStyle(raw: any): ChartStyle | null {
  if (raw == null) return null;
  let parsed: any = raw;

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = codeBlock ? codeBlock[1].trim() : text;
    let candidate = jsonText;
    if (!/^[\[{]/.test(candidate)) {
      const m = jsonText.match(/[\[{][\s\S]*[\]}]/);
      if (m) candidate = m[0];
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  // 数组首项当对象
  if (Array.isArray(parsed)) {
    if (!parsed.length) return null;
    parsed = parsed[0];
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const out: ChartStyle = {};
  // 颜色调色板（数组，含别名）
  const paletteSrc = parsed.palette ?? parsed.colors ?? parsed.colorPalette ?? parsed.color_palette;
  if (Array.isArray(paletteSrc)) {
    const colors = paletteSrc.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim());
    if (colors.length) out.palette = colors;
  }
  // 单字符串字段
  const pickStr = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  const pickNum = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = parsed[k];
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  const bg = pickStr('background', 'bg', 'backgroundColor');
  if (bg) out.background = bg;
  const labelColor = pickStr('labelColor', 'textColor', 'fontColor', 'label_color');
  if (labelColor) out.labelColor = labelColor;
  const borderColor = pickStr('borderColor', 'strokeColor', 'border_color');
  if (borderColor) out.borderColor = borderColor;
  const borderWidth = pickNum('borderWidth', 'strokeWidth', 'border_width');
  if (borderWidth != null) out.borderWidth = borderWidth;
  const fontFamily = pickStr('fontFamily', 'font', 'font_family');
  if (fontFamily) out.fontFamily = fontFamily;
  const fontSize = pickNum('fontSize', 'font_size');
  if (fontSize != null) out.fontSize = fontSize;
  const radiusRatio = pickNum('radiusRatio', 'radius_ratio', 'radius');
  if (radiusRatio != null) out.radiusRatio = Math.max(0.1, Math.min(0.5, radiusRatio));

  // 形态扩展
  const donutRaw = parsed.donut ?? parsed.isDonut ?? parsed.is_donut;
  if (typeof donutRaw === 'boolean') out.donut = donutRaw;
  else if (typeof donutRaw === 'string') out.donut = /^(true|yes|1|on)$/i.test(donutRaw);

  const innerRatio = pickNum('innerRadiusRatio', 'inner_radius_ratio', 'innerRadius', 'donutWidth');
  if (innerRatio != null) {
    // 自动判断：填了 innerRadiusRatio > 0 视为 donut
    out.innerRadiusRatio = Math.max(0, Math.min(0.9, innerRatio));
    if (out.donut === undefined && out.innerRadiusRatio > 0) out.donut = true;
  }

  const gap = pickNum('gapDeg', 'gap_deg', 'gap', 'sliceGap');
  if (gap != null) out.gapDeg = Math.max(0, Math.min(10, gap));

  const startAngle = pickNum('startAngle', 'start_angle', 'startDeg');
  if (startAngle != null) out.startAngle = startAngle % 360;

  const labelMode = pickStr('labelMode', 'label_mode', 'labelPosition', 'label_position');
  if (labelMode) {
    const lm = labelMode.toLowerCase();
    if (lm === 'inside' || lm === 'outside' || lm === 'none') out.labelMode = lm as any;
    else if (/外|outer|outside/i.test(labelMode)) out.labelMode = 'outside';
    else if (/内|inner|inside/i.test(labelMode)) out.labelMode = 'inside';
    else if (/无|hide|none|off/i.test(labelMode)) out.labelMode = 'none';
  }

  // 柱状图扩展
  const orient = pickStr('barOrientation', 'orientation', 'direction');
  if (orient) {
    const o = orient.toLowerCase();
    if (o === 'vertical' || /竖|纵|垂直|column/i.test(orient)) out.barOrientation = 'vertical';
    else if (o === 'horizontal' || /横|水平/i.test(orient)) out.barOrientation = 'horizontal';
  }
  const barW = pickNum('barWidth', 'bar_width');
  if (barW != null) out.barWidth = Math.max(0.2, Math.min(1.0, barW));
  const showAxisRaw = parsed.showAxis ?? parsed.show_axis ?? parsed.axis;
  if (typeof showAxisRaw === 'boolean') out.showAxis = showAxisRaw;
  const axisColor = pickStr('axisColor', 'axis_color', 'gridColor');
  if (axisColor) out.axisColor = axisColor;

  return Object.keys(out).length ? out : null;
}

/** 合并样式：upstream + node-default + global-default。后写覆盖前写。 */
export function mergeChartStyle(upstream: ChartStyle | null | undefined, nodeDefault?: ChartStyle): Required<ChartStyle> {
  return {
    ...DEFAULT_CHART_STYLE,
    ...(nodeDefault || {}),
    ...(upstream || {}),
  } as Required<ChartStyle>;
}
