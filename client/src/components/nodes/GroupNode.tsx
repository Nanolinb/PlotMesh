import { useState, useCallback, memo } from 'react';
import { NodeResizer } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function GroupNode({ id, data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '功能组');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  const commitLabel = useCallback(() => {
    setEditing(false);
    if (localLabel.trim()) {
      updateNodeData(id, { label: localLabel.trim() } as any);
    } else {
      setLocalLabel(data.label || '功能组');
    }
  }, [id, localLabel, updateNodeData, data.label]);

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
        >
          📦 {data.label || '功能组'}
        </div>
      )}
    </div>
  );
}

export default memo(GroupNode);
