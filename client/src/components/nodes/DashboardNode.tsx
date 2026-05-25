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
import { useState, useEffect } from 'react';
import { useNodeStore } from '../../store/nodes';

interface Props {
  id: string;
  data: any;
  selected?: boolean;
}

/** 给定 SVG 数组，拼出完整 HTML 文档 */
export function buildDashboardHtml(
  panels: Array<{ title?: string; svg: string }>,
  opts: { title?: string; columns?: number; theme?: 'light' | 'dark' } = {},
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

  const cards = panels.map((p, i) => {
    const cardTitle = p.title
      ? String(p.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : `图 ${i + 1}`;
    return `<div class="card">
  <div class="card-title">${cardTitle}</div>
  <div class="card-body">${p.svg}</div>
</div>`;
  }).join('\n');

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
    grid-template-columns: repeat(${cols}, 1fr);
    gap: 16px;
  }
  @media (max-width: 768px) {
    .grid { grid-template-columns: 1fr; }
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

  return (
    <div className={`node-card dashboard-node ${selected ? 'selected' : ''}`} data-status={status}>
      <Handle type="target" position={Position.Left} id="data" style={{ background: '#06b6d4' }} title="接 N 个图形节点（饼图 / 自由图形）" />
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
            <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>列数</label>
            <select
              className="nodrag"
              value={localCols}
              onChange={(e) => { const n = parseInt(e.target.value, 10); setLocalCols(n); updateNodeData(id, { columns: n } as any); }}
              style={{ fontSize: 11, width: '100%' }}
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
                <li key={i} style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.title || `图 ${i + 1}`}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '20px 8px', textAlign: 'center' }}>
            把多个图形节点（饼图 / 自由图形）接到这里
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
      </div>
    </div>
  );
}

export default DashboardNode;
