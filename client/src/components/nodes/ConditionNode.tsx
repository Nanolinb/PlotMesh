import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

/**
 * 条件分支节点：根据输入内容是否匹配关键词，把结果从"true/false"两个出口分别输出
 */
function ConditionNode({ id, data, selected }: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '条件分支');
  const [keyword, setKeyword] = useState<string>(data.keyword || '');
  const [mode, setMode] = useState<string>(data.mode || 'contains');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalTitle(data.label || '条件分支'); }, [data.label]);
  useEffect(() => { setKeyword(data.keyword || ''); }, [data.keyword]);
  useEffect(() => { setMode(data.mode || 'contains'); }, [data.mode]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '条件分支');
  }, [id, localTitle, updateNodeData, data.label]);

  return (
    <div className={`node-card condition-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'}>
      <Handle type="target" position={Position.Left} />
      {/* 双出口：上 = true, 下 = false */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: '35%', background: '#10b981' }}
        title="匹配成功"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={top_style()}
        title="匹配失败"
      />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #f43f5e, #fb7185)' }}>
        <span className="node-icon">🔀</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '条件分支'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '条件分支'}
          </span>
        )}
      </div>

      <div className="node-body">
        <div className="field">
          <label>匹配方式</label>
          <select
            className="nodrag"
            value={mode}
            onChange={(e) => { setMode(e.target.value); updateNodeData(id, { mode: e.target.value } as any); }}
          >
            <option value="contains">包含关键词</option>
            <option value="equals">完全等于</option>
            <option value="startsWith">以…开头</option>
            <option value="regex">正则匹配</option>
          </select>
        </div>
        <div className="field">
          <label>关键词 / 正则</label>
          <input
            className="nodrag"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); updateNodeData(id, { keyword: e.target.value } as any); }}
            placeholder={mode === 'regex' ? '如 \\d+' : '输入关键词'}
          />
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
          🟢 上出口=匹配成功 &nbsp; ⚪ 下出口=未匹配
        </div>
      </div>
    </div>
  );
}

function top_style(): React.CSSProperties {
  return { top: '70%', background: '#94a3b8' };
}

export default ConditionNode;
