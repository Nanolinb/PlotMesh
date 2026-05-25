/**
 * Dashboard 布局解析（v1.7.0-alpha 后期）
 * ---------------------------------------------------------------
 * 把用户输入的字符串解析成一个矩阵 + 唯一 cell ID 列表，让仪表盘
 * 节点能按布局把上游图形面板放到对应位置。
 *
 * 支持两种语法（A+B 混合）：
 *   1. Markdown 表格：
 *      | A | A |
 *      |---|---|
 *      | B | C |
 *   2. CSS grid-template-areas（每行用引号包起来）：
 *      "A A"
 *      "B C"
 *   3. 行式简写（每行用空格分隔的 cell）：
 *      A A
 *      B C
 *
 * 解析结果：
 *   {
 *     rows: 2, cols: 2,
 *     matrix: [["A","A"], ["B","C"]],
 *     ids: ["A","B","C"],          // 按首次出现顺序去重
 *     gridTemplateAreas: '"A A" "B C"',   // 直接放 CSS
 *   }
 *
 * 矩阵中的 ID 必须形成"矩形连续区域"才能用 grid-template-areas，
 * 解析时不强制校验（CSS 自己会忽略非法值），但 UI 提示用户尽量规整。
 */

export interface ParsedLayout {
  rows: number;
  cols: number;
  matrix: string[][];      // matrix[r][c] = cell id
  ids: string[];           // 唯一 ID，按首次出现顺序
  gridTemplateAreas: string; // CSS 字符串
}

/**
 * 把字符串规范化成 cell ID（去掉前后空格、特殊字符替换为 _）。
 * grid-template-areas 的 cell 名称只允许字母数字下划线连字符，不能以数字开头。
 */
function normalizeId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '.';  // CSS 中 . 表示空 cell
  // 留有的字符替换
  let s = trimmed.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  // 中文转拼音不靠谱，直接对中文 cell 用 hash 短串
  if (/[\u4e00-\u9fa5]/.test(s)) {
    // 用字符串生成稳定的短 ID
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    s = `c${Math.abs(hash).toString(36)}`;
  }
  // 不能以数字开头
  if (/^\d/.test(s)) s = 'c' + s;
  return s;
}

/**
 * 解析布局字符串。失败返回 null（让仪表盘走默认列布局）。
 */
export function parseLayout(raw: string): ParsedLayout | null {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // 路径 1：Markdown 表格 —— 行首 |，跳过 |---|---| 分隔行
  if (lines.some((l) => /^\|.+\|$/.test(l))) {
    const matrix: string[][] = [];
    for (const line of lines) {
      if (!/^\|.+\|$/.test(line)) continue;
      if (/^\|\s*[:\- ]+\s*\|/.test(line)) continue;  // 跳过 |---|---| 分隔
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => normalizeId(c));
      if (cells.length > 0) matrix.push(cells);
    }
    return matrixToLayout(matrix);
  }

  // 路径 2：CSS grid-template-areas（每行带引号）
  if (lines.every((l) => /^["'].*["']$/.test(l))) {
    const matrix: string[][] = lines.map((l) => {
      const inner = l.replace(/^["']|["']$/g, '');
      return inner.split(/\s+/).filter(Boolean).map(normalizeId);
    });
    return matrixToLayout(matrix);
  }

  // 路径 3：行式简写，空格分隔
  const matrix: string[][] = lines.map((l) => l.split(/\s+/).filter(Boolean).map(normalizeId));
  return matrixToLayout(matrix);
}

function matrixToLayout(matrix: string[][]): ParsedLayout | null {
  if (!matrix.length) return null;
  // 让所有行 cols 一致：补齐到最长行
  const maxCols = Math.max(...matrix.map((r) => r.length));
  if (maxCols === 0) return null;
  const padded = matrix.map((row) => {
    while (row.length < maxCols) row.push('.');
    return row;
  });

  // 唯一 ID 列表（按首次出现顺序，跳过 '.'）
  const ids: string[] = [];
  for (const row of padded) {
    for (const cell of row) {
      if (cell !== '.' && !ids.includes(cell)) ids.push(cell);
    }
  }

  const gridTemplateAreas = padded.map((row) => `"${row.join(' ')}"`).join(' ');

  return {
    rows: padded.length,
    cols: maxCols,
    matrix: padded,
    ids,
    gridTemplateAreas,
  };
}

/**
 * 把上游 panels 映射到 layout 的 cell ID。
 * 策略：按连接顺序，第 i 个 panel 对应 layout.ids[i]。
 * 多余 panel 不展示；layout 中 ID 比 panel 多则该 cell 留空（grid-area 不引用）。
 *
 * 返回的 panels 增加了 `gridArea` 字段供 buildDashboardHtml 写 inline style。
 */
export function applyLayoutToPanels(
  panels: Array<{ title?: string; svg: string }>,
  layout: ParsedLayout,
): Array<{ title?: string; svg: string; gridArea?: string }> {
  return panels.map((p, i) => {
    const id = layout.ids[i];
    return id ? { ...p, gridArea: id } : { ...p };
  });
}
