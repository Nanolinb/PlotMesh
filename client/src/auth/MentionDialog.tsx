/**
 * MentionDialog · @提醒成员看画布（v2.0 Phase C 步 7 L3 发起端）
 * ---------------------------------------------------------------
 * 选一个成员 + 写一句话 → POST /api/canvas/:id/mention
 * 后端会自动把当前画布 share 给对方 + 投 mention inbox + SSE 推送。
 *
 * 仅联网模式（有 user）下有意义；成员列表来自 /api/auth/admin/users（admin）
 * 或退化为手输邮箱（非 admin 也能 @）。
 */
import { useEffect, useState } from 'react';
import { authFetch } from './api';

interface Props {
  canvasId: string;
  nodeId?: string | null;
  onClose: () => void;
}

interface Member { id: string; name: string; email: string; }

export default function MentionDialog({ canvasId, nodeId = null, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [toEmail, setToEmail] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 尝试拉成员列表（admin 才有权限；失败则降级为手输邮箱）
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch('/api/auth/admin/users');
        if (!r.ok) return;
        const d = await r.json();
        setMembers(d.users || []);
      } catch { /* 非 admin，用邮箱输入 */ }
    })();
  }, []);

  const submit = async () => {
    if (!toUserId && !toEmail.trim()) { setMsg({ ok: false, text: '请选择或填写要 @ 的成员' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const body: any = { nodeId, message: message.trim() };
      if (toUserId) body.toUserId = toUserId;
      else body.toEmail = toEmail.trim();
      const r = await authFetch(`/api/canvas/${canvasId}/mention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '发送失败');
      setMsg({ ok: true, text: d.autoShared ? '已 @ 对方并共享了画布' : '已 @ 对方' });
      setTimeout(onClose, 1000);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || '发送失败' });
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%', padding: '7px 9px', borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
    border: '1px solid var(--border-color)', background: 'var(--bg-input)',
    color: 'var(--text-primary)', marginBottom: 10,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'var(--bg-overlay)', zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 10, padding: '20px 24px', minWidth: 320, maxWidth: 380,
        color: 'var(--text-primary)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          💬 @ 提醒成员{nodeId ? '看此节点' : '看这张画布'}
        </div>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          选择成员
        </label>
        {members.length > 0 ? (
          <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} style={field}>
            <option value="">— 请选择 —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}（{m.email}）</option>
            ))}
          </select>
        ) : (
          <input
            type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)}
            placeholder="对方邮箱" style={field}
          />
        )}

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          留言（可选）
        </label>
        <textarea
          value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="想让对方关注什么…"
          style={{ ...field, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }}
        />

        {msg && (
          <div style={{ fontSize: 12, color: msg.ok ? '#10b981' : '#ef4444', marginBottom: 8 }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={{
            padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)',
          }}>取消</button>
          <button onClick={submit} disabled={busy} style={{
            padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none',
            background: busy ? 'var(--text-muted)' : 'var(--accent)', color: '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}>{busy ? '发送中…' : '发送'}</button>
        </div>
      </div>
    </div>
  );
}
