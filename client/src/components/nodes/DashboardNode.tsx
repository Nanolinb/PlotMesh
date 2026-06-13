/**
 * DashboardNode · 仪表盘节点（v1.7.0-alpha）
 * ---------------------------------------------------------------
 * 接收 N 个图形节点的输入（饼图 / 自由图形 / 任何含 data.svg 字段的节点），
 * 把它们排成 grid 布局合成一个完整 HTML 页面，输出给下游 Output 节点导出 web。
 *
 * 输入端：
 *   - 多个 target 连线，可重复连接（每条 source 是一个图形节点）
 *   - 上游节点必须能产出 SVG 字符串：通过 `data.svg`（饼图、自由图形）
 *
 * 输出（results.set）：
 *   - 完整 HTML 文档字符串（包含 <head> / 样式 / <body> + grid 容器）
 *   - 可直接接 OutputNode (format=web) 一键打开/下载
 *
 * 节点本身预览：在节点 body 里显示一个迷你 thumbnails 列表（已收集到几个 SVG）。
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { applyLayoutToPanels, type ParsedLayout } from '../../utils/dashboardLayout';

interface Props {
  id: string;
  data: any;
  selected?: boolean;
}

/** 给定 SVG 数组，拼出完整 HTML 文档 */
export function buildDashboardHtml(
  panels: Array<{ title?: string; svg: string }>,
  opts: { title?: string; columns?: number; theme?: 'light' | 'dark'; layout?: ParsedLayout | null } = {},
): string {
  const cols = Math.max(1, Math.min(4, opts.columns ?? 2));
  const theme = opts.theme ?? 'light';
  const bg = theme === 'dark' ? '#0d0d0d' : '#f8fafc';
  const fg = theme === 'dark' ? '#e2e8f0' : '#1e293b';
  const cardBg = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  const cardBorder = theme === 'dark' ? '#2d2d2d' : '#e2e8f0';
  const title = opts.title || '仪表盘';
  const safeTitle = String(title)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // v1.7-alpha 后期：layout 模式按 cell ID 给每张 card 设 grid-area
  const layout = opts.layout || null;
  const decoratedPanels = layout ? applyLayoutToPanels(panels, layout) : panels.map((p) => ({ ...p }));

  const cards = decoratedPanels.map((p: any, i: number) => {
    const cardTitle = p.title
      ? String(p.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : `图 ${i + 1}`;
    const styleAttr = p.gridArea ? ` style="grid-area: ${p.gridArea};"` : '';
    return `<div class="card"${styleAttr}>
  <div class="card-title">${cardTitle}</div>
  <div class="card-body">${p.svg}</div>
</div>`;
  }).join('\n');

  // grid 容器样式：layout 模式 vs 列数模式
  const gridStyle = layout
    ? `grid-template-columns: repeat(${layout.cols}, 1fr); grid-template-areas: ${layout.gridTemplateAreas};`
    : `grid-template-columns: repeat(${cols}, 1fr);`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: ${bg};
    color: ${fg};
  }
  .dashboard {
    max-width: 1280px;
    margin: 0 auto;
  }
  h1 {
    margin: 0 0 24px;
    font-size: 24px;
    font-weight: 600;
  }
  .grid {
    display: grid;
    ${gridStyle}
    gap: 16px;
  }
  @media (max-width: 768px) {
    .grid { grid-template-columns: 1fr; grid-template-areas: none; }
    .card { grid-area: auto !important; }
  }
  .card {
    background: ${cardBg};
    border: 1px solid ${cardBorder};
    border-radius: 8px;
    padding: 16px;
    overflow: hidden;
  }
  .card-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
    color: ${fg};
    opacity: 0.85;
  }
  .card-body {
    width: 100%;
    text-align: center;
  }
  .card-body svg {
    max-width: 100%;
    height: auto;
  }
  .meta {
    margin-top: 24px;
    font-size: 12px;
    color: ${fg};
    opacity: 0.5;
    text-align: center;
  }
</style>
</head>
<body>
<div class="dashboard">
  <h1>${safeTitle}</h1>
  <div class="grid">
    ${cards}
  </div>
  <div class="meta">由 PlotMesh 仪表盘节点生成 · ${new Date().toLocaleString('zh-CN')}</div>
