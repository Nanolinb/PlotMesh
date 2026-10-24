/**
 * AgentNode · 自主 Agent 节点（ReAct 循环 + 工具调用）
 * ---------------------------------------------------------------
 * 与「文本AI」的区别：文本AI 是单轮问答；Agent 会自己决定要不要联网查资料，
 * 多轮调用 web_fetch，直到信息足够后用 finish 工具输出最终答案。
 *
 * 关键设计：
 *  - 模型走 /api/llm/chat，带上 tools（function calling）；厂商不支持时自动降级为单轮问答
 *  - maxSteps 限制循环轮数，防止跑飞（1~12，默认 6）
 *  - trace 记录每一轮的「思考 / 工具 / 观察」，默认折叠以保护画布布局
 *  - 任务可来自节点内 task，也可由上游 textPrompt 传入，两者按顺序合并
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { MODEL_OPTIONS, MODEL_VERSION_OPTIONS, type ModelType } from '../../types/nodes';

interface AgentStep {
  step: number;
  thought?: string;
  tool?: string | null;
  args?: any;
  observation?: string;
}

interface AgentNodeData {
  type: 'agent';
  label: string;
  model: ModelType;
  customModelName?: string;
  task: string;
  systemPrompt: string;
  temperature: number;
  maxSteps: number;
  status?: string;
  output: string;
  trace?: AgentStep[];
  error?: string;
}

type Props = {
  id: string;
  data: AgentNodeData;
  selected?: boolean;
  [key: string]: any;
};

const DEFAULT_MODEL_NAMES: Record<string, string> = {
  hunyuan: 'hunyuan-turbo',
  deepseek: 'deepseek-chat',
  glm: 'glm-4',
  gpt: 'gpt-4o',
  claude: 'claude-3-5-sonnet-20241022',
  kimi: 'moonshot-v1-8k',
  qwen: 'qwen-plus',
};

// function calling 走 OpenAI 兼容协议，Claude 协议不同，暂不支持
const TOOL_CAPABLE = new Set(['deepseek', 'gpt', 'qwen', 'glm', 'kimi', 'hunyuan']);

function AgentNode({ id, data, selected }: Props) {
  const d = data as any;
  const normalizedTitle = d.label || 'Agent';
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(normalizedTitle);
  const [localTask, setLocalTask] = useState(d.task || '');
  const [localSystem, setLocalSystem] = useState(d.systemPrompt || '');
  const [localModel, setLocalModel] = useState<ModelType>(d.model || 'deepseek');
  const [localCustom, setLocalCustom] = useState(d.customModelName || '');
  const [localTemp, setLocalTemp] = useState(d.temperature ?? 0.3);
  const [localSteps, setLocalSteps] = useState(d.maxSteps ?? 6);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalTask(d.task || ''); }, [d.task]);
  useEffect(() => { setLocalSystem(d.systemPrompt || ''); }, [d.systemPrompt]);
  useEffect(() => { setLocalModel(d.model || 'deepseek'); }, [d.model]);
  useEffect(() => { setLocalCustom(d.customModelName || ''); }, [d.customModelName]);
  useEffect(() => { setLocalTemp(d.temperature ?? 0.3); }, [d.temperature]);
  useEffect(() => { setLocalSteps(d.maxSteps ?? 6); }, [d.maxSteps]);
  useEffect(() => { setLocalTitle(normalizedTitle); }, [normalizedTitle]);

  // 每次开始运行时把 trace 收起，避免上一次的展开态干扰画布
  useEffect(() => {
    if (d.status === 'running') setShowTrace(false);
  }, [d.status]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(normalizedTitle);
  }, [id, localTitle, updateNodeData, normalizedTitle]);

  const trace: AgentStep[] = Array.isArray(d.trace) ? d.trace : [];
  const cachedOutput = String(d.output || '').trim();
  const versionOptions = MODEL_VERSION_OPTIONS[localModel] || [];
  const toolUnsupported = !TOOL_CAPABLE.has(localModel);

  return (
    <div className={`node-card agent-node ${selected ? 'selected' : ''}`} data-status={d.status || 'idle'}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}>
        <span className="node-icon">🕵️</span>
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
        <span style={{ fontSize: 9, background: 'rgba(255,255,255,0.25)', borderRadius: 6, padding: '1px 5px', color: '#fff' }}>
          ReAct
        </span>
      </div>

      <div className="node-body">
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <select
            className="nodrag"
            value={localModel}
            onChange={(e) => { setLocalModel(e.target.value as ModelType); updateNodeData(id, { model: e.target.value } as any); }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            className="nodrag"
            list={`agent-model-versions-${id}`}
            value={localCustom}
            onChange={(e) => { setLocalCustom(e.target.value); updateNodeData(id, { customModelName: e.target.value.trim() } as any); }}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder={DEFAULT_MODEL_NAMES[localModel] || '默认版本'}
            title="可选：填厂商具体版本号，留空用默认"
            style={{ flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11, fontFamily: 'monospace' }}
          />
          <datalist id={`agent-model-versions-${id}`}>
            {versionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </datalist>
        </div>

        {toolUnsupported && (
          <div style={{ fontSize: 10, color: '#b45309', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 4, padding: '2px 5px', marginBottom: 6, lineHeight: 1.35 }}>
            ⚠️ {MODEL_OPTIONS.find((m) => m.value === localModel)?.label} 不支持工具调用，将退化为单轮问答
          </div>
        )}

        <div className="field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>任务（可留空，用上游文本）</label>
          <textarea
            className="nodrag"
            value={localTask}
            onChange={(e) => { setLocalTask(e.target.value); updateNodeData(id, { task: e.target.value } as any); }}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="例如：查一下这家公司最近的产品动态并总结三点"
            style={{ width: '100%', minHeight: 46, border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 6px', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: '#64748b' }}>最大步数</label>
          <input
            className="nodrag"
            type="number"
            min={1}
            max={12}
            value={localSteps}
            onChange={(e) => {
              const v = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 6));
              setLocalSteps(v);
              updateNodeData(id, { maxSteps: v } as any);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 46, padding: '2px 4px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 11 }}
          />
          <button
            className="nodrag"
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowAdvanced((v) => !v); }}
            style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff', color: '#475569', cursor: 'pointer' }}
          >
            {showAdvanced ? '收起' : '高级'}
          </button>
        </div>

        {showAdvanced && (
          <>
            <div className="field" style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>系统提示词（角色/约束）</label>
              <textarea
                className="nodrag"
                value={localSystem}
                onChange={(e) => { setLocalSystem(e.target.value); updateNodeData(id, { systemPrompt: e.target.value } as any); }}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                placeholder="可选：补充 Agent 的角色定位与回答约束"
                style={{ width: '100%', minHeight: 42, border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 6px', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                <span>温度: {Number(localTemp).toFixed(1)}</span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>Agent 建议偏低</span>
              </label>
              <input
                className="nodrag"
                type="range"
                min={0}
                max={1.5}
                step={0.1}
                value={localTemp}
                onChange={(e) => { const v = parseFloat(e.target.value); setLocalTemp(v); updateNodeData(id, { temperature: v } as any); }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        {trace.length > 0 && (
          <div style={{ marginBottom: 6, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
            <button
              className="nodrag"
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowTrace((v) => !v); }}
              style={{ width: '100%', padding: '3px 6px', border: 'none', background: '#f8fafc', fontSize: 10, color: '#475569', cursor: 'pointer', textAlign: 'left' }}
            >
              {showTrace ? '▾' : '▸'} 推理过程 · {trace.length} 步
            </button>
            {showTrace && (
              <div style={{ maxHeight: 150, overflow: 'auto', padding: '4px 6px', fontSize: 10, color: '#475569', background: '#fff', lineHeight: 1.5 }}>
                {trace.map((s, i) => (
                  <div key={i} style={{ marginBottom: 4, paddingBottom: 4, borderBottom: i < trace.length - 1 ? '1px dashed #e2e8f0' : 'none' }}>
                    <div style={{ fontWeight: 600, color: '#6366f1' }}>第 {s.step} 步{s.tool ? ` · 调用 ${s.tool}` : ' · 直接回答'}</div>
                    {s.thought && <div style={{ whiteSpace: 'pre-wrap' }}>💭 {s.thought}</div>}
                    {s.tool === 'web_fetch' && s.args?.url && <div style={{ wordBreak: 'break-all' }}>🔗 {String(s.args.url)}</div>}
                    {s.observation && <div style={{ whiteSpace: 'pre-wrap', color: '#64748b' }}>👀 {s.observation}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {cachedOutput && (
          <div style={{ background: '#f5f3ff', borderRadius: 6, padding: 6, fontSize: 11, maxHeight: 90, overflow: 'auto', color: '#4338ca', whiteSpace: 'pre-wrap' }}>
            {cachedOutput.length > 220 ? `${cachedOutput.substring(0, 220)}...` : cachedOutput}
          </div>
        )}

        {d.status === 'running' && (
          <div style={{ fontSize: 11, color: '#6366f1', marginTop: 4 }}>🕵️ 推理中（可能多轮）...</div>
        )}
        {d.status === 'error' && (
          <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }} title={String(d.error || '')}>
            ❌ {String(d.error || '未知错误').substring(0, 40)}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentNode;
