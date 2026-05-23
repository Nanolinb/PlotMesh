/**
 * CrossInputNode · 跨画布输入节点（v1.7 P2-A）
 * ---------------------------------------------------------------
 * 接收远端画布 crossOutput 的回写。
 *
 * 关键约定：
 *   - sourceCanvasId / sourceNodeId 是 server 自动填的，readonly（用户不能手改）
 *   - data.text 由 server 在 crossOutput 跑完后写入；status: waiting → received
 *   - 节点头部显示来源 chip：🌐 ← 画布A / 节点X + 上次收到时间
 *   - 节点正文显示 text 预览
 *   - 右键菜单提供"解除关联"
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
  [key: string]: any;
};

function CrossInputNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '🌐 跨画布输入');

  useEffect(() => { setLocalTitle(data.label || '🌐 跨画布输入'); }, [data.label]);

  const status: string = data.status || 'waiting';
  const sourceCanvasName: string = data.sourceCanvasName || '';
  const sourceNodeId: string = data.sourceNodeId || '';
  const sourceNodeLabel: string = data.sourceNodeLabel || sourceNodeId;
  const hasSource = !!sourceCanvasName && !!sourceNodeId;
  const text: string = data.text || '';
  const receivedAt: number | null = data.receivedAt || null;

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = (localTitle || '').trim();
    if (v && v !== data.label) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '🌐 跨画布输入');
  }, [id, localTitle, data.label, updateNodeData]);

  const handleUnlink = useCallback(async () => {
    if (!hasSource) return;
    if (!confirm(`确认解除来自「${sourceCanvasName} / ${sourceNodeLabel}」的关联？\n\n解除后远端画布跑完不会再写入此节点。`)) return;
    try {
      // 找到对应 connection 并删除
      const r = await fetch(`/api/canvas/connections/by-dst?canvasId=${useNodeStore.getState().activeCanvasId}&nodeId=${id}`);
      const d = await r.json();
      if (d.connection?.id) {
        await fetch(`/api/canvas/connections/${d.connection.id}`, { method: 'DELETE' });
        // 本地 data 直接清空 source 字段
        useNodeStore.getState().updateNodeData(id, {
          sourceCanvasId: null,
          sourceCanvasName: null,
          sourceNodeId: null,
          sourceNodeLabel: null,
          status: 'waiting',
        } as any);
      }
    } catch (e: any) {
      alert(`解除失败：${e.message}`);
    }
  }, [hasSource, sourceCanvasName, sourceNodeLabel, id]);

  return (
    <div
      className={`node-card${selected ? ' selected' : ''} cross-input-node`}
      data-status={status === 'received' ? 'success' : status}
      style={{ minWidth: 220, borderLeft: '3px solid #22c55e' }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        {editingTitle ? (
          <input
            autoFocus
            className="node-title-input"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || ''); } }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="node-title" onDoubleClick={() => setEditingTitle(true)} title="双击改名">
            {data.label || '🌐 跨画布输入'}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 10px', fontSize: 11 }}>
        {hasSource ? (
          <div
            style={{
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 4,
              padding: '4px 8px',
              marginBottom: 6,
              color: 'var(--text-primary)',
            }}
            title={`来源（不可修改）：${sourceCanvasName} / ${sourceNodeId}`}
          >
            🌐 ← <strong>{sourceCanvasName}</strong>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {sourceNodeLabel}{receivedAt ? ` · ${fmtTime(receivedAt)}` : ''}
            </div>
          </div>
        ) : (
          <div
            style={{
              background: 'rgba(148,163,184,0.08)',
              border: '1px dashed rgba(148,163,184,0.4)',
              borderRadius: 4,
              padding: '4px 8px',
              marginBottom: 6,
              color: 'var(--text-muted)',
            }}
          >
            ⚪ 暂无来源（等待 crossOutput 关联）
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          状态：{status === 'waiting' ? '⏳ 等待回写' : '✓ 已接收'}
        </div>

        {text && (
          <div
            style={{
              fontSize: 11,
              maxHeight: 100,
              overflow: 'auto',
              background: 'var(--bg-input, rgba(0,0,0,0.04))',
              border: '1px solid var(--border-color, transparent)',
              borderRadius: 4,
              padding: '6px 8px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-primary)',
            }}
            title={text}
          >
            {text.slice(0, 300)}{text.length > 300 ? '…' : ''}
          </div>
        )}

        {hasSource && (
          <button
            className="node-action-btn"
            onClick={(e) => { e.stopPropagation(); handleUnlink(); }}
            style={{ width: '100%', fontSize: 11, padding: '4px 8px', marginTop: 6, color: '#ef4444' }}
          >
            🔗 解除关联
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default CrossInputNode;
