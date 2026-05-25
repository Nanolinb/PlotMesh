/**
 * GenericChartNode · 自由图形节点（v1.7.0-alpha 增量）
 * ---------------------------------------------------------------
 * 当饼图 / 柱图 / 桑吉图等"专用图形节点"无法还原参考图的形态时（比如同心弧、
 * radial-bar、艺术化设计稿），用这个节点：让 LLM 看参考图 + 数据，**直接输出
 * 完整 SVG 字符串**，节点 sanitize 后塞进 DOM 渲染。
 *
 * 双输入：
 *   - 左侧上端口（id="data"）：数据 JSON（[{label,value}] 等）
 *   - 左侧下端口（id="reference"）：样式参考。可以是图片（fileUpload 接进来）
 *     或 JSON ChartStyle（ExtractNode 样式模式接进来）
 *
 * 工作流程（运行时）：
 *   1. 收上游：data + reference（可能含图片）
 *   2. 调多模态 LLM：「这是数据 X，参考图是 Y，请输出一段完整的 SVG，宽 SIZE」
 *   3. sanitize 后存进 data.svg
 *   4. 失败：display 错误 + 兜底用纯文本 fallback
 *
 * 安全：
 *   - 白名单 tags / attrs，非白名单全部剥
 *   - 移除 on*、style 里的 expression()、href 里的 javascript:
 *   - 用 DOMParser + 二次 toString，防止字符串拼接漏洞
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { MODEL_OPTIONS, type ModelType } from '../../types/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

/** 允许出现在生成 SVG 里的标签 */
const ALLOWED_SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop',
  'pattern', 'mask', 'clipPath', 'filter',
  'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feFlood', 'feComposite', 'feColorMatrix',
]);

/** 允许的属性前缀 / 字面量集合 */
const ALLOWED_ATTRS = new Set([
  'id', 'class', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'viewBox', 'preserveAspectRatio',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'transform',
  'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'dx', 'dy', 'points',
  'offset', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'patternUnits', 'patternTransform',
  'stop-color', 'stop-opacity',
  'mask', 'clip-path', 'filter',
  'href', 'xlink:href', // use 元素需要，但要校验值
  'in', 'in2', 'mode', 'result', 'stdDeviation', 'flood-color', 'flood-opacity', 'values', 'type',
]);

/**
 * sanitize SVG 字符串：剥危险标签 / 属性 / 值
 * 返回安全的 svg outerHTML，失败返回 null。
 */
export function sanitizeSvg(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  // 剥围栏
  let s = raw.trim();
  const m = s.match(/```(?:svg|xml|html)?\s*([\s\S]*?)```/i);
  if (m) s = m[1].trim();
  // 找首个 <svg ...
  const svgMatch = s.match(/<svg[\s\S]*<\/svg>/i);
  if (!svgMatch) return null;
  s = svgMatch[0];

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(s, 'image/svg+xml');
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  // 解析错误时浏览器会塞 <parsererror>
  if (doc.querySelector('parsererror')) return null;

  // 递归清洗
  const clean = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) {
      el.remove();
      return;
    }
    // attrs
    Array.from(el.attributes).forEach((a) => {
      const name = a.name.toLowerCase();
      const val = a.value || '';
      // on* 事件
      if (name.startsWith('on')) {
        el.removeAttribute(a.name);
        return;
      }
      // href / xlink:href 不能是 javascript: 或 data:text/html
      if (name === 'href' || name === 'xlink:href') {
        if (/^\s*(javascript|data:text\/html)/i.test(val)) {
          el.removeAttribute(a.name);
        }
        return;
      }
      // style 属性整个干掉（有 expression() 风险）
      if (name === 'style') {
        el.removeAttribute(a.name);
        return;
      }
      // 非白名单属性
      if (!ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(a.name);
      }
    });
    // 递归子节点
    Array.from(el.children).forEach(clean);
  };
  clean(root);

  // 强制 viewBox 存在 + 限制 width/height（防止节点被撑爆）
  if (!root.getAttribute('viewBox')) {
    const w = root.getAttribute('width') || '300';
    const h = root.getAttribute('height') || '300';
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  // 节点内固定显示尺寸
  root.setAttribute('width', '300');
  root.setAttribute('height', '220');
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  return new XMLSerializer().serializeToString(root);
}

function GenericChartNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '自由图形');
  const [localModel, setLocalModel] = useState<ModelType>(data.model || 'kimi');
  const [localCustomModel, setLocalCustomModel] = useState<string>(data.customModelName || '');
  const [localInstruction, setLocalInstruction] = useState<string>(data.instruction || '');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  useEffect(() => { setLocalTitle(data.label || '自由图形'); }, [data.label]);
  useEffect(() => { setLocalModel(data.model || 'kimi'); }, [data.model]);
  useEffect(() => { setLocalCustomModel(data.customModelName || ''); }, [data.customModelName]);
  useEffect(() => { setLocalInstruction(data.instruction || ''); }, [data.instruction]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '自由图形');
  }, [id, localTitle, updateNodeData, data.label]);

  const status = data.status || 'idle';
  const errorMsg = data.error || '';
  const svg: string = data.svg || '';

  return (
    <div className={`node-card generic-chart-node ${selected ? 'selected' : ''}`} data-status={status} style={{ minWidth: 320 }}>
      {/* 双输入：上=数据，下=参考（图片或样式 JSON） */}
      <Handle type="target" position={Position.Left} id="data" style={{ top: '35%', background: '#6366f1' }} title="数据输入" />
      <Handle type="target" position={Position.Left} id="reference" style={{ top: '70%', background: '#f59e0b' }} title="参考输入（图片或样式 JSON）" />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #f59e0b, #ec4899)' }}>
        <span className="node-icon">🎨</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '自由图形'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '自由图形'}
          </span>
        )}
      </div>

      <div className="node-body" style={{ padding: '8px' }}>
        {/* 模型 */}
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

        <div style={{ fontSize: 10, marginTop: 2 }}>
          <span
            className="nodrag"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            {showAdvanced ? '▼' : '▶'} 高级（版本号 / 渲染指引）
          </span>
        </div>

        {showAdvanced && (
          <>
            <div className="field" style={{ marginTop: 4 }}>
              <label>模型版本（可选；含图片自动用 vision 版）</label>
              <input
                className="nodrag"
                value={localCustomModel}
                onChange={(e) => { setLocalCustomModel(e.target.value); updateNodeData(id, { customModelName: e.target.value.trim() } as any); }}
                placeholder="留空 = 自动选 vision 默认"
                style={{ fontSize: 11 }}
              />
            </div>
            <div className="field">
              <label>渲染指引（自由提示）</label>
              <textarea
                className="nodrag"
                value={localInstruction}
                onChange={(e) => { setLocalInstruction(e.target.value); updateNodeData(id, { instruction: e.target.value } as any); }}
                placeholder="如：模仿参考图的同心弧形态；标签外置带引线；用饱和色"
                rows={2}
                style={{ fontSize: 11, resize: 'vertical' }}
              />
            </div>
          </>
        )}

        {/* SVG 渲染区 */}
        <div
          style={{
            marginTop: 8,
            background: 'rgba(0,0,0,0.04)',
            borderRadius: 4,
            minHeight: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {svg ? (
            // svg 已 sanitize，仅含白名单标签和属性
            <div
              style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : status === 'error' ? (
            <div style={{ fontSize: 11, color: '#ef4444', padding: '20px 8px', textAlign: 'center' }}>
              ⚠️ {errorMsg || '渲染失败'}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '20px 8px', textAlign: 'center' }}>
              等待运行…<br />
              <span style={{ fontSize: 10 }}>需要：data 端口的数据 + reference 端口的图/样式</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GenericChartNode;
