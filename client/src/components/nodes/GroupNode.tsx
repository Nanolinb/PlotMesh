import { useState, useCallback, memo, useMemo } from 'react';
import { NodeResizer, Handle, Position, useReactFlow } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';
import { computePortPositions, type ExposedPort } from '../../utils/composite';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

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
            title="展开"
            style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', padding: '0 6px', fontSize: 11 }}
          >⤢</button>
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
  return (
    <div className={`group-node ${selected ? 'selected' : ''}`}>
      <NodeResizer
        minWidth={200}
        minHeight={120}
        isVisible={selected}
        lineStyle={{ borderColor: '#6366f1' }}
        handleStyle={{ width: 8, height: 8, backgroundColor: '#6366f1', borderRadius: 2 }}
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
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>📦 {data.label || '功能组'}</span>
          <button
            className="nodrag"
            onClick={onToggle}
            title="折叠为单节点"
            style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 4, color: 'var(--accent)', cursor: 'pointer', padding: '0 6px', fontSize: 11 }}
          >⇲</button>
        </div>
      )}
    </div>
  );
}

export default memo(GroupNode);
