/**
 * GhostNode · AI emit dry-run 半透明预览节点（v2.0 Phase C 步 6）
 * ---------------------------------------------------------------
 * 当 aiBuilder 处于 preview 态时，pendingEmit 里"拟新建"的节点会以
 * 半透明虚线 ghost 形态渲染在画布上（不进 store，不持久化），让用户
 * 在落盘前就能看到结构会长成什么样。
 *
 * data: { ghostType, ghostLabel }
 */
import { Handle, Position } from '@xyflow/react';

type Props = { data: { ghostType?: string; ghostLabel?: string } };

const TYPE_EMOJI: Record<string, string> = {
  textPrompt: '✏️', llm: '🤖', output: '📤', textTransform: '🔤',
  condition: '🔀', webLink: '🔗', fileUpload: '📁', splitter: '🍴',
  pieChart: '🥧', barChart: '📊', extract: '📊', themeNode: '🎨',
};

export default function GhostNode({ data }: Props) {
  const emoji = TYPE_EMOJI[data.ghostType || ''] || '✨';
  return (
    <div
      style={{
        minWidth: 180, borderRadius: 8,
        border: '2px dashed #8b5cf6',
        background: 'rgba(139,92,246,0.10)',
        opacity: 0.72,
        padding: '10px 12px',
        pointerEvents: 'none',
        boxShadow: '0 0 0 4px rgba(139,92,246,0.06)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0.4 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0.4 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed' }}>
          {data.ghostLabel || data.ghostType}
        </span>
      </div>
      <div style={{ fontSize: 9, color: '#a855f7', marginTop: 3, letterSpacing: 0.3 }}>
        待应用 · {data.ghostType}
      </div>
    </div>
  );
}