</div>
</body>
</html>`;
}

function DashboardNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '仪表盘');
  const [localGridTitle, setLocalGridTitle] = useState<string>(data.gridTitle || '');
  const [localCols, setLocalCols] = useState<number>(data.columns || 2);
  const [localTheme, setLocalTheme] = useState<string>(data.theme || 'light');

  useEffect(() => { setLocalTitle(data.label || '仪表盘'); }, [data.label]);
  useEffect(() => { setLocalGridTitle(data.gridTitle || ''); }, [data.gridTitle]);
  useEffect(() => { setLocalCols(data.columns || 2); }, [data.columns]);
  useEffect(() => { setLocalTheme(data.theme || 'light'); }, [data.theme]);

  const commitTitle = () => {
    updateNodeData(id, { label: (localTitle || '').trim() || '仪表盘' });
    setEditingTitle(false);
  };

  const status = data.status || 'idle';
  const errorMsg = data.error || '';
  const panels: Array<{ title?: string; svg: string }> = data.panels || [];
  // v1.7-alpha 后期：layout 由上游 layout 端口流入，executeFlow 写到 data.layoutIn
  const layoutIn: ParsedLayout | null = data.layoutIn || null;

  /**
   * 主动抓取上游图形节点的 SVG（不跑整画布），合成 HTML 写入 data.output。
   * 上游需含 data.svg（饼图/柱图/自由图形已生成过）。按连线顺序去重收集。
   */
  const handlePull = useCallback(() => {
    const state = useNodeStore.getState();
    const allNodes = state.nodes as any[];
    const allEdges = state.edges as any[];
    const seen = new Set<string>();
    const collected: Array<{ title?: string; svg: string }> = [];
    allEdges
      .filter((e: any) => e.target === id && (e.targetHandle === 'data' || !e.targetHandle))
      .forEach((e: any) => {
        if (seen.has(e.source)) return;
        const src = allNodes.find((n: any) => n.id === e.source);
        const svg = src?.data?.svg;
        if (svg && typeof svg === 'string') {
          seen.add(e.source);
          collected.push({ title: src.data.label || '图', svg });
        }
      });
    if (collected.length === 0) {
      updateNodeData(id, { status: 'error', error: '上游暂无图形（请先运行图形节点，或确认已生成 SVG）' } as any);
      return;
    }
    const html = buildDashboardHtml(collected, {
      title: data.gridTitle || data.label || '仪表盘',
      columns: data.columns ?? 2,
      theme: (data.theme as 'light' | 'dark') ?? 'light',
      layout: layoutIn,
    });
    updateNodeData(id, { status: 'success', panels: collected, output: html, error: '' } as any);
  }, [id, updateNodeData, data.gridTitle, data.label, data.columns, data.theme, layoutIn]);

  /** 在浏览器新标签页打开已生成的 HTML */
  const handleOpen = useCallback(async () => {
    if (!data.output) return;
    const { openAsWeb } = await import('../../utils/exporters');
    openAsWeb(data.output, { title: data.gridTitle || data.label || '仪表盘' });
  }, [data.output, data.gridTitle, data.label]);


  return (
    <div className={`node-card dashboard-node ${selected ? 'selected' : ''}`} data-status={status}>
      {/* 双输入：上=数据（图形节点），下=布局（Markdown 表 / grid-template-areas） */}
      <Handle type="target" position={Position.Left} id="data" style={{ top: '35%', background: '#06b6d4' }} title="接 N 个图形节点（饼图 / 柱状 / 自由图形）" />
      <Handle type="target" position={Position.Left} id="layout" style={{ top: '70%', background: '#f59e0b' }} title="布局参考（Markdown 表格 / grid-template-areas / 行式空格分隔）" />
      <Handle type="source" position={Position.Right} title="HTML 文档（接 Output 节点导出 web）" />

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
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '仪表盘'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '仪表盘'}
          </span>
        )}
      </div>

      <div className="node-body" style={{ padding: '8px' }}>
        <div className="field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>页面标题</label>
          <input
            className="nodrag"
            value={localGridTitle}
            onChange={(e) => { setLocalGridTitle(e.target.value); updateNodeData(id, { gridTitle: e.target.value } as any); }}
            placeholder="留空 = 用节点名"
            style={{ fontSize: 11, width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <div className="field" style={{ flex: 1 }}>
            <label
              style={{
                fontSize: 10,
                color: layoutIn ? 'var(--text-muted)' : 'var(--text-muted)',
                opacity: layoutIn ? 0.5 : 1,
              }}
              title={layoutIn ? '上游已接 layout 端口，列数由布局自动决定（本下拉禁用）' : ''}
            >
              列数{layoutIn ? '（由布局覆盖）' : ''}
            </label>
            <select
              className="nodrag"
              value={localCols}
              disabled={!!layoutIn}
              onChange={(e) => { const n = parseInt(e.target.value, 10); setLocalCols(n); updateNodeData(id, { columns: n } as any); }}
              style={{ fontSize: 11, width: '100%', opacity: layoutIn ? 0.5 : 1, cursor: layoutIn ? 'not-allowed' : 'default' }}
              title={layoutIn ? `已被布局覆盖：${layoutIn.cols} 列` : ''}
            >
              <option value="1">1 列</option>
              <option value="2">2 列</option>
              <option value="3">3 列</option>
              <option value="4">4 列</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>主题</label>
            <select
              className="nodrag"
              value={localTheme}
              onChange={(e) => { setLocalTheme(e.target.value); updateNodeData(id, { theme: e.target.value } as any); }}
              style={{ fontSize: 11, width: '100%' }}
            >
              <option value="light">☀️ 白天</option>
              <option value="dark">🌙 夜晚</option>
            </select>
          </div>
        </div>

        {panels.length > 0 ? (
          <div style={{ marginTop: 6, fontSize: 11 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>
              收集到 {panels.length} 张图：
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', maxHeight: 100, overflowY: 'auto' }}>
              {panels.map((p, i) => (
                <li key={i} style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {p.title || `图 ${i + 1}`}
                  {layoutIn && layoutIn.ids[i] && (
                    <span style={{ marginLeft: 6, padding: '0 4px', background: 'rgba(245,158,11,0.15)', color: '#d97706', borderRadius: 3 }}>
                      → {layoutIn.ids[i]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '20px 8px', textAlign: 'center' }}>
            把多个图形节点（饼图 / 柱状 / 自由图形）接到这里
          </div>
        )}

        {/* 布局参考预览 */}
        {layoutIn && (
          <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: 4, fontSize: 10 }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
              🎨 布局：{layoutIn.rows} × {layoutIn.cols}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${layoutIn.cols}, 1fr)`, gap: 2 }}>
              {layoutIn.matrix.flat().map((cell: string, i: number) => (
                <div
                  key={i}
                  style={{
                    background: cell === '.' ? 'rgba(0,0,0,0.05)' : 'rgba(99,102,241,0.15)',
                    border: '1px dashed rgba(99,102,241,0.3)',
                    borderRadius: 2,
                    padding: '2px 4px',
                    fontSize: 9,
                    textAlign: 'center',
                    color: cell === '.' ? 'var(--text-muted)' : '#4f46e5',
                  }}
                  title={cell === '.' ? '空 cell' : `cell ID: ${cell}`}
                >
                  {cell === '.' ? ' ' : cell.slice(0, 8)}
                </div>
              ))}
            </div>
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>❌ {errorMsg}</div>
        )}
        {status === 'success' && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#10b981' }}>
            ✅ 已生成 HTML（{(data.output || '').length} 字符）
          </div>
        )}

        {/* 主动抓取上游图形 + 直接查看（无需再接输出节点） */}
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); handlePull(); }}
          title="主动抓取上游图形节点已生成的 SVG 并合成 HTML（无需运行整个画布）"
          style={{
            width: '100%', marginTop: 8, fontSize: 12, padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 600,
          }}
        >
          ↯ 抓取上游图形
        </button>
        {data.output && (
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); handleOpen(); }}
            title="在浏览器新标签页打开生成的仪表盘 HTML"
            style={{
              width: '100%', marginTop: 6, fontSize: 12, padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)', fontWeight: 600,
            }}
          >
            🌐 浏览器打开
          </button>
        )}
      </div>
    </div>
  );
}

export default DashboardNode;
