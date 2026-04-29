import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { MODEL_OPTIONS, type ModelType, type LLMNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: LLMNodeData;
  selected?: boolean;
  [key: string]: any;
};

function LLMNode({ id, data, selected }: Props) {
  const [isEditingSystem, setIsEditingSystem] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '大模型');
  const [localSystemPrompt, setLocalSystemPrompt] = useState(data.systemPrompt || '');
  const [localModel, setLocalModel] = useState(data.model || 'deepseek');
  const [localTemp, setLocalTemp] = useState(data.temperature ?? 0.7);
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalSystemPrompt(data.systemPrompt || ''); }, [data.systemPrompt]);
  useEffect(() => { setLocalModel(data.model || 'deepseek'); }, [data.model]);
  useEffect(() => { setLocalTemp(data.temperature ?? 0.7); }, [data.temperature]);
  useEffect(() => { setLocalTitle(data.label || '大模型'); }, [data.label]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '大模型');
  }, [id, localTitle, updateNodeData, data.label]);

  const handleSystemPromptChange = useCallback((value: string) => {
    setLocalSystemPrompt(value);
    updateNodeData(id, { systemPrompt: value });
  }, [id, updateNodeData]);

  const handleModelChange = useCallback((value: ModelType) => {
    setLocalModel(value);
    updateNodeData(id, { model: value });
  }, [id, updateNodeData]);

  const handleTempChange = useCallback((value: number) => {
    setLocalTemp(value);
    updateNodeData(id, { temperature: value });
  }, [id, updateNodeData]);

  return (
    <div className={`node-card llm-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}>
        <span className="node-icon">🤖</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '大模型'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '13px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '大模型'}
          </span>
        )}
      </div>

      <div className="node-body">
        <div className="field" style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>模型</label>
          <select
            className="nodrag"
            value={localModel}
            onChange={(e) => handleModelChange(e.target.value as ModelType)}
            style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '12px' }}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>系统提示词</label>
          {isEditingSystem ? (
            <textarea
              autoFocus
              className="nodrag"
              value={localSystemPrompt}
              onChange={(e) => handleSystemPromptChange(e.target.value)}
              onBlur={() => setIsEditingSystem(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setIsEditingSystem(false); e.stopPropagation(); }}
              placeholder="可选：输入系统提示词..."
              style={{ width: '100%', minHeight: '60px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px', fontSize: '12px', resize: 'vertical' }}
            />
          ) : (
            <div
              className="node-body-placeholder"
              onDoubleClick={(e) => { e.stopPropagation(); setIsEditingSystem(true); }}
              style={{ padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: 'text', minHeight: '30px' }}
              data-empty={!localSystemPrompt}
            >
              {localSystemPrompt || '双击输入系统提示词...'}
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>温度: {localTemp}</label>
          <input
            className="nodrag"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localTemp}
            onChange={(e) => handleTempChange(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {(data as any).streamOutput || data.output ? (
          <div style={{ background: '#f0fdf4', borderRadius: '6px', padding: '6px', fontSize: '11px', maxHeight: '100px', overflow: 'auto', color: '#166534' }}>
            {((data as any).streamOutput || data.output).substring(0, 200)}
            {((data as any).streamOutput || data.output).length > 200 ? '...' : ''}
          </div>
        ) : null}

        {data.status === 'running' && (
          <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '4px' }}>⏳ 思考中...</div>
        )}
        {data.status === 'error' && (
          <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }} title={data.error?.toString()}>
            ❌ {(data.error || '未知错误').toString().substring(0, 30)}
          </div>
        )}
      </div>
    </div>
  );
}

export default LLMNode;
