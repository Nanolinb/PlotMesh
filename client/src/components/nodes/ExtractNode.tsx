/**
 * ExtractNode · 数据 / 样式提取节点（v1.7.0-alpha 增量）
 * ---------------------------------------------------------------
 * 通用预处理工具：把任意自由文本/图片通过 LLM 规整成结构化 JSON，供下游图形节点消费。
 *
 * 模式（v1.7.0-alpha 重构）：
 *   - mode='data'：提取数据。用户选「为哪种图准备」（饼图/柱状图/桑吉/折线/通用），
 *                  自动决定 schema + keys + outputShape=array。下游接图形节点。
 *   - mode='style'：提取样式。固定 customKeys=palette/background/labelColor/borderColor，
 *                  outputShape=object。下游接图形节点的「样式」端口。
 *
 * 模型选择简化：
 *   - 普通用户只看到厂商下拉，版本号收到「高级」折叠里
 *   - 模式=style + 厂商有 vision 默认时自动填 vision 版本（用户无需关心）
 *
 * 节点本地兜底剥 ```json``` 围栏，即使 LLM 没听话也能 work。
 *
 * 输出约定：
 *   - mode='data'：`[{<keys>}, ...]` JSON 字符串
 *   - mode='style'：`{palette,background,labelColor,borderColor,...}` JSON 字符串
 *   - data.items 同时存解析后的内容供预览
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNodeStore } from '../../store/nodes';
import { MODEL_OPTIONS, type ModelType } from '../../types/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

/** 数据模式下，按"目标图类型"自动决定 schema + 提示文字 */
export const DATA_TARGETS: Record<string, { schema: string; keys: [string, string]; label: string }> = {
  pie: { schema: 'label-value', keys: ['label', 'value'], label: '🥧 饼图' },
  bar: { schema: 'label-value', keys: ['label', 'value'], label: '📊 柱状图' },
  line: { schema: 'name-value', keys: ['name', 'value'], label: '📈 折线图' },
  sankey: { schema: 'source-target-value', keys: ['source', 'target'], label: '🌊 桑吉图' },
  generic: { schema: 'name-value', keys: ['name', 'value'], label: '📦 通用键值对' },
};

/** 兼容老画布（v1.7.0-alpha.2 之前用 schema 字段，没有 mode/dataTarget） */
const LEGACY_SCHEMA_TO_TARGET: Record<string, string> = {
  'label-value': 'pie',
  'name-value': 'generic',
  'category-count': 'generic',
  'source-target-value': 'sankey',
};

/** 老接口保留，给 Canvas.tsx 的 import 兼容用 */
export const EXTRACT_SCHEMAS: Record<string, { keys: [string, string]; hint: string }> = {
  'label-value': { keys: ['label', 'value'], hint: '饼图 / 柱状图' },
  'name-value': { keys: ['name', 'value'], hint: '通用键值对' },
  'category-count': { keys: ['category', 'count'], hint: '分类计数' },
  'source-target-value': { keys: ['source', 'target'], hint: '桑吉图（流向）' },
};

/** 各厂商的 vision 版本号（输入是图片时自动填） */
export const VISION_DEFAULTS: Record<string, string> = {
  hunyuan: 'hunyuan-vision',
  glm: 'glm-4v-plus',
  gpt: 'gpt-4o',
  claude: 'claude-3-5-sonnet-20241022',
  kimi: 'moonshot-v1-8k-vision-preview',
  qwen: 'qwen-vl-plus',
};

/** 样式模式输出的固定键集（含形态字段） */
export const STYLE_KEYS = ['palette', 'background', 'labelColor', 'borderColor', 'donut', 'innerRadiusRatio', 'gapDeg', 'startAngle', 'labelMode'];

/**
 * 节点本地兜底剥 ```json``` 围栏，并尝试找到第一个完整 [...] 数组。
 * 失败返回 null（让 status='error' 给用户提示）。
 */
export function extractJsonArray(text: string): any[] | null {
  if (!text || typeof text !== 'string') return null;
  let candidate = text.trim();
  const m = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) candidate = m[1].trim();
  if (!candidate.startsWith('[')) {
    const arr = candidate.match(/\[[\s\S]*\]/);
    if (arr) candidate = arr[0];
  }
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 解析数组或单个对象。
 * 返回值统一包成数组（[obj] 或 [...]），让上层 normalize 逻辑通用。
 */
export function extractJsonValue(text: string): any[] | null {
  if (!text || typeof text !== 'string') return null;
  let candidate = text.trim();
  const m = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) candidate = m[1].trim();
  if (!/^[\[{]/.test(candidate)) {
    const arr = candidate.match(/\[[\s\S]*\]/);
    const obj = candidate.match(/\{[\s\S]*\}/);
    if (arr) candidate = arr[0];
    else if (obj) candidate = obj[0];
  }
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return null;
  } catch {
    return null;
  }
}

function ExtractNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '数据提取');
  const [localMode, setLocalMode] = useState<string>(
    data.mode || (data.schema ? 'data' : 'data'), // v1.7.0-alpha 默认 data 模式
  );
  const [localDataTarget, setLocalDataTarget] = useState<string>(
    data.dataTarget || LEGACY_SCHEMA_TO_TARGET[data.schema] || 'pie',
  );
  const [localModel, setLocalModel] = useState<ModelType>(data.model || 'deepseek');
  const [localCustomModel, setLocalCustomModel] = useState<string>(data.customModelName || '');
  const [localInstruction, setLocalInstruction] = useState<string>(data.instruction || '');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  useEffect(() => { setLocalTitle(data.label || '数据提取'); }, [data.label]);
  useEffect(() => { setLocalMode(data.mode || (data.schema ? 'data' : 'data')); }, [data.mode, data.schema]);
  useEffect(() => { setLocalDataTarget(data.dataTarget || LEGACY_SCHEMA_TO_TARGET[data.schema] || 'pie'); }, [data.dataTarget, data.schema]);
  useEffect(() => { setLocalModel(data.model || 'deepseek'); }, [data.model]);
  useEffect(() => { setLocalCustomModel(data.customModelName || ''); }, [data.customModelName]);
  useEffect(() => { setLocalInstruction(data.instruction || ''); }, [data.instruction]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '数据提取');
  }, [id, localTitle, updateNodeData, data.label]);

  const status = data.status || 'idle';
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const errorMsg = data.error || '';

  // 计算"当前生效的键名"：
  //   - mode=style → 固定 STYLE_KEYS
  //   - mode=data → 从 dataTarget 查表
  const effectiveKeys: string[] = useMemo(() => {
    if (localMode === 'style') return STYLE_KEYS;
    return DATA_TARGETS[localDataTarget]?.keys ?? ['label', 'value'];
  }, [localMode, localDataTarget]);

  // 样式模式下，从 items[0] 取调色板做缩略图
  const stylePreview = useMemo(() => {
    if (localMode !== 'style' || !items.length) return null;
    const obj = items[0];
    if (!obj || typeof obj !== 'object') return null;
    const palette = Array.isArray(obj.palette) ? obj.palette : (Array.isArray(obj.colors) ? obj.colors : []);
    const background = obj.background || obj.bg || '';
    const labelColor = obj.labelColor || obj.textColor || '';
    return {
      palette,
      background,
      labelColor,
      donut: obj.donut === true || (typeof obj.innerRadiusRatio === 'number' && obj.innerRadiusRatio > 0),
      innerRadiusRatio: obj.innerRadiusRatio,
      gapDeg: obj.gapDeg,
      labelMode: obj.labelMode,
      raw: obj,
    };
  }, [items, localMode]);

  return (
    <div className={`node-card extract-node ${selected ? 'selected' : ''}`} data-status={status} style={{ minWidth: 240 }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        className="node-header"
        style={{
          background: localMode === 'style'
            ? 'linear-gradient(135deg, #a855f7, #ec4899)'  // 样式模式紫粉
            : 'linear-gradient(135deg, #0ea5e9, #6366f1)', // 数据模式蓝紫
        }}
      >
        <span className="node-icon">{localMode === 'style' ? '🎨' : '📊'}</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '数据提取'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || (localMode === 'style' ? '样式提取' : '数据提取')}
          </span>
        )}
      </div>

      <div className="node-body">
        {/* 模式开关 */}
        <div className="field">
          <label>提取模式</label>
          <div className="nodrag" style={{ display: 'flex', gap: 4 }}>
            {[
              { v: 'data', label: '🔢 数据' },
              { v: 'style', label: '🎨 样式' },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => { setLocalMode(opt.v); updateNodeData(id, { mode: opt.v } as any); }}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  fontSize: 11,
                  border: '1px solid var(--border-color, #d1d5db)',
                  borderRadius: 4,
                  background: localMode === opt.v
                    ? (opt.v === 'style' ? '#a855f7' : '#6366f1')
                    : 'transparent',
                  color: localMode === opt.v ? 'white' : 'inherit',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 数据模式：选目标图 */}
        {localMode === 'data' && (
          <div className="field">
            <label>为哪种图准备</label>
            <select
              className="nodrag"
              value={localDataTarget}
              onChange={(e) => { setLocalDataTarget(e.target.value); updateNodeData(id, { dataTarget: e.target.value } as any); }}
            >
              {Object.entries(DATA_TARGETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* 样式模式：直接说明 */}
        {localMode === 'style' && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>
            自动提取：调色板 / 背景色 / 文字色 / 边框色（hex）。
            可接入图形节点的「样式」端口。
          </div>
        )}

        {/* 模型 —— 简化：只选厂商，版本号收到高级里 */}
        <div className="field">
          <label>模型厂商</label>
          <select
            className="nodrag"
            value={localModel}
            onChange={(e) => { setLocalModel(e.target.value as ModelType); updateNodeData(id, { model: e.target.value } as any); }}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* 高级选项（默认收起） */}
        <div style={{ fontSize: 10, marginTop: 2 }}>
          <span
            className="nodrag"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            {showAdvanced ? '▼' : '▶'} 高级（版本号 / 提取指引）
          </span>
        </div>

        {showAdvanced && (
          <>
            <div className="field" style={{ marginTop: 4 }}>
              <label>模型版本（可选；含图片时自动用 vision 版）</label>
              <input
                className="nodrag"
                value={localCustomModel}
                onChange={(e) => { setLocalCustomModel(e.target.value); updateNodeData(id, { customModelName: e.target.value.trim() } as any); }}
                placeholder={`留空 = 自动选（${VISION_DEFAULTS[localModel] || '默认版本'}）`}
                style={{ fontSize: 11 }}
              />
            </div>
            <div className="field">
              <label>提取指引（领域定制）</label>
              <textarea
                className="nodrag"
                value={localInstruction}
                onChange={(e) => { setLocalInstruction(e.target.value); updateNodeData(id, { instruction: e.target.value } as any); }}
                placeholder={localMode === 'style'
                  ? '如：色彩偏暖色调；忽略纯白和纯黑'
                  : '如：value 用亿元为单位的纯数字；按部门合计'}
                rows={2}
                style={{ fontSize: 11, resize: 'vertical' }}
              />
            </div>
          </>
        )}

        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          输出：<code>
            {localMode === 'style'
              ? `{${STYLE_KEYS.join(',')}}`
              : `[{${effectiveKeys.join(',')}}, ...]`
            }
          </code>
        </div>

        {/* 预览：data 模式列表，style 模式色块 */}
        {items.length > 0 && localMode === 'data' && (
          <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', background: 'rgba(0,0,0,0.04)', borderRadius: 4, padding: '4px 6px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>提取结果（{items.length} 项）</div>
            {items.slice(0, 6).map((it, i) => (
              <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {effectiveKeys.map((k, j) => (
                  <span key={k}>
                    {j > 0 && ' · '}
                    <span style={{ color: 'var(--text-muted)' }}>{k}:</span> {String(it?.[k] ?? '')}
                  </span>
                ))}
              </div>
            ))}
            {items.length > 6 && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>… 还有 {items.length - 6} 项</div>}
          </div>
        )}

        {stylePreview && localMode === 'style' && (
          <div style={{ marginTop: 6, fontSize: 11, background: 'rgba(0,0,0,0.04)', borderRadius: 4, padding: '6px 8px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>样式预览</div>
            {/* 调色板色块条 */}
            {stylePreview.palette.length > 0 && (
              <div style={{ display: 'flex', gap: 0, marginBottom: 6, height: 24, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-color,#e5e7eb)' }}>
                {stylePreview.palette.map((c: string, i: number) => (
                  <div key={i} style={{ flex: 1, background: c }} title={c} />
                ))}
              </div>
            )}
            {/* 关键色 */}
            <div style={{ display: 'flex', gap: 8, fontSize: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
              {stylePreview.background && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 12, background: stylePreview.background, border: '1px solid #ccc', borderRadius: 2 }} />
                  bg <code>{stylePreview.background}</code>
                </span>
              )}
              {stylePreview.labelColor && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 12, background: stylePreview.labelColor, border: '1px solid #ccc', borderRadius: 2 }} />
                  label <code>{stylePreview.labelColor}</code>
                </span>
              )}
            </div>
            {/* 形态徽标 */}
            <div style={{ display: 'flex', gap: 6, fontSize: 10, flexWrap: 'wrap' }}>
              <span style={{ background: stylePreview.donut ? '#a855f7' : 'rgba(0,0,0,0.1)', color: stylePreview.donut ? 'white' : 'inherit', padding: '1px 6px', borderRadius: 3 }}>
                {stylePreview.donut ? '🍩 环形' : '🥧 实心'}
              </span>
              {stylePreview.gapDeg && stylePreview.gapDeg > 0 && (
                <span style={{ background: 'rgba(0,0,0,0.1)', padding: '1px 6px', borderRadius: 3 }}>间隙 {stylePreview.gapDeg}°</span>
              )}
              {stylePreview.labelMode && (
                <span style={{ background: 'rgba(0,0,0,0.1)', padding: '1px 6px', borderRadius: 3 }}>
                  标签：{stylePreview.labelMode === 'inside' ? '内嵌' : stylePreview.labelMode === 'outside' ? '外置' : '隐藏'}
                </span>
              )}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>
            ⚠️ {errorMsg || '提取失败'}
          </div>
        )}
      </div>
    </div>
  );
}

export default ExtractNode;
