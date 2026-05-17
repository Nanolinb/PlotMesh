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
import { Handle, Position } from '@xyflow/react';
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

  // 实际渲染的端子数：
  //   manual → 用户固定 N
  //   auto   → 用户点过"生成"按钮的 autoCommittedCount；没点过时给 1（占位）
  const portCount = portMode === 'manual'
    ? manualCount
    : (autoCommittedCount && autoCommittedCount > 0 ? autoCommittedCount : 1);

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

        {/* 端子数量 */}
        <div className="field" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)' }}>端子数量</label>
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
              style={{ width: 50, padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
            />
          ) : (
            <button
              className="nodrag"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // 把当前切出的段数固化为端子数（至少 1）
                const next = Math.max(1, Math.min(20, segments.length || 1));
                updateNodeData(id, { autoCommittedCount: next } as any);
              }}
              title={
                autoNeedsRegen
                  ? `切出 ${segments.length} 段，但当前是 ${autoCommittedCount ?? 0} 个端子。点击重新生成。`
                  : segments.length > 0
                    ? `把当前 ${segments.length} 段固化为端子`
                    : '等上游有内容后再点'
              }
              disabled={segments.length === 0}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid ' + (autoNeedsRegen ? '#f59e0b' : '#d1d5db'),
                background: autoNeedsRegen ? '#fef3c7' : 'var(--bg-card-body, #fff)',
                color: autoNeedsRegen ? '#92400e' : 'var(--text-primary, #1f2937)',
                cursor: segments.length === 0 ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: segments.length === 0 ? 0.5 : 1,
              }}
            >
              {autoNeedsRegen ? `↻ 重新生成 (${segments.length})` : `▶ 生成 (${segments.length || 0})`}
            </button>
          )}
        </div>

        {/* 预览 + 警告 */}
        <div style={{
          background: '#fdf2f8',
          borderRadius: 6,
          padding: '6px 8px',
          fontSize: 11,
          color: '#9d174d',
          marginTop: 4,
        }}>
          {segments.length === 0 ? (
            <em style={{ color: '#94a3b8' }}>等待上游输入…</em>
          ) : (
            <>
              <div style={{ marginBottom: 4 }}>
                共 {segments.length} 段 · {portCount} 个端子
                {warning && <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ {warning}</span>}
              </div>
              {segments.slice(0, 5).map((seg, i) => (
                <div key={i} style={{ marginTop: 2, lineHeight: 1.3, display: 'flex', gap: 4 }}>
                  <span style={{ color: '#be185d', fontWeight: 600, minWidth: 16 }}>{i + 1}.</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {seg.slice(0, 60)}{seg.length > 60 ? '…' : ''}
                  </span>
                </div>
              ))}
              {segments.length > 5 && (
                <div style={{ color: '#9ca3af', marginTop: 2 }}>… 还有 {segments.length - 5} 段</div>
              )}
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
