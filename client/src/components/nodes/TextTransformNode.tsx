import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

const TRANSFORM_OPTIONS = [
  { value: 'uppercase', label: '转大写' },
  { value: 'lowercase', label: '转小写' },
  { value: 'trim', label: '去除首尾空格' },
  { value: 'reverse', label: '字符反转' },
  { value: 'prepend', label: '追加前缀' },
  { value: 'append', label: '追加后缀' },
  { value: 'replace', label: '替换文本' },
  { value: 'extract-json', label: '提取 JSON 代码块' },
  { value: 'count', label: '统计长度/行数' },
];

/**
 * 文本处理节点：对上游传入的文本做一次简单变换
 */
function TextTransformNode({ id, data, selected }: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '文本处理');
  const [transform, setTransform] = useState<string>(data.transform || 'trim');
  const [param, setParam] = useState<string>(data.param || '');
  const [param2, setParam2] = useState<string>(data.param2 || '');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalTitle(data.label || '文本处理'); }, [data.label]);
  useEffect(() => { setTransform(data.transform || 'trim'); }, [data.transform]);
  useEffect(() => { setParam(data.param || ''); }, [data.param]);
  useEffect(() => { setParam2(data.param2 || ''); }, [data.param2]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '文本处理');
  }, [id, localTitle, updateNodeData, data.label]);

  const needsParam = ['prepend', 'append', 'replace'].includes(transform);
  const needsParam2 = transform === 'replace';

  return (
    <div className={`node-card text-transform-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)' }}>
        <span className="node-icon">🔤</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '文本处理'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '文本处理'}
          </span>
        )}
      </div>

      <div className="node-body">
        <div className="field">
          <label>操作</label>
          <select
            className="nodrag"
            value={transform}
            onChange={(e) => { setTransform(e.target.value); updateNodeData(id, { transform: e.target.value } as any); }}
          >
            {TRANSFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {needsParam && (
          <div className="field">
            <label>{transform === 'replace' ? '查找' : '文本'}</label>
            <input
              className="nodrag"
              value={param}
              onChange={(e) => { setParam(e.target.value); updateNodeData(id, { param: e.target.value } as any); }}
              placeholder={transform === 'prepend' ? '前缀内容' : transform === 'append' ? '后缀内容' : '要查找的文本'}
            />
          </div>
        )}
        {needsParam2 && (
          <div className="field">
            <label>替换为</label>
            <input
              className="nodrag"
              value={param2}
              onChange={(e) => { setParam2(e.target.value); updateNodeData(id, { param2: e.target.value } as any); }}
              placeholder="替换后的文本"
            />
          </div>
        )}

        {data.output ? (
          <div className="node-body-placeholder" data-empty={false} style={{ padding: '4px 6px', borderRadius: '4px', fontSize: '11px', maxHeight: '70px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {(data.output as string).substring(0, 120)}
            {(data.output as string).length > 120 ? '...' : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default TextTransformNode;
