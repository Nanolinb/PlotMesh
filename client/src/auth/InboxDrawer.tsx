/**
 * client/src/auth/InboxDrawer.tsx · v2.0-α Phase A 步 2
 * ---------------------------------------------------------------
 * Inbox 抽屉：显示未读/已读消息列表。
 */
import { useEffect, useState } from 'react';
import { authFetch } from './api';

export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  from: { userId: string; name: string };
  target: { canvasId?: string; nodeId?: string } | null;
  actions: { label: string; action: string; payload?: any }[];
  readAt: number | null;
  createdAt: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function InboxDrawer({ open, onClose }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      setLoading(true);
      const res = await authFetch('/api/inbox');
      const data = await res.json();
      setItems(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (e) {
      console.warn('[inbox] 拉取失败：', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await authFetch(`/api/inbox/${id}/read`, { method: 'PATCH' });
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, readAt: Date.now() } : it))
      );
      setUnreadCount((n) => Math.max(0, n - 1));
    } catch (e) {
      console.warn('[inbox] 标已读失败：', e);
    }
  };

  const markAllRead = async () => {
    try {
      await authFetch('/api/inbox/read-all', { method: 'PATCH' });
      const now = Date.now();
      setItems((prev) => prev.map((it) => ({ ...it, readAt: now })));
      setUnreadCount(0);
    } catch (e) {
      console.warn('[inbox] 全部已读失败：', e);
    }
  };

  const del = async (id: string) => {
    try {
      await authFetch(`/api/inbox/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((it) => it.id !== id));
      const wasUnread = items.find((it) => it.id === id && !it.readAt);
      if (wasUnread) setUnreadCount((n) => Math.max(0, n - 1));
    } catch (e) {
      console.warn('[inbox] 删除失败：', e);
    }
  };

  // v2.0-β Phase B 步 3：合约动作回调（接受/拒绝引用请求）
  const [actingId, setActingId] = useState<string | null>(null);
  const handleAction = async (it: InboxItem, action: string, payload?: any) => {
    const connId = payload?.connId;
    const canvasId = payload?.canvasId;
    try {
      setActingId(it.id);
      if (action === 'accept-reference' && connId) {
        const r = await authFetch(`/api/canvas/connections/${connId}/accept`, { method: 'POST' });
        if (!r.ok) throw new Error((await r.json()).error || '接受失败');
      } else if (action === 'reject-reference' && connId) {
        const r = await authFetch(`/api/canvas/connections/${connId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '' }),
        });
        if (!r.ok) throw new Error((await r.json()).error || '拒绝失败');
      } else if (action === 'retry-canvas' && canvasId) {
        // AI PM L1：失败画布一键重跑
        const r = await authFetch(`/api/canvas/${canvasId}/run`, { method: 'POST' });
        if (!r.ok) throw new Error((await r.json()).error || '触发重跑失败');
      } else if (action === 'open-canvas' && canvasId) {
        // AI PM L2 日报：跳转到对应画布
        try {
          const store = (window as any).__nodeStore;
          store?.getState?.().switchActiveCanvas?.(canvasId);
        } catch { /* ignore */ }
        onClose();
        // open-canvas 只是跳转，不标"已处理"
        return;
      } else {
        // 其它 action 暂未实现，仅标已读
        console.info('[inbox] 未处理的 action：', action);
      }
      // 动作完成 → 标已读 + 移除按钮（消息保留但 actions 清空）
      await authFetch(`/api/inbox/${it.id}/read`, { method: 'PATCH' });
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id ? { ...x, readAt: Date.now(), actions: [], body: x.body + '（已处理）' } : x
        )
      );
      setUnreadCount((n) => Math.max(0, n - 1));
    } catch (e: any) {
      alert(`操作失败：${e.message || e}`);
    } finally {
      setActingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'var(--bg-overlay)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: '90vw',
          height: '100%',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          borderLeft: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            通知 {unreadCount > 0 && <span style={{ color: '#ef4444' }}>({unreadCount})</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                全部已读
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                fontSize: 16,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {loading && items.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
              加载中…
            </div>
          )}
          {items.length === 0 && !loading && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 40, textAlign: 'center' }}>
              暂无通知
            </div>
          )}
          {items.map((it) => (
            <div
              key={it.id}
              style={{
                padding: '10px 12px',
                marginBottom: 8,
                borderRadius: 8,
                background: it.readAt ? 'transparent' : 'var(--accent-bg)',
                border: '1px solid var(--border-color)',
                opacity: it.readAt ? 0.7 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--text-primary)' }}>
                  {it.kind === 'reference' && '🔗 '}
                  {it.kind === 'execution' && '⚠️ '}
                  {it.kind === 'daily' && '📊 '}
                  {it.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(it.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                {it.body}
              </div>
              {it.actions.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {it.actions.map((a, idx) => {
                    const isReject = a.action === 'reject-reference';
                    return (
                      <button
                        key={idx}
                        disabled={actingId === it.id}
                        onClick={() => handleAction(it, a.action, a.payload)}
                        style={{
                          fontSize: 11,
                          padding: '4px 12px',
                          border: isReject ? '1px solid var(--border-color)' : '1px solid var(--accent)',
                          borderRadius: 4,
                          background: isReject ? 'var(--bg-card-body)' : 'var(--accent)',
                          color: isReject ? 'var(--text-secondary)' : '#fff',
                          cursor: actingId === it.id ? 'not-allowed' : 'pointer',
                          opacity: actingId === it.id ? 0.6 : 1,
                          fontWeight: isReject ? 400 : 600,
                        }}
                      >
                        {actingId === it.id ? '处理中…' : a.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                {!it.readAt && (
                  <button
                    onClick={() => markRead(it.id)}
                    style={{
                      fontSize: 11,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    标为已读
                  </button>
                )}
                <button
                  onClick={() => del(it.id)}
                  style={{
                    fontSize: 11,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
