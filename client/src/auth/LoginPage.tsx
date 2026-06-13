/**
 * client/src/auth/LoginPage.tsx · v2.0-α Phase A 步 1.5
 * ---------------------------------------------------------------
 * 登录 / 注册 / 修改密码页面。双模架构下只在 auth.required=true 时显示。
 *
 * v2.0：新增「修改密码」模式——用户在登录页即可凭 邮箱 + 当前密码 改密，
 * 无需先登录（调 POST /api/auth/change-password-with-credentials）。
 *
 * 样式保持极简，与 PlotMesh 现有设计一致（暗色/浅色自适应）。
 */
import { useState } from 'react';
import { useAuth } from './authContext';

type Mode = 'login' | 'register' | 'changePw';

export default function LoginPage() {
  const { phase, providers, login, register, error: authError, logout } = useAuth();
  const isBootstrap = phase === 'register' || providers?.bootstrapMode === true;

  const [mode, setMode] = useState<Mode>(isBootstrap ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  // 修改密码模式专用
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setPassword('');
    setCurrentPassword('');
    setNewPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'register') {
        await register(email, password, name);
      } else {
        // changePw：调公开改密端点
        const res = await fetch('/api/auth/change-password-with-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, currentPassword, newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || '修改密码失败');
        }
        // 成功：回登录页 + 预填邮箱 + 提示
        setMode('login');
        setPassword('');
        setCurrentPassword('');
        setNewPassword('');
        setNotice('密码已修改，请用新密码登录。');
      }
    } catch (err: any) {
      setError(err?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const title = isBootstrap
    ? '创建首位用户，开启协作画布'
    : mode === 'login'
    ? '登录以继续'
    : mode === 'register'
    ? '注册新账号'
    : '修改密码';

  const submitLabel = busy
    ? mode === 'login' ? '登录中…' : mode === 'register' ? '注册中…' : '提交中…'
    : mode === 'login' ? '登录' : mode === 'register' ? '注册' : '确认修改';

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          width: 360,
          padding: 28,
          borderRadius: 12,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-card, 0 4px 20px rgba(0,0,0,0.06))',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>PlotMesh</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>{title}</div>
        </div>

        {authError && (
          <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{authError}</div>
        )}
        {notice && (
          <div style={{ fontSize: 12, color: '#10b981', marginBottom: 10 }}>{notice}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>用户名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={inputStyle}
                placeholder="你的名字"
              />
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
              placeholder="you@example.com"
            />
          </div>

          {/* 登录 / 注册：单个密码框 */}
          {(mode === 'login' || mode === 'register') && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                style={inputStyle}
                placeholder="至少 6 位"
              />
            </div>
          )}

          {/* 修改密码：当前密码 + 新密码 */}
          {mode === 'changePw' && (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>当前密码</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  style={inputStyle}
                  placeholder="输入当前密码"
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  style={inputStyle}
                  placeholder="至少 6 位"
                />
              </div>
            </>
          )}

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 6,
              padding: '10px',
              borderRadius: 8,
              border: 'none',
              background: busy ? '#cbd5e1' : 'var(--accent, #6366f1)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {submitLabel}
          </button>
        </form>

        {/* 底部模式切换 */}
        {!isBootstrap && (
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mode === 'login' && (
              <>
                <span>
                  还没有账号？
                  <button type="button" onClick={() => switchMode('register')} style={linkStyle}>注册</button>
                </span>
                <button type="button" onClick={() => switchMode('changePw')} style={linkStyle}>修改密码</button>
              </>
            )}
            {mode === 'register' && (
              <span>
                已有账号？
                <button type="button" onClick={() => switchMode('login')} style={linkStyle}>登录</button>
              </span>
            )}
            {mode === 'changePw' && (
              <span>
                想起来了？
                <button type="button" onClick={() => switchMode('login')} style={linkStyle}>返回登录</button>
              </span>
            )}
          </div>
        )}

        {phase === 'ready' && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button type="button" onClick={logout} style={{ ...linkStyle, fontSize: 11 }}>
              退出登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-color, #e2e8f0)',
  fontSize: 14,
  background: 'var(--bg-input, #fff)',
  color: 'var(--text-primary, #1e293b)',
  outline: 'none',
  boxSizing: 'border-box',
};

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent, #6366f1)',
  cursor: 'pointer',
  fontSize: 12,
  textDecoration: 'underline',
  padding: 0,
};
