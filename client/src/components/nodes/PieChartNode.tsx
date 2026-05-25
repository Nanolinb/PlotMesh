/**
 * PieChartNode · 饼图节点（试验性，v1.7.0-alpha 增量）
 * ---------------------------------------------------------------
 * 把上游传来的 JSON 数据可视化成饼图。
 *
 * v1.7 alpha 升级：双输入端
 *   - 左侧上端口（id="data"）：数据，[{label,value}] 或宽容文本格式
 *   - 左侧下端口（id="style"）：样式参考 ChartStyle JSON（来自 ExtractNode object 模式）
 *
 * 数据约定（兼容多种上游格式）：
 *   1) [{label:'A', value:30}, {label:'B', value:70}]      // 标准
 *   2) [{name:'A', value:30}, ...]                          // name 同义
 *   3) {A: 30, B: 70}                                       // 对象 key=label, value=数值
 *   4) "```json [...]```" 包裹的代码块 / 任意位置的 JSON 也会尝试提取
 *
 * 渲染：纯 SVG，无外部依赖。样式优先级 = upstream(style) > nodeDefault > globalDefault
 *
 * 输出（给下游）：
 *   - 节点自身 results.set(nodeId, JSON.stringify(parsedSlices))
 *     —— 透传规整化后的数据，方便下游再处理（比如再做柱状图、表格输出）
 *
 * 关键点：
 *   - 解析失败时 status='error'，节点显示提示，不崩
 *   - 颜色循环 8 色板，超出后回环
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNodeStore } from '../../store/nodes';
import { mergeChartStyle, type ChartStyle } from '../../types/chartStyle';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

type Slice = { label: string; value: number };

// 老 PALETTE 已迁到 types/chartStyle.ts 的 DEFAULT_CHART_STYLE.palette

/**
 * 把任意上游字符串/对象解析成 Slice[]。失败返回 null。
 *
 * 解析优先级（容错按顺序尝试，第一个成功即返回）：
 *   1. JSON：原生数组 / 对象 / ```json``` 代码块 / 文本里嵌的 [...] {...}
 *   2. Markdown 表格：`| 类别 | 数量 |` 风格，第 1/2 列当 label/value
 *   3. CSV / TSV：逗号或 Tab 分隔，前两列当 label/value
 *   4. 行式自然文本：每行一项，常见分隔符 `:` `=` `,` ` - ` ` ` 多空格
 *      支持 "苹果 30" / "苹果: 30" / "苹果 30%" / "苹果 - 30 个" / "苹果占 30"
 *
 * value 提取始终用「行内最后一段连续数字」兜底，所以 "30 个" "30%" "三十" 之类
 * 数字带后缀也能识别（不识别中文数字，只识别阿拉伯数字 + 可选小数）。
 */
export function parsePieData(raw: any): Slice[] | null {
  if (raw == null) return null;

  // ── 1. JSON 路径 ──
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
      // JSON 失败 → 走文本路径
      const fromText = parseTextual(text);
      return fromText && fromText.length ? fromText : null;
    }
  }

  // 数组对象统一处理
  if (Array.isArray(parsed)) {
    const slices: Slice[] = [];
    for (const item of parsed) {
      if (item == null) continue;
      if (typeof item === 'object') {
        const label = String(item.label ?? item.name ?? item.key ?? item[0] ?? '').trim();
        const value = Number(item.value ?? item.v ?? item.count ?? item[1] ?? 0);
        if (label && Number.isFinite(value) && value > 0) {
          slices.push({ label, value });
        }
      } else if (typeof item === 'string') {
        // ["苹果 30","香蕉 50"] 这种数组里嵌字符串
        const one = parseLineToSlice(item);
        if (one) slices.push(one);
      }
    }
    return slices.length ? slices : null;
  }

  if (typeof parsed === 'object') {
    const slices: Slice[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      const value = Number(v as any);
      if (k && Number.isFinite(value) && value > 0) {
        slices.push({ label: k, value });
      }
    }
    return slices.length ? slices : null;
  }

  return null;
}

/**
 * 文本路径：尝试 Markdown 表格 → CSV/TSV → 行式自然文本
 */
