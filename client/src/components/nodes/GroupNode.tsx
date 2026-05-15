import { useState, useCallback, memo, useMemo } from 'react';
import { NodeResizer, Handle, Position, useReactFlow } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';
import { computePortPositions, type ExposedPort } from '../../utils/composite';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

/** 折叠图标：两个 45° 朝内的箭头（缩小为黑盒） */
function CollapseIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 左上 → 中心 */}
      <path d="M2 2 L7 7 M3 6 L7 6 L7 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* 右下 → 中心 */}
      <path d="M14 14 L9 9 M13 10 L9 10 L9 14" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 展开图标：两个 45° 朝外的箭头（撑开看内部） */
function ExpandIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 中心 → 左上 */}
      <path d="M7 7 L2 2 M2 6 L2 2 L6 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* 中心 → 右下 */}
      <path d="M9 9 L14 14 M14 10 L14 14 L10 14" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * GroupNode 是复合节点的容器：
 *  - 默认展开态：透明虚线大框，子节点摆在里面
 *  - 折叠态（data.collapsed=true）：变成单一节点卡片，对外暴露推断出的端口
 */
function GroupNode({ id, data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '功能组');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const toggleCollapse = useNodeStore((s) => s.toggleGroupCollapsed);
  const rf = useReactFlow();

  const collapsed = !!data.collapsed;
  const ports: ExposedPort[] = data.exposedPorts || [];
  const portPositions = useMemo(() => computePortPositions(ports), [ports]);

  const commitLabel = useCallback(() => {
    setEditing(false);
    if (localLabel.trim()) {
      updateNodeData(id, { label: localLabel.trim() } as any);
    } else {
      setLocalLabel(data.label || '功能组');
    }
  }, [id, localLabel, updateNodeData, data.label]);

  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleCollapse(id);
      // 折叠/展开后 viewport 没变，但子节点显示状态变化，调用 setNodes 触发刷新
      rf.setNodes((nodes) => [...nodes]);
    },
    [id, toggleCollapse, rf]
  );

  /* ===== 折叠态：渲染为单一节点 ===== */
  if (collapsed) {
    const inputs = ports.filter((p) => p.role === 'input' && p.exposed);
    const outputs = ports.filter((p) => p.role === 'output' && p.exposed);
    return (
      <div className={`node-card composite-node-collapsed ${selected ? 'selected' : ''}`}>
        {/* 输入 handle */}
        {inputs.map((p) => (
          <Handle
            key={p.id}
            id={p.id}
            type="target"
            position={Position.Left}
            style={{ top: `${portPositions[p.id] || 50}%` }}
            title={p.description || p.label}
          />
        ))}
        {/* 输出 handle */}
        {outputs.map((p) => (
          <Handle
            key={p.id}
            id={p.id}
            type="source"
            position={Position.Right}
            style={{ top: `${portPositions[p.id] || 50}%` }}
            title={p.description || p.label}
          />
        ))}

        <div className="node-header" style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
          <span className="node-icon">📦</span>
          {editing ? (
            <input
              className="nodrag"
              autoFocus
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLabel();
                if (e.key === 'Escape') { setEditing(false); setLocalLabel(data.label || '功能组'); }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '12px', outline: 'none' }}
            />
          ) : (
            <span
              className="node-title"
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
              title="双击重命名 / 单击右上 ⤢ 展开"
              style={{ flex: 1, cursor: 'text' }}
            >
              {data.label || '功能组'}
            </span>
          )}
          <button
            className="nodrag"
            onClick={onToggle}
            title="展开看内部"
            style={{ background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 4, color: 'white', cursor: 'pointer', padding: '2px 7px', display: 'inline-flex', alignItems: 'center' }}
          ><ExpandIcon size={13} color="white" /></button>
        </div>

        <div className="node-body" style={{ padding: '6px 8px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {(data.childCount ?? '?')} 个子节点 · {inputs.length} 入 / {outputs.length} 出
          </div>
        </div>
      </div>
    );
  }

  /* ===== 展开态：原虚线大框 ===== */
  // 状态颜色：running 橙；error 红；success / 默认 紫
  const status = data.status as ('idle' | 'running' | 'success' | 'error' | undefined);
  const accentColor =
    status === 'running' ? '#f59e0b'
      : status === 'error' ? '#ef4444'
        : '#6366f1'; // success 和 idle 都用默认紫
  const headerBg =
    status === 'running' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
      : status === 'error' ? 'linear-gradient(135deg, #ef4444, #f87171)'
        : 'linear-gradient(135deg, #6366f1, #818cf8)';
  const handleRunGroup = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const fn = (window as any).__pmRunGroup;
    if (typeof fn === 'function') fn(id);
  }, [id]);

  return (
    <div className={`group-node ${selected ? 'selected' : ''}`} data-status={status || 'idle'}>
      <NodeResizer
        minWidth={200}
        minHeight={120}
        isVisible={selected}
        lineStyle={{ borderColor: accentColor }}
        handleStyle={{ width: 8, height: 8, backgroundColor: accentColor, borderRadius: 2 }}
      />
      {editing ? (
        <input
          className="group-node-label-input nodrag"
          autoFocus
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitLabel();
            if (e.key === 'Escape') { setEditing(false); setLocalLabel(data.label || '功能组'); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="group-node-label"
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="双击重命名"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: headerBg,
            gap: 4,
          }}
        >
          <span>📦 {data.label || '功能组'}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {/* 仅运行本 group 内子节点 */}
            <button
              className="nodrag group-collapse-btn"
              onClick={handleRunGroup}
              disabled={status === 'running'}
              title={status === 'running' ? '正在运行…' : '只运行本分组内的节点（不会触发画布上的其它节点）'}
              style={{ background: status === 'running' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.3)', cursor: status === 'running' ? 'wait' : 'pointer' }}
            >
              {status === 'running' ? '⏳' : '▶'}
            </button>
            <button
              className="nodrag group-collapse-btn"
              onClick={onToggle}
              title="折叠为单节点（黑盒）"
            >
              <CollapseIcon size={14} color="white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(GroupNode);
