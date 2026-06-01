/**
 * ThemeNode · 主题节点（v2.0-β Phase B 步 4）
 * ---------------------------------------------------------------
 * 把"管理者定调 × 设计师样式"合并成有效主题，沿连线广播给下游子节点。
 *
 * 三种角色（role）：
 *   - tone   定调：基调 tone / 受众 audience / 禁忌词 taboo
 *   - style  样式：配色 palette / 字体 font / 版式 layout
 *   - merged 合并：读上游所有 tone+style 节点，合成 effectiveTheme（只读展示）
 *
 * 合并节点（merged）连线到子节点时，由 Canvas 的边监听把 effectiveTheme
 * 注入子节点 data.appliedTheme（见 Task 62）。本组件只负责：
 *   1) tone/style 角色的输入 UI
 *   2) merged 角色实时计算并展示合并结果（计算逻辑在 store 选择器）
 */
import { Handle, Position } from '@xyflow/react';
import { useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { computeEffectiveTheme } from '../../utils/themeMerge';

type Role = 'tone' | 'style' | 'merged';
type Props = {
  id: string;
  data: any;
  selected?: boolean;
  [key: string]: any;
};

const PALETTES = ['蓝灰', '暖橙', '森绿', '玫红', '中性灰', '科技紫'];
const FONTS = ['无衬线', '衬线', '等宽', '圆体'];
const LAYOUTS = ['标准', '紧凑', '宽松', '杂志'];

function ThemeNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const role: Role = data.role || 'tone';

  // merged 角色：实时从上游 tone+style 节点合成有效主题
  const nodes = useNodeStore((s) => s.nodes);
  const edges = useNodeStore((s) => s.edges);
  const effective = role === 'merged' ? computeEffectiveTheme(id, nodes, edges) : null;

  const setRole = useCallback((r: Role) => {
    updateNodeData(id, { role: r } as any);
  }, [id, updateNodeData]);

  const set = useCallback((patch: Record<string, any>) => {
    updateNodeData(id, patch as any);
  }, [id, updateNodeData]);

  // 头部渐变色按角色区分
  const headerBg =
    role === 'tone' ? 'linear-gradient(135deg, #d97706, #f59e0b)' :
    role === 'style' ? 'linear-gradient(135deg, #7c3aed, #a855f7)' :
    'linear-gradient(135deg, #0f766e, #14b8a6)';
  const icon = role === 'tone' ? '🎯' : role === 'style' ? '🎨' : '✨';
  const roleLabel = role === 'tone' ? '定调' : role === 'style' ? '样式' : '合并主题';

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 7px',
    border: '1px solid var(--border-color)',
    borderRadius: 5,
    fontSize: 12,
    marginBottom: 6,
    boxSizing: 'border-box',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2,
  };

  return (
    <div className={`node-card theme-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'} style={{ minWidth: 220 }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: headerBg }}>
        <span className="node-icon">{icon}</span>
        <span className="node-title" style={{ flex: 1 }}>{data.label || '🎨 主题'}</span>
        {/* 角色切换 */}
        <select
          className="nodrag"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          onClick={(e) => e.stopPropagation()}
          title="切换主题节点角色"
          style={{
            background: 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.5)',
            borderRadius: 5, color: '#fff', fontSize: 11, padding: '1px 4px', cursor: 'pointer',
          }}
        >
          <option value="tone">定调</option>
          <option value="style">样式</option>
          <option value="merged">合并</option>
        </select>
      </div>

      <div className="node-body" style={{ padding: '8px 10px' }}>
        {role === 'tone' && (
          <>
            <label style={labelStyle}>基调</label>
            <input className="nodrag" style={fieldStyle} value={data.tone || ''}
              onChange={(e) => set({ tone: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder="如：专业严谨 / 活泼亲和" />
            <label style={labelStyle}>目标受众</label>
            <input className="nodrag" style={fieldStyle} value={data.audience || ''}
              onChange={(e) => set({ audience: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder="如：企业客户 / 年轻用户" />
            <label style={labelStyle}>禁忌词（逗号分隔）</label>
            <input className="nodrag" style={{ ...fieldStyle, marginBottom: 0 }} value={data.taboo || ''}
              onChange={(e) => set({ taboo: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder="如：绝对,最佳,第一" />
          </>
        )}

        {role === 'style' && (
          <>
            <label style={labelStyle}>配色</label>
            <select className="nodrag" style={fieldStyle} value={data.palette || '蓝灰'}
              onChange={(e) => set({ palette: e.target.value })}
              onClick={(e) => e.stopPropagation()}>
              {PALETTES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label style={labelStyle}>字体</label>
            <select className="nodrag" style={fieldStyle} value={data.font || '无衬线'}
              onChange={(e) => set({ font: e.target.value })}
              onClick={(e) => e.stopPropagation()}>
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <label style={labelStyle}>版式</label>
            <select className="nodrag" style={{ ...fieldStyle, marginBottom: 0 }} value={data.layout || '标准'}
              onChange={(e) => set({ layout: e.target.value })}
              onClick={(e) => e.stopPropagation()}>
              {LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </>
        )}

        {role === 'merged' && (
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
            {effective && (effective.hasTone || effective.hasStyle) ? (
              <>
                <div style={{
                  fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6,
                  paddingBottom: 6, borderBottom: '1px dashed var(--border-color)',
                }}>
                  有效主题（合并 {effective.sources} 个上游）
                </div>
                {effective.hasTone ? (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>🎯 定调</div>
                    <div>{effective.tone || '—'}{effective.audience ? ` · ${effective.audience}` : ''}</div>
                    {effective.taboo && <div style={{ fontSize: 10, color: '#ef4444' }}>禁忌：{effective.taboo}</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>⚠️ 未连接定调节点</div>
                )}
                {effective.hasStyle ? (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>🎨 样式</div>
                    <div>{effective.palette} / {effective.font} / {effective.layout}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>⚠️ 未连接样式节点</div>
                )}
              </>
            ) : (
              <div style={{
                fontSize: 11, color: 'var(--text-muted)',
                border: '1px dashed var(--border-color)', borderRadius: 5, padding: '10px 8px', textAlign: 'center',
              }}>
                把「定调」「样式」节点连到这里 →<br />自动合成有效主题
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
              连到下游子节点即广播此主题
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ThemeNode;
