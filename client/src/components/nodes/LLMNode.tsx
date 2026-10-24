/**
 * LLMNode · 文本 AI 调用节点
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
import { MODEL_OPTIONS, MODEL_VERSION_OPTIONS, type ModelType, type LLMNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: LLMNodeData;
  selected?: boolean;
  [key: string]: any;
};

function LLMNode({ id, data, selected }: Props) {
  const normalizedTitle = !data.label || data.label === '大模型' || data.label === '🤖 大模型'
    ? '文本AI'
    : data.label;
  const [isEditingSystem, setIsEditingSystem] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(normalizedTitle);
  const [localSystemPrompt, setLocalSystemPrompt] = useState(data.systemPrompt || '');
  const [localModel, setLocalModel] = useState(data.model || 'deepseek');
  const [localCustomModel, setLocalCustomModel] = useState(data.customModelName || '');
  const [localTemp, setLocalTemp] = useState(data.temperature ?? 0.7);
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const cachedOutput = String(data.output || (data as any).streamOutput || '').trim();

  useEffect(() => { setLocalSystemPrompt(data.systemPrompt || ''); }, [data.systemPrompt]);
  useEffect(() => { setLocalModel(data.model || 'deepseek'); }, [data.model]);
  useEffect(() => { setLocalCustomModel(data.customModelName || ''); }, [data.customModelName]);
  useEffect(() => { setLocalTemp(data.temperature ?? 0.7); }, [data.temperature]);
  useEffect(() => { setLocalTitle(normalizedTitle); }, [normalizedTitle]);
  useEffect(() => {
    if (data.label === '大模型' || data.label === '🤖 大模型') {
      updateNodeData(id, { label: '文本AI' } as any);
    }
  }, [data.label, id, updateNodeData]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(normalizedTitle);
  }, [id, localTitle, updateNodeData, normalizedTitle]);

  const handleSystemPromptChange = useCallback((value: string) => {
    setLocalSystemPrompt(value);
    updateNodeData(id, { systemPrompt: value });
  }, [id, updateNodeData]);

  const handleModelChange = useCallback((value: ModelType) => {
    setLocalModel(value);
    updateNodeData(id, { model: value });
  }, [id, updateNodeData]);

  const handleCustomModelChange = useCallback((value: string) => {
    setLocalCustomModel(value);
    updateNodeData(id, { customModelName: value.trim() } as any);
  }, [id, updateNodeData]);

  const handleTempChange = useCallback((value: number) => {
    setLocalTemp(value);
    updateNodeData(id, { temperature: value });
  }, [id, updateNodeData]);

  const handleEmitCachedOutput = useCallback(() => {
    if (!cachedOutput || data.status === 'running') return;
    window.dispatchEvent(new CustomEvent('plotmesh-emit-cached-llm-output', { detail: { nodeId: id } }));
  }, [cachedOutput, data.status, id]);

  /** 各厂商默认版本号（仅 placeholder 提示用，不参与运行） */
  const DEFAULT_MODEL_NAMES: Record<string, string> = {
    hunyuan: 'hunyuan-turbo',
    deepseek: 'deepseek-chat',
    glm: 'glm-4',
    gpt: 'gpt-4o',
    claude: 'claude-3-5-sonnet-20241022',
    kimi: 'moonshot-v1-8k',
    qwen: 'qwen-plus',
  };
  const placeholderModelName = DEFAULT_MODEL_NAMES[localModel] || '使用厂商默认';
  /** 当前厂商的版本备选清单（喂给 select；选「自定义」会切到 input） */
  const versionOptions = MODEL_VERSION_OPTIONS[localModel as ModelType] || [];

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
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(normalizedTitle); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '13px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {normalizedTitle}
          </span>
        )}
      </div>

      <div className="node-body">
        {(data as any).appliedTheme && (
          <div
            title={`已应用主题：${(data as any).appliedTheme}`}
            style={{
              fontSize: 10, color: '#14b8a6',
              background: 'rgba(20,184,166,0.1)',
              border: '1px solid rgba(20,184,166,0.3)',
              borderRadius: 4, padding: '2px 6px', marginBottom: 8,
              display: 'inline-block', maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            🎨 {(data as any).appliedTheme}
          </div>
        )}
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
          <label
            style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, marginBottom: '4px' }}
            title="留空则用厂商默认版本号；填值则用你指定的版本（例 deepseek-reasoner / qwen3-coder-plus / kimi-k2-0905-preview）"
          >
            <span>版本号</span>
            <span style={{ cursor: 'help', color: '#94a3b8' }}>ⓘ</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>可选</span>
          </label>
          {/*
            v1.6.0-β9：去掉双击折叠态，直接显示 input。
            原因：用户反馈"看不出是输入框，双击也没反应"。
            实际是双击会进入编辑态、blur 后回折叠态——但 dashed 边框 + placeholder
            视觉上太弱，很多人意识不到要双击。
            现在直接 input：留空走厂商默认；填值则 server 用该值替换 modelName。
            常见用法举例：deepseek 默认 deepseek-chat，想要推理版填 deepseek-reasoner；
            qwen 默认 qwen-plus，想要长上下文填 qwen-long 或 qwen3-coder-plus。
          */}
          {/*
            v1.6.0-β16：把 datalist 换成 "select + 自定义" 双控件。
            原 datalist 在浏览器里有前缀过滤问题：用户输入了 "deepseek-chat" 后再展开
            下拉只剩它自己（其他 deepseek-reasoner/v4-pro 等被过滤掉）—— 看起来像
            "只有 1 个版本"。改成纯 select 一直显示完整列表 + 选择 "✏️ 自定义..." 时
            才出现输入框，最稳。
          */}
          {(() => {
            const isCustom = !!localCustomModel && !versionOptions.some((o) => o.value === localCustomModel);
            return (
              <>
                <select
                  className="nodrag"
                  value={isCustom ? '__custom__' : (localCustomModel || '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__custom__') {
                      // 切到自定义：保留之前的自定义值（如果有）；否则给个占位
                      handleCustomModelChange(localCustomModel && isCustom ? localCustomModel : '自定义版本号');
                    } else {
                      handleCustomModelChange(v);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    background: '#fff',
                    color: '#1e293b',
                  }}
                >
                  <option value="">{`默认（${placeholderModelName}）`}</option>
                  {versionOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                  <option value="__custom__">✏️ 自定义版本号…</option>
                </select>
                {isCustom && (
                  <input
                    type="text"
                    className="nodrag"
                    value={localCustomModel}
                    onChange={(e) => handleCustomModelChange(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="例如 deepseek-2099-future"
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #94a3b8',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      boxSizing: 'border-box',
                      background: '#fff',
                      color: '#1e293b',
                    }}
                  />
                )}
              </>
            );
          })()}
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, lineHeight: 1.3 }}>
            选「自定义版本号」可填厂商最新版（无须改代码）
          </div>
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

        {cachedOutput ? (
          <>
            <div style={{ background: '#f0fdf4', borderRadius: '6px', padding: '6px', fontSize: '11px', maxHeight: '100px', overflow: 'auto', color: '#166534' }}>
              {cachedOutput.substring(0, 200)}
              {cachedOutput.length > 200 ? '...' : ''}
            </div>
            <button
              className="nodrag"
              type="button"
              onClick={(event) => { event.stopPropagation(); handleEmitCachedOutput(); }}
              disabled={data.status === 'running'}
              title="不重新调用模型，直接使用当前缓存结果执行所有下游节点"
              style={{
                width: '100%', marginTop: 6, padding: '5px 7px', borderRadius: 5,
                border: '1px solid #f59e0b', background: 'rgba(245,158,11,.10)',
                color: '#b45309', fontSize: 11, fontWeight: 600,
                cursor: data.status === 'running' ? 'not-allowed' : 'pointer',
                opacity: data.status === 'running' ? 0.55 : 1,
              }}
            >
              ↪ 下发缓存结果到下游
            </button>
            {(data as any).cachedOutputEmittedAt && (
              <div style={{ marginTop: 3, fontSize: 9, color: 'var(--text-muted)' }}>
                已手动下发
              </div>
            )}
          </>
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
