/**
 * client/src/auth/LoginPage.tsx · v2.0-α Phase A 步 1.5
 * ---------------------------------------------------------------
 * 登录 / 注册页面。双模架构下只在 auth.required=true 时显示。
 *
 * 样式保持极简，与 PlotMesh 现有设计一致（暗色/浅色自适应）。
 */
import { useState } from 'react';
import { useAuth } from './authContext';

export default function LoginPage() {
  const { phase, providers, login, register, error: authError, logout } = useAuth();
  const isBootstrap = phase === 'register' || providers?.bootstrapMode === true;

  const [mode, setMode] = useState<'login' | 'register'>(isBootstrap ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (err: any) {
      setError(err?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #f8fafc)',
        color: 'var(--text-primary, #1e293b)',
      }}
    >
      <div
        style={{
          width: 360,
          padding: 28,
          borderRadius: 12,
          background: 'var(--bg-2, #fff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>PlotMesh</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
            {isBootstrap
              ? '创建首位用户，开启协作画布'
              : mode === 'login'
              ? '登录以继续'
              : '注册新账号'}
          </div>
        </div>

        {authError && (
          <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{authError}</div>
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
            {busy
              ? mode === 'login'
                ? '登录中…'
                : '注册中…'
              : mode === 'login'
              ? '登录'
              : '注册'}
          </button>
        </form>

        {!isBootstrap && (
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12 }}>
            {mode === 'login' ? (
              <span>
                还没有账号？
                <button
                  type="button"
                  onClick={() => { setMode('register'); setError(null); }}
                  style={linkStyle}
                >
                  注册
                </button>
              </span>
            ) : (
              <span>
                已有账号？
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  style={linkStyle}
                >
                  登录
                </button>
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
  background: 'var(--bg, #fff)',
  color: 'var(--text-primary, #1e293b)',
  outline: 'none',
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
