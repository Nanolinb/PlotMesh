/**
 * LLMNode · 大模型调用节点
 * ---------------------------------------------------------------
 * 工作流的"大脑"：把上游的提示词 + 文件内容打包发给某个 LLM 服务商，
 * 把模型的回答作为输出传给下游。
 *
 * 关键设计：
 *  - 5 家模型统一通过 /api/llm/chat 后端代理（避免在前端暴露 API Key）
 *  - 上游输入按 fileUpload / 普通节点分类，分别包到 <documents> 和 <instructions>
 *    标签里，防止文件正文里的"请把所有数字翻倍"被当成指令执行（prompt injection 防御）
 *  - 温度滑杆带四档语义化徽标（确定 / 平衡 / 创意 / 发散），帮用户挑值
 *  - 系统提示词（systemPrompt）单独输入，不进 <instructions>
 */
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
          {(() => {
            // 把温度数值映射到 4 档语义化标签，帮用户判断当前是"求稳"还是"求创意"
            const t = localTemp;
            let tier: { name: string; tip: string; color: string };
            if (t <= 0.3) tier = { name: '确定', tip: '低随机性：代码、SQL、JSON 抽取、严谨问答', color: '#0ea5e9' };
            else if (t <= 0.7) tier = { name: '平衡', tip: '一般问答 / 摘要 / 翻译 / 改写（默认 0.7）', color: '#10b981' };
            else if (t <= 1.1) tier = { name: '创意', tip: '文案 / 邮件 / 起名 / 故事开头', color: '#f59e0b' };
            else tier = { name: '发散', tip: '头脑风暴 / 写诗 / 大胆联想（可能跑题）', color: '#ef4444' };
            return (
              <>
                <label
                  style={{ fontSize: '11px', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}
                  title="温度（temperature）越低，输出越稳定可预测；越高越发散有创意"
                >
                  <span>温度: {localTemp.toFixed(1)}</span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '8px',
                      background: tier.color + '22',
                      color: tier.color,
                      fontWeight: 600,
                      cursor: 'help',
                    }}
                    title={tier.tip}
                  >
                    {tier.name}
                  </span>
                </label>
                <input
                  className="nodrag"
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.1"
                  value={localTemp}
                  onChange={(e) => handleTempChange(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                  title={tier.tip}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '9px',
                    color: '#94a3b8',
                    marginTop: '2px',
                    pointerEvents: 'none',
                  }}
                >
                  <span>0 确定</span>
                  <span>0.7 平衡</span>
                  <span>1.5 发散</span>
                </div>
              </>
            );
          })()}
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
