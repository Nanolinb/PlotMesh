/**
 * SplitterNode · 分叉节点
 * ---------------------------------------------------------------
 * 把上游一段文本切成 N 段，每段对应一个独立的右侧输出端子。
 * 典型用法：LLM 返回了「3 个候选方案」，分叉节点把这 3 段分别给到 3 条独立的下游链路。
 *
 * 切分模式（splitMode）：
 *   - 'auto'         自动（按内容里识别到的结构选 json-array / numbered / list / 段落）
 *   - 'json-array'   ["a", "b", "c"] 或 [{...}, {...}]
 *   - 'numbered'     "1. xxx\n2. yyy\n3. zzz"
 *   - 'list'         "- xxx\n- yyy" / "* xxx"
 *   - 'delimiter'    自定义分隔符（如 "---" / "===" / "\n\n"）
 *   - 'regex'        正则分隔
 *
 * 端子模式（portMode）：
 *   - 'auto'   按切出来的段数动态生成端子（每段一个 source）
 *   - 'manual' 用户固定 N 个端子；切出更多段则丢弃，少了给空段并显示警告
 *
 * 节点 UI 上每个端子右侧显示该段的前 20 字预览，方便连线时知道哪条线送哪段。
 *
 * 数据契约：
 *   - 上游：左侧 1 个 target handle（id="in"）
 *   - 下游：N 个 source handle，id 形如 "out__<idx>"，竖排均匀分布
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

type SplitMode = 'auto' | 'json-array' | 'numbered' | 'list' | 'delimiter' | 'regex';

/**
 * 通用切分实现（被节点 UI 预览和执行器都用）
 * 返回的字符串数组每个元素就是一个端子要送出的内容
 */
export function splitText(
  text: string,
  mode: SplitMode,
  delimiter: string,
  regex: string,
): string[] {
  const t = (text || '').trim();
  if (!t) return [];

  // 自动模式：按可信度从高到低尝试 json → numbered → list → 段落
  if (mode === 'auto') {
    // 剥外层 markdown 代码块
    let inner = t;
    const fence = inner.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fence) inner = fence[1].trim();

    // 1) JSON 数组
    try {
      const data = JSON.parse(inner);
      if (Array.isArray(data) && data.length > 0) {
        return data.map((x) =>
          typeof x === 'string' ? x : JSON.stringify(x, null, 2)
        );
      }
    } catch {
      /* not json */
    }
    // 2) 编号列表 1. / 2. / 3.
    const numbered = inner.match(/(?:^|\n)\s*\d+[.、)]\s+[\s\S]*?(?=\n\s*\d+[.、)]\s+|$)/g);
    if (numbered && numbered.length >= 2) {
      return numbered.map((s) => s.replace(/^\s*\d+[.、)]\s+/, '').trim());
    }
    // 3) 无序列表 - / *
    const bullets = inner.match(/(?:^|\n)\s*[-*]\s+[\s\S]*?(?=\n\s*[-*]\s+|$)/g);
    if (bullets && bullets.length >= 2) {
      return bullets.map((s) => s.replace(/^\s*[-*]\s+/, '').trim());
    }
    // 4) 段落（双换行）
    const paras = inner.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (paras.length >= 2) return paras;
    // 兜底：整段当一项
    return [inner];
  }

  if (mode === 'json-array') {
    // 兼容外层代码块包裹
    let inner = t;
    const fence = inner.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fence) inner = fence[1].trim();
    try {
      const data = JSON.parse(inner);
      if (Array.isArray(data)) {
        return data.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2)));
      }
      return [];
    } catch {
      return [];
    }
  }

  if (mode === 'numbered') {
    const m = t.match(/(?:^|\n)\s*\d+[.、)]\s+[\s\S]*?(?=\n\s*\d+[.、)]\s+|$)/g);
    if (!m) return [t];
    return m.map((s) => s.replace(/^\s*\d+[.、)]\s+/, '').trim());
  }

  if (mode === 'list') {
    const m = t.match(/(?:^|\n)\s*[-*]\s+[\s\S]*?(?=\n\s*[-*]\s+|$)/g);
    if (!m) return [t];
    return m.map((s) => s.replace(/^\s*[-*]\s+/, '').trim());
  }

  if (mode === 'delimiter') {
    const sep = delimiter || '---';
    return t.split(sep).map((s) => s.trim()).filter(Boolean);
  }

  if (mode === 'regex') {
    try {
      const re = new RegExp(regex || '\\n\\n');
      return t.split(re).map((s) => s.trim()).filter(Boolean);
    } catch {
      return [t];
    }
  }

  return [t];
}

function SplitterNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  // 当端子数变化时通知 React Flow 重新计算 handle 位置（否则连线会连到旧位置）
  const updateNodeInternals = useUpdateNodeInternals();

  const splitMode: SplitMode = (data.splitMode as SplitMode) || 'auto';
  const portMode: 'auto' | 'manual' = data.portMode || 'auto';
  const manualCount: number = Math.max(1, Math.min(20, data.manualCount ?? 3));
  const delimiter: string = data.delimiter ?? '---';
  const regex: string = data.regex ?? '\\n\\n';
  const upstreamText: string = data.upstreamText || '';
  // 「自动模式」下用户点过"生成"按钮后定下来的端子数。
  // 不跟着 segments.length 实时变，避免 LLM 输出抖动时下游边乱接。
  // segments.length 与它不一致时按钮显示 ↻ 提示重新生成。
  const autoCommittedCount: number | undefined = data.autoCommittedCount;
  // 预览框高度（用户拉伸后的持久化值）
  const previewHeight: number = data.previewHeight || 120;

  // 标题编辑
  const [editingTitle, setEditingTitle] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '分叉');
  useEffect(() => { setLocalLabel(data.label || '分叉'); }, [data.label]);
  const commitLabel = useCallback(() => {
    setEditingTitle(false);
    if (localLabel.trim()) updateNodeData(id, { label: localLabel.trim() } as any);
    else setLocalLabel(data.label || '分叉');
  }, [id, localLabel, updateNodeData, data.label]);

  // 当前预览到的切分结果（用上游最近一次的文本算）
  const segments = useMemo(() => splitText(upstreamText, splitMode, delimiter, regex), [upstreamText, splitMode, delimiter, regex]);

  /**
   * 主动从上游"抓取"一次内容并刷新 upstreamText / autoCommittedCount。
   * 不触发整画布执行 —— 直接读 store 里上游节点已有的输出/文本。
   * 适用场景：上游 textPrompt 被改过、或 LLM 节点之前已经跑过有 output，
   * 用户只想刷新分叉节点端子数，不愿意再跑一遍整个流程。
   *
   * 读取规则（按节点类型）：
   *   textPrompt   → data.text
   *   llm          → data.output 或 data.streamOutput
   *   textTransform → data.output
   *   splitter     → 若边有 sourceHandle=out__<i>，按段索引取该段；否则取 segments[0]
   *   timeline     → 节点已渲染的 lines 没保存，回退取 data.upstreamText
   *   condition    → data.upstreamText（透传）
   *   fileUpload   → 把 data.files[].content 拼起来（带 <documents> 包装）
   *   group/output → 不直接抓（取它们的 data.output 兜底）
   *
   * 多条上游边：取最后一条非空的（与执行器行为一致）。
   */
  const pullUpstream = useCallback(() => {
    const state = useNodeStore.getState();
    const allNodes = state.nodes as any[];
    const allEdges = state.edges as any[];
    // 找所有指向本节点的边
    const incoming = allEdges.filter((e) => e.target === id);
    let combined = '';
    incoming.forEach((e: any) => {
      const src = allNodes.find((n: any) => n.id === e.source);
      if (!src) return;
      const sd: any = src.data || {};
      let val = '';
      switch (sd.type) {
        case 'textPrompt':
          val = sd.text || '';
          break;
        case 'llm':
          val = sd.output || sd.streamOutput || '';
          break;
        case 'textTransform':
          val = sd.output || '';
          break;
        case 'splitter': {
          // 如果边指定了 sourceHandle out__<i>，取该段；否则用整段 upstreamText 的第 0 段
          const segs = splitText(
            sd.upstreamText || '',
            (sd.splitMode as SplitMode) || 'auto',
            sd.delimiter || '---',
            sd.regex || '\\n\\n'
          );
          if (e.sourceHandle && /^out__\d+$/.test(e.sourceHandle)) {
            const idx = parseInt(e.sourceHandle.replace('out__', ''), 10);
            val = segs[idx] || '';
          } else {
            val = segs[0] || '';
          }
          break;
        }
        case 'condition':
        case 'timeline':
          val = sd.upstreamText || '';
          break;
        case 'fileUpload': {
          const files = (sd.files || []).filter((f: any) => !f.error && !f.uploading);
          if (files.length) {
            const parts = files.map((f: any) => {
              const filenameAttr = (f.name || f.originalName || '').replace(/"/g, '&quot;');
              const body = f.content || '[文件内容暂未解析]';
              return `<document filename="${filenameAttr}">\n${body}\n</document>`;
            });
            val = `<documents>\n${parts.join('\n')}\n</documents>`;
          }
          break;
        }
        default:
          val = sd.output || sd.text || sd.upstreamText || '';
      }
      if (val) combined = combined ? `${combined}\n${val}` : val;
    });

    // 写回 upstreamText 并固化端子数（按当前切出的段数）
    const segs = splitText(combined, splitMode, delimiter, regex);
    const next = Math.max(1, Math.min(20, segs.length || 1));
    updateNodeData(id, {
      upstreamText: combined,
      autoCommittedCount: next,
    } as any);
  }, [id, updateNodeData, splitMode, delimiter, regex]);

  // 实际渲染的端子数：
  //   manual → 用户固定 N
  //   auto   → 用户点过"生成"按钮的 autoCommittedCount；没点过时给 1（占位）
  const portCount = portMode === 'manual'
    ? manualCount
    : (autoCommittedCount && autoCommittedCount > 0 ? autoCommittedCount : 1);

  // 端子数变化 → 通知 React Flow 重新读取 handle DOM 位置。
  // 不加这一步的话，刚增/减出来的 handle 会有"视觉位置 ≠ 真实连线锚点"的错位。
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portCount, updateNodeInternals]);

  // auto 模式下：当前切出的段数和已生成的端子数不一致 → 提示用户点 ↻ 重新生成
  const autoNeedsRegen = portMode === 'auto'
    && segments.length > 0
    && segments.length !== autoCommittedCount;

  // 警告：手动模式下段数 ≠ 端子数
  const warning = portMode === 'manual' && segments.length > 0 && segments.length !== manualCount
    ? `切出 ${segments.length} 段 / ${manualCount} 个端子`
    : '';

  return (
    <div
      className={`node-card splitter-node ${selected ? 'selected' : ''}`}
      data-status={data.status || 'idle'}
      style={{ minWidth: 240 }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      {Array.from({ length: portCount }).map((_, idx) => {
        const top = ((idx + 1) / (portCount + 1)) * 100;
        return (
          <Handle
            key={`out-${idx}`}
            type="source"
            position={Position.Right}
            id={`out__${idx}`}
            style={{ top: `${top}%` }}
            title={`第 ${idx + 1} 段：${(segments[idx] || '').slice(0, 50)}${(segments[idx] || '').length > 50 ? '…' : ''}`}
          />
        );
      })}

      {/* 标题栏 */}
      <div
        className="node-header"
        style={{ background: 'linear-gradient(135deg, #ec4899, #f472b6)' }}
      >
        <span className="node-icon">🔀</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalLabel(data.label || '分叉'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 6, color: 'white', padding: '2px 6px', fontSize: 13 }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, cursor: 'text' }}
          >
            {data.label || '分叉'}
          </span>
        )}
      </div>

      <div className="node-body">
        {/* 切分模式 */}
        <div className="field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>切分模式</label>
          <select
            className="nodrag"
            value={splitMode}
            onChange={(e) => updateNodeData(id, { splitMode: e.target.value } as any)}
            style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
          >
            <option value="auto">自动（识别 JSON / 编号 / 列表 / 段落）</option>
            <option value="json-array">JSON 数组</option>
            <option value="numbered">编号列表（1. 2. 3.）</option>
            <option value="list">无序列表（- / *）</option>
            <option value="delimiter">自定义分隔符</option>
            <option value="regex">正则分隔</option>
          </select>
        </div>

        {/* 自定义分隔符 / 正则的输入框 */}
        {splitMode === 'delimiter' && (
          <div className="field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>分隔符（如 ---、===、||）</label>
            <input
              className="nodrag"
              value={delimiter}
              onChange={(e) => updateNodeData(id, { delimiter: e.target.value } as any)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
            />
          </div>
        )}
        {splitMode === 'regex' && (
          <div className="field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>正则（默认按双换行）</label>
            <input
              className="nodrag"
              value={regex}
              onChange={(e) => updateNodeData(id, { regex: e.target.value } as any)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="\\n\\n"
              style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, fontFamily: 'monospace' }}
            />
          </div>
        )}

        {/* 输出端子数量 — 排版与"切分模式"一致：label 在上，模式选择 + 数字/按钮在下一行 */}
        <div className="field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>输出端子数量</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              className="nodrag"
              value={portMode}
              onChange={(e) => updateNodeData(id, { portMode: e.target.value } as any)}
              style={{ flex: 1, padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
            >
              <option value="auto">自动（按段数）</option>
              <option value="manual">手动（固定 N）</option>
            </select>
            {portMode === 'manual' ? (
              <input
                className="nodrag"
                type="number"
                min={1}
                max={20}
                value={manualCount}
                onChange={(e) => updateNodeData(id, { manualCount: parseInt(e.target.value || '3', 10) } as any)}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 56, padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
              />
            ) : (
              <button
                className="nodrag"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // 主动抓取一次上游内容并用当前段数刷新端子数。
                  // 不需要触发画布全量运行——直接读 store 里上游节点已有的 output / text。
                  pullUpstream();
                }}
                title={
                  autoNeedsRegen
                    ? `切出 ${segments.length} 段，但当前是 ${autoCommittedCount ?? 0} 个端子。点击重新抓取上游并生成。`
                    : `主动抓取上游内容并按段数生成端子（当前 ${segments.length} 段）`
                }
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid ' + (autoNeedsRegen ? '#f59e0b' : '#d1d5db'),
                  background: autoNeedsRegen ? '#fef3c7' : 'var(--bg-card-body, #fff)',
                  color: autoNeedsRegen ? '#92400e' : 'var(--text-primary, #1f2937)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {autoNeedsRegen ? `↻ 重新抓取 (${segments.length})` : `▶ 抓取并生成 (${segments.length || 0})`}
              </button>
            )}
          </div>
        </div>

        {/* 预览 + 警告（外层 div 支持垂直拖拽 resize；高度持久化到 data.previewHeight） */}
        <div
          className="nodrag nowheel"
          style={{
            background: '#fdf2f8',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 11,
            color: '#9d174d',
            marginTop: 4,
            height: previewHeight,
            minHeight: 60,
            maxHeight: 600,
            resize: 'vertical',
            overflow: 'auto',
            // 用户停止拖拽（mouseup）时把高度写回 store
          }}
          onMouseUp={(e) => {
            // offsetHeight 不受 React Flow viewport 的 transform 缩放影响（getBoundingClientRect 会受影响）
            const h = (e.currentTarget as HTMLDivElement).offsetHeight;
            const rounded = Math.max(60, Math.min(600, Math.round(h)));
            if (rounded !== previewHeight) {
              updateNodeData(id, { previewHeight: rounded } as any);
            }
          }}
        >
          {segments.length === 0 ? (
            <em style={{ color: '#94a3b8' }}>等待上游输入…</em>
          ) : (
            <>
              <div style={{ marginBottom: 4 }}>
                共 {segments.length} 段 · {portCount} 个端子
                {warning && <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ {warning}</span>}
              </div>
              {segments.map((seg, i) => (
                <div key={i} style={{ marginTop: 2, lineHeight: 1.4, display: 'flex', gap: 4 }}>
                  <span style={{ color: '#be185d', fontWeight: 600, minWidth: 16 }}>{i + 1}.</span>
                  <span
                    style={{
                      // 拉高时显示完整内容（保留换行）；只在单行时省略
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      flex: 1,
                    }}
                  >
                    {seg}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {data.status === 'running' && (
          <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 4 }}>⏳ 切分中...</div>
        )}
        {data.status === 'error' && (
          <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>❌ {(data.error || '').toString().slice(0, 30)}</div>
        )}
      </div>
    </div>
  );
}

export default SplitterNode;