function parseTextual(text: string): Slice[] | null {
  // 1. Markdown 表格 —— 行首 | 字符开头
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.some((l) => /^\|.+\|$/.test(l))) {
    const slices: Slice[] = [];
    for (const line of lines) {
      if (!/^\|.+\|$/.test(line)) continue;
      // 跳过分隔行 |---|---|
      if (/^\|\s*[:\- ]+\s*\|/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) continue;
      const label = cells[0];
      const value = extractNumber(cells[1]);
      if (label && value != null && value > 0 && !/^[-=:]+$/.test(label)) {
        // 跳过 "类别 / 数量" 之类表头：第一行如果 value 解析失败就当表头
        slices.push({ label, value });
      }
    }
    if (slices.length) return slices;
  }

  // 2. CSV / TSV
  if (lines.length >= 1 && lines.some((l) => /[,;\t]/.test(l))) {
    const slices: Slice[] = [];
    for (const line of lines) {
      const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
      const cells = line.split(sep).map((c) => c.trim());
      if (cells.length < 2) continue;
      const label = cells[0].replace(/^["']|["']$/g, '');
      const value = extractNumber(cells.slice(1).join(' '));
      if (label && value != null && value > 0) {
        slices.push({ label, value });
      }
    }
    if (slices.length) return slices;
  }

  // 3. 行式自然文本兜底
  const slices: Slice[] = [];
  for (const line of lines) {
    const one = parseLineToSlice(line);
    if (one) slices.push(one);
  }
  return slices.length ? slices : null;
}

/**
 * 单行 → Slice。"苹果 30" / "苹果: 30%" / "1. 苹果 - 30 个" 都接受。
 * 策略：剥离序号前缀 → 提取行内最后一个数字当 value → 剩余非数字部分当 label
 */
function parseLineToSlice(line: string): Slice | null {
  // 剥离 "1. " "1) " "- " "* " "• " 等前缀
  let s = line.replace(/^[\s\-*•·]+/, '').replace(/^\d+[\.\)、]\s*/, '').trim();
  if (!s) return null;
  const value = extractNumber(s);
  if (value == null || value <= 0) return null;
  // label = 去除最后一个数字段及紧邻的分隔符 / 单位
  // 找最后一段数字（含小数）的位置
  const m = s.match(/-?\d+(?:\.\d+)?(?!.*-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const idx = m.index ?? -1;
  // label 是数字之前的内容，去掉尾部分隔符（: = , - 中文冒号、空格、占）
  let label = s.slice(0, idx).replace(/[\s:：=,，\-—––\u00B7]+$/, '').replace(/占$/, '').trim();
  // 如果 label 为空，可能是 "30 苹果" 这种逆序，取数字之后的内容
  if (!label) {
    label = s.slice(idx + m[0].length).replace(/^[\s:：=,，\-—––\u00B7%个件次台块项条款]+/, '').trim();
  }
  if (!label) return null;
  return { label, value };
}

/** 从字符串里提取最后一个有效数字（含小数），兼容 "30%" "30 个" "约 30" */
function extractNumber(s: string): number | null {
  if (typeof s !== 'string') return null;
  // 取所有数字段，返回最后一个
  const matches = s.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  const v = Number(matches[matches.length - 1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * 极坐标转笛卡尔，cx/cy 圆心，r 半径，angleDeg 0=12 点方向
 */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * 一个扇区的 SVG path。startAngle/endAngle 都是度数，0 在 12 点方向，顺时针递增。
 * 当 endAngle - startAngle === 360（独占）时退化为整圆。
 */
function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  if (Math.abs(endAngle - startAngle - 360) < 0.001) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

/**
 * 环形扇区 path（donut wedge）：外圆顺时针 → 内圆逆时针 → 闭合。
 * rOuter > rInner > 0。
 */
function ringPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const sweep = endAngle - startAngle;
  if (Math.abs(sweep - 360) < 0.001) {
    // 整圆环：用 evenodd 双圆套
    return `M ${cx - rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy} Z `
         + `M ${cx - rInner} ${cy} A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy} A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy} Z`;
  }
  const oStart = polar(cx, cy, rOuter, startAngle);
  const oEnd = polar(cx, cy, rOuter, endAngle);
  const iStart = polar(cx, cy, rInner, startAngle);
  const iEnd = polar(cx, cy, rInner, endAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  // 外圆顺时针 sweep=1，内圆逆时针 sweep=0
  return `M ${oStart.x} ${oStart.y} `
       + `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x} ${oEnd.y} `
       + `L ${iEnd.x} ${iEnd.y} `
       + `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x} ${iStart.y} `
       + `Z`;
}

function PieChartNode({ id, data, selected }: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '饼图');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalTitle(data.label || '饼图'); }, [data.label]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '饼图');
  }, [id, localTitle, updateNodeData, data.label]);

  // data.slices 是执行器解析后存进来的 Slice[]；也可能没有（未运行）
  const slices: Slice[] = useMemo(() => {
    if (Array.isArray(data.slices)) return data.slices;
    return [];
  }, [data.slices]);

  // v1.7 alpha：从 style 端口流入的样式（执行器写到 data.styleIn）
  const mergedStyle = useMemo(
    () => mergeChartStyle(data.styleIn as ChartStyle | null | undefined),
    [data.styleIn],
  );

  const total = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);

  // SVG 尺寸：固定 220x220，边距 10（外标签可能溢出，加点 padding）
  const SIZE = 220;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * mergedStyle.radiusRatio;
  // 环形内圆半径（仅 donut 模式）
  const rInner = mergedStyle.donut ? r * mergedStyle.innerRadiusRatio : 0;

  // 计算每个扇区的 path & 颜色
  const wedges = useMemo(() => {
    if (!slices.length || total <= 0) return [];
    const startOffset = mergedStyle.startAngle || 0;
    const gap = mergedStyle.gapDeg || 0;
    let angle = startOffset;
    return slices.map((s, i) => {
      const sweep = (s.value / total) * 360;
      const startA = angle;
      // 扣掉 gap，让出间隙；如果 sweep 太小被 gap 吃光，退化成几乎不可见的薄片
      const endA = angle + Math.max(0.1, sweep - gap);
      angle += sweep;  // 角度推进按完整 sweep（不含 gap，下一段的 startA 是这段的 endA + gap）
      const midA = (startA + endA) / 2;
      // 内嵌标签：环形时贴在环中线，实心时贴在 65% 半径
      const innerLabelR = mergedStyle.donut ? (r + rInner) / 2 : r * 0.65;
      const innerLabel = polar(cx, cy, innerLabelR, midA);
      // 外置标签：在外圆外的引线
      const outerEnd = polar(cx, cy, r, midA);
      const outerTip = polar(cx, cy, r + 14, midA);
      const outerLabel = polar(cx, cy, r + 22, midA);
      return {
        path: mergedStyle.donut
          ? ringPath(cx, cy, r, rInner, startA, endA)
          : arcPath(cx, cy, r, startA, endA),
        color: mergedStyle.palette[i % mergedStyle.palette.length],
        label: s.label,
        value: s.value,
        percent: ((s.value / total) * 100).toFixed(1),
        innerLabelX: innerLabel.x,
        innerLabelY: innerLabel.y,
        // 引线：圆边 → 圆外延伸 14px，再水平拉到 labelX
        leadStart: outerEnd,
        leadCorner: outerTip,
        outerLabelX: outerLabel.x,
        outerLabelY: outerLabel.y,
        outerLabelAnchor: midA % 360 < 180 ? 'start' : 'end',
      };
    });
  }, [slices, total, mergedStyle, cx, cy, r, rInner]);

  const status = data.status || 'idle';
  const errorMsg = data.error || '';

  return (
    <div className={`node-card pie-chart-node ${selected ? 'selected' : ''}`} data-status={status}>
      {/* 双输入：上=数据，下=样式 */}
      <Handle type="target" position={Position.Left} id="data" style={{ top: '35%', background: '#6366f1' }} title="数据输入（[{label,value}] 等）" />
      <Handle type="target" position={Position.Left} id="style" style={{ top: '70%', background: '#a855f7' }} title="样式参考（ChartStyle JSON）" />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
        <span className="node-icon">🥧</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '饼图'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '饼图'}
          </span>
        )}
      </div>

      <div
        className="node-body"
        style={{
          padding: '8px',
          background: mergedStyle.background !== 'transparent' ? mergedStyle.background : undefined,
          fontFamily: mergedStyle.fontFamily || undefined,
        }}
      >
        {wedges.length > 0 ? (
          <>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: 'block', margin: '0 auto' }}>
              {wedges.map((w, i) => (
                <g key={i}>
                  <path
                    d={w.path}
                    fill={w.color}
                    stroke={mergedStyle.borderColor}
                    strokeWidth={mergedStyle.borderWidth}
                  />
                  {/* 标签：根据 labelMode 渲染 */}
                  {mergedStyle.labelMode === 'inside' && parseFloat(w.percent) >= 6 && (
                    <text
                      x={w.innerLabelX}
                      y={w.innerLabelY}
                      fill={mergedStyle.labelColor}
                      fontSize={mergedStyle.fontSize}
                      fontWeight="600"
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ pointerEvents: 'none' }}
                    >
                      {w.percent}%
                    </text>
                  )}
                  {mergedStyle.labelMode === 'outside' && parseFloat(w.percent) >= 3 && (
                    <>
                      {/* 引线：从扇区外缘 → 外延一点 → 文字位置 */}
                      <line
                        x1={w.leadStart.x}
                        y1={w.leadStart.y}
                        x2={w.leadCorner.x}
                        y2={w.leadCorner.y}
                        stroke={mergedStyle.labelColor}
                        strokeWidth={1}
                        opacity={0.6}
                      />
                      <text
                        x={w.outerLabelX}
                        y={w.outerLabelY}
                        fill={mergedStyle.labelColor}
                        fontSize={mergedStyle.fontSize}
                        fontWeight="600"
                        textAnchor={w.outerLabelAnchor as any}
                        dominantBaseline="central"
                        style={{ pointerEvents: 'none' }}
                      >
                        {w.percent}%
                      </text>
                    </>
                  )}
                </g>
              ))}
            </svg>
            <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, maxHeight: 90, overflowY: 'auto' }}>
              {wedges.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: w.color, borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {w.value} · {w.percent}%
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : status === 'error' ? (
          <div style={{ fontSize: 11, color: '#ef4444', padding: '20px 8px', textAlign: 'center' }}>
            ⚠️ 数据解析失败<br />
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{errorMsg || '请检查上游输出格式'}</span>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '40px 8px', textAlign: 'center' }}>
            等待上游数据…<br />
            <span style={{ fontSize: 10 }}>支持 JSON / Markdown 表格 / CSV / 每行"标签 数字"</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default PieChartNode;
