/**
 * BarChartNode · 柱状图节点（v1.7.0-alpha 后期）
 * ---------------------------------------------------------------
 * 跟饼图节点同套路，本地纯 SVG 渲染。
 *
 * 双输入端：
 *   - 蓝色 data 端口：[{label,value}] 数据
 *   - 紫色 style 端口：ChartStyle JSON
 *
 * 渲染时复用 PieChartNode 的 parsePieData 解析能力（数据结构相同），
 * 用 svgRenderers.renderBarChartSvg 离屏拼装。
 *
 * 输出：
 *   - results.set(nodeId, JSON.stringify(bars))
 *   - data.svg = SVG 字符串（供仪表盘消费）
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useMemo } from 'react';
import { useNodeStore } from '../../store/nodes';
import { mergeChartStyle, type ChartStyle } from '../../types/chartStyle';

interface Props {
  id: string;
  data: any;
  selected?: boolean;
}

type Bar = { label: string; value: number };

function BarChartNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '柱状图');
  useEffect(() => { setLocalTitle(data.label || '柱状图'); }, [data.label]);

  const commitTitle = () => {
    updateNodeData(id, { label: (localTitle || '').trim() || '柱状图' });
    setEditingTitle(false);
  };

  const bars: Bar[] = useMemo(() => {
    if (Array.isArray(data.bars)) return data.bars;
    return [];
  }, [data.bars]);

  const mergedStyle = useMemo(
    () => mergeChartStyle(data.styleIn as ChartStyle | null | undefined),
    [data.styleIn],
  );

  const status = data.status || 'idle';
  const errorMsg = data.error || '';

  const W = 320;
  const H = 200;
  const horizontal = mergedStyle.barOrientation === 'horizontal';
  const padding = { top: 10, right: 12, bottom: 24, left: 36 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const lc = (mergedStyle.labelColor === '#ffffff' && mergedStyle.background === 'transparent') ? '#1e293b' : mergedStyle.labelColor;
  const ax = mergedStyle.axisColor || '#94a3b8';
  const slot = (horizontal ? innerH : innerW) / Math.max(1, bars.length);
  const barW = slot * (mergedStyle.barWidth ?? 0.7);
  const barOffset = (slot - barW) / 2;

  return (
    <div className={`node-card bar-chart-node ${selected ? 'selected' : ''}`} data-status={status}>
      <Handle type="target" position={Position.Left} id="data" style={{ top: '35%', background: '#6366f1' }} title="数据输入（[{label,value}] 等）" />
      <Handle type="target" position={Position.Left} id="style" style={{ top: '70%', background: '#a855f7' }} title="样式参考（ChartStyle JSON）" />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #06b6d4, #6366f1)' }}>
        <span className="node-icon">📊</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '柱状图'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '柱状图'}
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
        {bars.length > 0 ? (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto' }}>
            {mergedStyle.showAxis && (
              <>
                <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerH} stroke={ax} strokeWidth={1} />
                <line x1={padding.left} y1={padding.top + innerH} x2={padding.left + innerW} y2={padding.top + innerH} stroke={ax} strokeWidth={1} />
                {!horizontal && (
                  <>
                    <text x={padding.left - 4} y={padding.top + 4} textAnchor="end" dominantBaseline="middle" fill={ax} fontSize={(mergedStyle.fontSize || 10) - 1}>{max}</text>
                    <text x={padding.left - 4} y={padding.top + innerH} textAnchor="end" dominantBaseline="middle" fill={ax} fontSize={(mergedStyle.fontSize || 10) - 1}>0</text>
                  </>
                )}
              </>
            )}
            {bars.map((b, i) => {
              const color = mergedStyle.palette[i % mergedStyle.palette.length];
              const ratio = b.value / max;
              if (horizontal) {
                const y = padding.top + i * slot + barOffset;
                const w = Math.max(0, ratio * innerW);
                const x = padding.left;
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={w} height={barW} fill={color} stroke={mergedStyle.borderColor} strokeWidth={mergedStyle.borderWidth} rx={2} />
                    <text x={padding.left - 4} y={y + barW / 2} textAnchor="end" dominantBaseline="middle" fill={lc} fontSize={mergedStyle.fontSize}>{b.label}</text>
                    <text x={x + w + 3} y={y + barW / 2} textAnchor="start" dominantBaseline="middle" fill={lc} fontSize={mergedStyle.fontSize} fontWeight="600">{b.value}</text>
                  </g>
                );
              }
              const x = padding.left + i * slot + barOffset;
              const h = Math.max(0, ratio * innerH);
              const y = padding.top + (innerH - h);
              return (
                <g key={i}>
                  <rect x={x} y={y} width={barW} height={h} fill={color} stroke={mergedStyle.borderColor} strokeWidth={mergedStyle.borderWidth} rx={2} />
                  <text x={x + barW / 2} y={padding.top + innerH + 12} textAnchor="middle" fill={lc} fontSize={mergedStyle.fontSize}>{b.label}</text>
                  <text x={x + barW / 2} y={y - 3} textAnchor="middle" fill={lc} fontSize={mergedStyle.fontSize} fontWeight="600">{b.value}</text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '40px 8px', textAlign: 'center' }}>
            等待上游数据…<br />
            <span style={{ fontSize: 10 }}>支持 JSON / Markdown 表格 / CSV / 每行"标签 数字"</span>
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>❌ {errorMsg}</div>
        )}
      </div>
    </div>
  );
}

export default BarChartNode;
