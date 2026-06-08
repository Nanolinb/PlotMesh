/**
 * MentionButton · 顶栏 @ 提醒入口（v2.0 Phase C 步 7 L3）
 * ---------------------------------------------------------------
 * 自包含：仅登录态显示；点击弹 MentionDialog（@当前画布给某成员）。
 * 放在 Canvas 顶栏 Bell 旁边。取 activeCanvasId 走 nodeStore。
 */
import { useState } from 'react';
import { useAuth } from './authContext';
import { useNodeStore } from '../store/nodes';
import MentionDialog from './MentionDialog';

export default function MentionButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const activeCanvasId = useNodeStore((s) => s.activeCanvasId);

  if (!user) return null; // 离线/未登录不显示

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="@ 提醒成员看这张画布"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: 16,
          lineHeight: 1,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        @
      </button>
      {open && activeCanvasId && (
        <MentionDialog canvasId={activeCanvasId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
