/**
 * utils/themeMerge.ts · v2.0-β Phase B 步 4
 * ---------------------------------------------------------------
 * 主题合并纯函数：给定一个 merged 主题节点，沿入边找到上游的
 * tone（定调）与 style（样式）节点，合成有效主题对象。
 *
 * 规则：
 *   - 入边 source 是 themeNode 且 role='tone' → 取其 tone/audience/taboo
 *   - 入边 source 是 themeNode 且 role='style' → 取其 palette/font/layout
 *   - 多个同类上游：后者覆盖前者（按 edges 顺序），简单且可预期
 *   - 也支持"链式"：上游 merged 节点的结果可继续往下游传（递归一层即可，避免环）
 */

export interface EffectiveTheme {
  hasTone: boolean;
  hasStyle: boolean;
  sources: number;          // 合并了几个上游节点
  tone: string;
  audience: string;
  taboo: string;
  palette: string;
  font: string;
  layout: string;
}

const EMPTY: EffectiveTheme = {
  hasTone: false, hasStyle: false, sources: 0,
  tone: '', audience: '', taboo: '',
  palette: '', font: '', layout: '',
};

/**
 * 计算某个 merged 主题节点的有效主题。
 * @param mergedNodeId merged 角色的 themeNode id
 * @param nodes 全部节点
 * @param edges 全部边
 */
export function computeEffectiveTheme(
  mergedNodeId: string,
  nodes: any[],
  edges: any[],
): EffectiveTheme {
  const result: EffectiveTheme = { ...EMPTY };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 找所有指向 mergedNodeId 的入边的 source 节点
  const incoming = edges.filter((e) => e.target === mergedNodeId);
  for (const e of incoming) {
    const src = nodeById.get(e.source);
    if (!src || src.data?.type !== 'themeNode') continue;
    const r = src.data.role;
    if (r === 'tone') {
      result.hasTone = true;
      result.sources += 1;
      if (src.data.tone) result.tone = src.data.tone;
      if (src.data.audience) result.audience = src.data.audience;
      if (src.data.taboo) result.taboo = src.data.taboo;
    } else if (r === 'style') {
      result.hasStyle = true;
      result.sources += 1;
      if (src.data.palette) result.palette = src.data.palette;
      if (src.data.font) result.font = src.data.font;
      if (src.data.layout) result.layout = src.data.layout;
    } else if (r === 'merged') {
      // 链式：合并上游 merged 的结果（只递归一层，防环）
      const up = computeUpstreamMergedShallow(src.id, nodes, edges);
      if (up.hasTone) {
        result.hasTone = true; result.sources += 1;
        result.tone = up.tone || result.tone;
        result.audience = up.audience || result.audience;
        result.taboo = up.taboo || result.taboo;
      }
      if (up.hasStyle) {
        result.hasStyle = true; result.sources += 1;
        result.palette = up.palette || result.palette;
        result.font = up.font || result.font;
        result.layout = up.layout || result.layout;
      }
    }
  }

  // 填默认值（仅当有 style 上游但字段空时）
  if (result.hasStyle) {
    result.palette = result.palette || '蓝灰';
    result.font = result.font || '无衬线';
    result.layout = result.layout || '标准';
  }
  return result;
}

/** 浅层合并（不再递归 merged，防止环），供链式场景用 */
function computeUpstreamMergedShallow(
  mergedNodeId: string,
  nodes: any[],
  edges: any[],
): EffectiveTheme {
  const result: EffectiveTheme = { ...EMPTY };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = edges.filter((e) => e.target === mergedNodeId);
  for (const e of incoming) {
    const src = nodeById.get(e.source);
    if (!src || src.data?.type !== 'themeNode') continue;
    const r = src.data.role;
    if (r === 'tone') {
      result.hasTone = true;
      result.tone = src.data.tone || result.tone;
      result.audience = src.data.audience || result.audience;
      result.taboo = src.data.taboo || result.taboo;
    } else if (r === 'style') {
      result.hasStyle = true;
      result.palette = src.data.palette || result.palette;
      result.font = src.data.font || result.font;
      result.layout = src.data.layout || result.layout;
    }
  }
  return result;
}

/** 把有效主题序列化成给子节点看的简短文本（用于 appliedTheme chip / 注入） */
export function themeToSummary(t: EffectiveTheme | null): string {
  if (!t || (!t.hasTone && !t.hasStyle)) return '';
  const parts: string[] = [];
  if (t.hasTone && t.tone) parts.push(t.tone);
  if (t.hasStyle) parts.push(`${t.palette}/${t.font}`);
  return parts.join(' · ');
}
