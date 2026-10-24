/**
 * client/src/auth/Bell.tsx · v2.0-α Phase A 步 2
 * ---------------------------------------------------------------
 * 顶部 Bell 图标 + 未读徽标 + InboxDrawer。
 */
import { useEffect, useState } from 'react';
import InboxDrawer from './InboxDrawer';
import { authFetch } from './api';

export default function Bell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  // 轮询未读数（v2.0-α：SSE inbox channel 就绪后替换为实时推送）
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await authFetch('/api/inbox/count');
        if (cancelled) return;
        const data = await res.json();
        setUnread(data.unreadCount || 0);
      } catch {
        // server 可能没启动或 auth 未启用，静默
      }
    };
    poll();
    const id = setInterval(poll, 30000); // 30s 轮询
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // fetch-based SSE 实时 inbox。标准 EventSource 无法设置 Authorization header，
  // 因此不能并行建立 EventSource 连接，否则服务端必然返回 401 并污染控制台。
  useEffect(() => {
    let cancelled = false;
    let retryMs = 5000;

    const run = async () => {
      try {
        const token = localStorage.getItem('plotmesh_jwt');
        if (!token) return;
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE || ''}/api/events?channel=inbox`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n\n');
          buf = lines.pop() || '';
          for (const block of lines) {
            const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
            if (dataLine) {
              try {
                const payload = JSON.parse(dataLine.slice(5).trim());
                if (payload?.unreadCount !== undefined) {
                  setUnread(payload.unreadCount);
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        retryMs = Math.min(retryMs * 1.5, 60000);
        setTimeout(run, retryMs);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="通知"
        style={{
          position: 'relative',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              borderRadius: 7,
              background: '#ef4444',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <InboxDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
