import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import type { TextPromptNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: TextPromptNodeData;
  selected?: boolean;
  [key: string]: any;
};

function TextPromptNode({ id, data, selected }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '提示词');
  const [localText, setLocalText] = useState(data.text || '');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalText(data.text || ''); }, [data.text]);
  useEffect(() => { setLocalTitle(data.label || '提示词'); }, [data.label]);

  const handleChange = useCallback((value: string) => {
    setLocalText(value);
    updateNodeData(id, { text: value });
  }, [id, updateNodeData]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v });
    else setLocalTitle(data.label || '提示词');
  }, [id, localTitle, updateNodeData, data.label]);

  // 上下调整执行顺序（与相邻节点交换）
  const bumpOrder = useCallback((delta: number) => {
    (useNodeStore.getState() as any).swapPromptOrder?.(id, delta < 0 ? 'up' : 'down');
  }, [id]);

  return (
    <div className={`node-card text-prompt-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #10b981, #34d399)' }}>
        <span className="node-icon">✏️</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '提示词'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.25)',
              border: '1px solid rgba(255,255,255,0.6)',
              borderRadius: '6px',
              color: 'white',
              padding: '2px 6px',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, cursor: 'text' }}
          >
            {data.label || '提示词'}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); bumpOrder(-1); }}
            title="上移执行顺序"
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              fontSize: '10px',
              width: '18px',
              height: '18px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >▲</button>
          <span
            className="prompt-badge"
            style={{
              background: 'rgba(255,255,255,0.25)',
              borderRadius: '10px',
              padding: '1px 8px',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            #{data.promptNumber || 1}
          </span>
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); bumpOrder(1); }}
            title="下移执行顺序"
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              fontSize: '10px',
              width: '18px',
              height: '18px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >▼</button>
        </div>
      </div>

      <div className="node-body">
        {isEditing ? (
          <textarea
            autoFocus
            className="prompt-textarea nodrag"
            value={localText}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setIsEditing(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) setIsEditing(false);
              e.stopPropagation();
            }}
            placeholder="输入提示词内容..."
            style={{
              width: '100%',
              minHeight: '80px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '8px',
              fontSize: '13px',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <div
            className="node-body-placeholder"
            onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            style={{
              minHeight: '40px',
              padding: '6px',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'text',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            data-empty={!data.text}
          >
            {data.text || '双击输入提示词...'}
          </div>
        )}

        {data.status === 'running' && (
          <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '4px' }}>⏳ 执行中...</div>
        )}
        {data.status === 'success' && (
          <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>✅ 完成</div>
        )}
        {data.status === 'error' && (
          <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }} title={data.error}>
            ❌ 错误: {(data.error || '未知错误').toString().substring(0, 30)}
          </div>
        )}
      </div>
    </div>
  );
}

export default TextPromptNode;
