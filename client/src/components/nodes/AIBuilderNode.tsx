/**
 * AIBuilderNode · AI 构建器节点（v2.0 Phase C 步 5）
 * ---------------------------------------------------------------
 * AI 读画布上下文 → 生成 EmitPlan（要新建的节点/连线/补丁）→ dry-run 预览
 * → 用户审批 → 一次性落盘（单 commit，可撤销）。
 *
 * 状态机：idle → running → preview → applied；任意步出错 → error
 *
 * 安全：dry-run 不落盘；落盘走护栏（≤20 节点 / 类型白名单 / patches 字段白名单）；
 * AI emit 出的节点不会自动再触发执行（防递归）。
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import {
  buildEmitSystemPrompt, collectContext, parseEmitPlan, sanitizeEmitPlan, assignPositions,
  type EmitPlan,
} from '../../utils/aiEmit';

type Scope = 'upstream' | 'canvas' | 'selection';
type Props = { id: string; data: any; selected?: boolean; [key: string]: any };

const MODELS = ['deepseek', 'hunyuan', 'glm', 'kimi', 'qwen', 'gpt', 'claude'];

function AIBuilderNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [localPrompt, setLocalPrompt] = useState(data.prompt || '');

  const status: string = data.status || 'idle';
  const scope: Scope = data.contextScope || 'upstream';
  const plan: EmitPlan | null = data.pendingEmit || null;
  // 是否在应用时为每个"末端结论节点"自动附加一个输出节点（默认开）
  const autoOutput: boolean = data.autoOutput !== false;

  const set = useCallback((patch: Record<string, any>) => {
    updateNodeData(id, patch as any);
  }, [id, updateNodeData]);

  // ── 运行：收集上下文 → 调 LLM → 解析 EmitPlan → 写 pendingEmit ──
  const runBuild = useCallback(async () => {
    const prompt = (localPrompt || '').trim();
    if (!prompt) { set({ status: 'error', error: '请先填写指令' }); return; }
    set({ status: 'running', error: '', prompt });
    try {
      const st = useNodeStore.getState();
      const { summary } = collectContext(scope, id, st.nodes, st.edges);
      const sysPrompt = buildEmitSystemPrompt();
      const userContent = `需求：${prompt}\n\n当前画布上下文（${scope}）：\n${summary}`;

      const resp = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model || 'deepseek',
          customModelName: data.customModelName || undefined,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          stream: false,
        }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(e.error || `HTTP ${resp.status}`);
      }
      const json = await resp.json();
      const content = json?.choices?.[0]?.message?.content || json?.content?.[0]?.text || json?.output || '';
      const parsed = parseEmitPlan(content);
      if (!parsed) throw new Error('AI 输出无法解析为 EmitPlan');
      const { plan: safe, warnings } = sanitizeEmitPlan(parsed, st.nodes);
      if (safe.nodes.length === 0 && safe.patches.length === 0) {
        throw new Error('AI 未产出任何可应用的节点/补丁');
      }
      set({
        status: 'preview',
        pendingEmit: safe,
        rationale: safe.rationale + (warnings.length ? `\n⚠️ ${warnings.join('；')}` : ''),
        error: '',
      });
    } catch (e: any) {
      set({ status: 'error', error: e.message || '运行失败' });
    }
  }, [localPrompt, scope, id, data.model, data.customModelName, set]);

  // ── 应用：把 EmitPlan 落盘（单 commit，可撤销）──
  const applyPlan = useCallback(() => {
    if (!plan) return;
    const store = useNodeStore.getState() as any;
    store.pushHistory?.();  // 落盘前存一份历史，整批可一次撤销

    const selfNode = store.nodes.find((n: any) => n.id === id);
    const anchor = selfNode?.position || { x: 0, y: 0 };
    const positions = assignPositions(plan.nodes, anchor, store.nodes);

    // tmpId → 真实 id 映射
    const idMap: Record<string, string> = {};
    const now = Date.now();
    const newNodes = plan.nodes.map((n, i) => {
      const realId = `${n.type}-${now}-${i}-${Math.random().toString(36).slice(2, 5)}`;
      idMap[n.tmpId] = realId;
      return {
        id: realId,
        type: n.type,
        position: positions[n.tmpId] || { x: anchor.x + 260, y: anchor.y + i * 160 },
        data: { type: n.type, label: n.label || n.type, status: 'idle', ...(n.data || {}), __emittedBy: id, __commitId: plan.commitId },
      };
    });

    // 边：from/to 可能是 tmpId 或现有节点 id
    const resolve = (ref: string) => idMap[ref] || ref;
    const newEdges = plan.edges.map((e, i) => ({
      id: `e-emit-${now}-${i}`,
      source: resolve(e.from),
      target: resolve(e.to),
    })).filter((e) => e.source && e.target);

    // ── v2.0 步5+：一键为"末端结论节点"生成对应数量的输出节点 ──
    // 末端结论 = 本批新建节点里、在本批 edges 中没有出边的"内容产出型"节点
    //（llm / textTransform / extract / 各类 chart 等；本身就是 output 的不再挂 output）
    const autoOutputNodes: any[] = [];
    const autoOutputEdges: any[] = [];
    if (autoOutput) {
      const CONTENT_TYPES = new Set([
        'llm', 'textTransform', 'extract', 'splitter',
        'pieChart', 'barChart', 'themeNode', 'condition', 'webLink',
      ]);
      // 统计本批每个 tmpId 作为 source 的出边数
      const outDegree = new Map<string, number>();
      plan.edges.forEach((e) => {
        // 只统计指向"本批新节点"的边（resolve 后仍是新 id 才算批内末端判断）
        outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
      });
      let oi = 0;
      plan.nodes.forEach((n) => {
        const isLeaf = (outDegree.get(n.tmpId) || 0) === 0;
        if (!isLeaf) return;
        if (!CONTENT_TYPES.has(n.type)) return; // 非内容产出型（如纯输入）不挂
        const srcRealId = idMap[n.tmpId];
        if (!srcRealId) return;
        const outId = `output-${now}-auto${oi}-${Math.random().toString(36).slice(2, 5)}`;
        const srcPos = positions[n.tmpId] || { x: anchor.x + 260, y: anchor.y + oi * 160 };
        autoOutputNodes.push({
          id: outId,
          type: 'output',
          position: { x: srcPos.x + 280, y: srcPos.y },
          data: {
            type: 'output', label: `📤 ${n.label || '输出'}`, status: 'idle',
            format: 'markdown', __emittedBy: id, __commitId: plan.commitId,
          },
        });
        autoOutputEdges.push({
          id: `e-emit-${now}-auto${oi}`,
          source: srcRealId,
          target: outId,
        });
        oi += 1;
      });
    }

    // patches：改现有节点（已护栏过滤字段）
    let patchedNodes = [...store.nodes];
    for (const p of plan.patches) {
      patchedNodes = patchedNodes.map((n) =>
        n.id === p.nodeId ? { ...n, data: { ...n.data, ...p.dataDiff } } : n
      );
    }

    useNodeStore.setState({
      nodes: [...patchedNodes, ...newNodes, ...autoOutputNodes],
      edges: [...store.edges, ...newEdges, ...autoOutputEdges],
    } as any);
    // 标记自身已应用
    updateNodeData(id, { status: 'applied', pendingEmit: null, appliedAt: now } as any);
  }, [plan, id, updateNodeData, autoOutput]);

  const discardPlan = useCallback(() => {
    set({ status: 'idle', pendingEmit: null, rationale: '' });
  }, [set]);

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '5px 7px', border: '1px solid var(--border-color)',
    borderRadius: 5, fontSize: 12, boxSizing: 'border-box',
    background: 'var(--bg-input)', color: 'var(--text-primary)',
  };

  return (
    <div className={`node-card ${selected ? 'selected' : ''}`} data-status={status === 'applied' ? 'success' : status === 'error' ? 'error' : status} style={{ minWidth: 250, borderLeft: '3px solid #8b5cf6' }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>
        <span className="node-icon">🤖</span>
        <span className="node-title" style={{ flex: 1 }}>{data.label || '🤖 AI 构建器'}</span>
      </div>

      <div className="node-body" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          className="nodrag"
          value={localPrompt}
          onChange={(e) => { setLocalPrompt(e.target.value); }}
          onBlur={() => set({ prompt: localPrompt })}
          onClick={(e) => e.stopPropagation()}
          placeholder="告诉 AI 你想搭什么，如：加一个抓取网页→提取要点→输出的流程"
          style={{ ...fieldStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="nodrag" value={scope} onChange={(e) => set({ contextScope: e.target.value })}
            onClick={(e) => e.stopPropagation()} style={{ ...fieldStyle, flex: 1 }}>
            <option value="upstream">上游上下文</option>
            <option value="canvas">整个画布</option>
            <option value="selection">选中节点</option>
          </select>
          <select className="nodrag" value={data.model || 'deepseek'} onChange={(e) => set({ model: e.target.value })}
            onClick={(e) => e.stopPropagation()} style={{ ...fieldStyle, flex: 1 }}>
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {status !== 'preview' && (
          <button className="node-action-btn nodrag"
            onClick={(e) => { e.stopPropagation(); runBuild(); }}
            disabled={status === 'running'}
            style={{ width: '100%', fontSize: 12, padding: '5px 8px', fontWeight: 600 }}>
            {status === 'running' ? '⏳ AI 生成中…' : status === 'applied' ? '🔄 再生成' : '✨ 生成结构'}
          </button>
        )}

        {status === 'error' && (
          <div style={{ fontSize: 11, color: '#ef4444' }}>❌ {String(data.error || '').slice(0, 120)}</div>
        )}

        {status === 'applied' && (
          <div style={{ fontSize: 11, color: '#22c55e' }}>✓ 已应用到画布</div>
        )}

        {/* dry-run 预览 + 审批栏 */}
        {status === 'preview' && plan && (
          <div style={{
            border: '1px dashed #8b5cf6', borderRadius: 6, padding: '8px',
            background: 'rgba(139,92,246,0.06)', fontSize: 11, color: 'var(--text-primary)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              预览方案（置信度 {Math.round((plan.confidence || 0) * 100)}%）
            </div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
              {data.rationale || plan.rationale}
            </div>
            <div style={{ marginBottom: 6 }}>
              📦 新建 <strong>{plan.nodes.length}</strong> 个节点
              · 🔗 <strong>{plan.edges.length}</strong> 条连线
              {plan.patches.length > 0 && <> · ✏️ 改 <strong>{plan.patches.length}</strong> 个现有节点</>}
            </div>
            <div style={{ maxHeight: 80, overflow: 'auto', marginBottom: 8 }}>
              {plan.nodes.map((n) => (
                <div key={n.tmpId} style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  · {n.type} 「{n.label || n.tmpId}」
                </div>
              ))}
            </div>
            {/* 一键生成输出节点开关 */}
            <label className="nodrag" onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={autoOutput}
                onChange={(e) => set({ autoOutput: e.target.checked })}
                style={{ cursor: 'pointer' }} />
              为每个结论节点自动挂输出节点
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="nodrag" onClick={(e) => { e.stopPropagation(); applyPlan(); }}
                style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 5, fontWeight: 600,
                  border: 'none', background: '#8b5cf6', color: '#fff', cursor: 'pointer' }}>
                ✓ 应用
              </button>
              <button className="nodrag" onClick={(e) => { e.stopPropagation(); discardPlan(); }}
                style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 5,
                  border: '1px solid var(--border-color)', background: 'var(--bg-card-body)',
                  color: 'var(--text-secondary)', cursor: 'pointer' }}>
                ✗ 丢弃
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIBuilderNode;
