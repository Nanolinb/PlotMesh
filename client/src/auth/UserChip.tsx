/**
 * client/src/auth/UserChip.tsx · v2.0-α Phase A 步 2
 * ---------------------------------------------------------------
 * 画布顶部 bar 右侧：当前登录用户名 + 色点 + 退出/切换账户下拉。
 * 仅在 auth phase === 'ready' 时渲染。
 *
 * 主题：全部使用项目实际的 CSS 变量（App.css）：
 *   --bg-card / --bg-card-body / --bg-input / --bg-overlay
 *   --text-primary / --text-secondary / --border-color / --accent / --accent-bg
 * 这样亮/暗两套主题自动适配（之前误用了不存在的 --bg-0/--text-1，导致夜间看不清）。
 */
import { useState, useRef, useEffect } from 'react';
import { useAuth } from './authContext';

export default function UserChip() {
  const { user, logout, changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user) return null;

  const handleChangePassword = async () => {
    setPwdBusy(true);
    setPwdMsg(null);
    try {
      await changePassword(curPwd, newPwd);
      setPwdMsg({ ok: true, text: '密码已修改' });
      setCurPwd('');
      setNewPwd('');
      setTimeout(() => { setShowPwdModal(false); setPwdMsg(null); }, 1200);
    } catch (err: any) {
      setPwdMsg({ ok: false, text: err.message || '修改失败' });
    } finally {
      setPwdBusy(false);
    }
  };

  const menuItemStyle = (color = 'var(--text-primary)'): React.CSSProperties => ({
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    background: 'none',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontSize: 12,
    color,
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid var(--border-color)',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 10,
    boxSizing: 'border-box',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          background: 'var(--bg-card-body)',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}
        title="点击切换用户 / 退出登录"
      >
        {/* 色点 */}
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: user.color || '#6366f1',
            flexShrink: 0,
            border: '1.5px solid rgba(255,255,255,0.8)',
          }}
        />
        <span style={{ fontWeight: 500 }}>{user.name}</span>
        <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span>
      </button>

      {open && !showPwdModal && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 160,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {/* 用户信息 */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, marginBottom: 2 }}>
              {user.name}
            </div>
            <div>{user.email}</div>
          </div>

          {/* 修改密码 */}
          <button
            onClick={() => { setOpen(false); setShowPwdModal(true); }}
            style={menuItemStyle()}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            修改密码
          </button>

          {/* 退出按钮 */}
          <button
            onClick={() => {
              setOpen(false);
              logout();
              window.location.reload();
            }}
            style={menuItemStyle('#ef4444')}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            退出登录
          </button>
        </div>
      )}

      {/* 修改密码弹窗 */}
      {showPwdModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-overlay)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPwdModal(false); }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
              padding: '20px 24px',
              minWidth: 300,
              maxWidth: 360,
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: 'var(--text-primary)' }}>
              修改密码
            </div>

            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              当前密码
            </label>
            <input
              type="password"
              value={curPwd}
              onChange={(e) => setCurPwd(e.target.value)}
              style={inputStyle}
            />

            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              新密码
            </label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              style={inputStyle}
            />

            {pwdMsg && (
              <div style={{ fontSize: 12, color: pwdMsg.ok ? '#10b981' : '#ef4444', marginBottom: 8 }}>
                {pwdMsg.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => { setShowPwdModal(false); setPwdMsg(null); }}
                style={{
                  padding: '5px 14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  background: 'var(--bg-card-body)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                取消
              </button>
              <button
                onClick={handleChangePassword}
                disabled={pwdBusy || !curPwd || !newPwd}
                style={{
                  padding: '5px 14px',
                  border: 'none',
                  borderRadius: 6,
                  background: pwdBusy || !curPwd || !newPwd ? 'var(--text-muted)' : 'var(--accent)',
                  color: '#fff',
                  cursor: pwdBusy || !curPwd || !newPwd ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {pwdBusy ? '保存中…' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
