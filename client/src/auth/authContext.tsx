/**
 * client/src/auth/authContext.tsx · v2.0-α Phase A 步 1.5
 * ---------------------------------------------------------------
 * 管理用户认证状态、JWT 持久化、离线/联网模式切换。
 *
 * 双模架构：
 *   - server 的 auth.required = false（默认）→ 前端不强制登录，直接进画布
 *   - auth.required = true  → 必须登录后才能使用
 *   - bootstrapMode（required=true 且 hasAnyUser=false）→ 引导创建首位用户
 *
 * Token 存储：localStorage `plotmesh_jwt`
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'plotmesh_jwt';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  color: string;
  role?: string;
}

export interface AuthProvidersInfo {
  providers: { id: string; name: string }[];
  required: boolean;
  allowSelfRegister: boolean;
  hasAnyUser: boolean;
  bootstrapMode: boolean;
}

type AuthPhase =
  | 'checking'      // 正在 GET /api/auth/providers
  | 'optional'      // required=false，无需登录
  | 'login'         // required=true，无 token → 显示登录页
  | 'register'      // bootstrapMode → 显示注册页（首位用户）
  | 'ready'         // required=true，有 token → 已认证
  | 'error';

interface AuthState {
  phase: AuthPhase;
  user: AuthUser | null;
  token: string | null;
  providers: AuthProvidersInfo | null;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setPhase: (phase: AuthPhase) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function parseUserFromToken(token: string | null): AuthUser | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      color: payload.color,
      role: payload.role || 'member',
    };
  } catch {
    return null;
  }
}

async function fetchProviders(): Promise<AuthProvidersInfo | null> {
  try {
    const res = await fetch('/api/auth/providers', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchMe(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    phase: 'checking',
    user: null,
    token: readStoredToken(),
    providers: null,
    error: null,
  });

  const setPhase = useCallback((phase: AuthPhase) => {
    setState((s) => ({ ...s, phase }));
  }, []);

  const setAuth = useCallback((token: string | null, user?: AuthUser | null) => {
    writeStoredToken(token);
    setState((s) => ({
      ...s,
      token,
      user: user ?? (token ? parseUserFromToken(token) : null),
    }));
  }, []);

  /** 初始化：检测 server 是否需要登录 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await fetchProviders();
      if (cancelled) return;

      if (!info) {
        // server 完全不可用（404 / 断网）→ 当离线处理
        setState((s) => ({ ...s, phase: 'optional', providers: null }));
        return;
      }

      if (!info.required) {
        setState((s) => ({ ...s, phase: 'optional', providers: info }));
        return;
      }

      // required = true
      const stored = readStoredToken();
      if (!stored) {
        if (info.bootstrapMode) {
          setState((s) => ({ ...s, phase: 'register', providers: info }));
        } else {
          setState((s) => ({ ...s, phase: 'login', providers: info }));
        }
        return;
      }

      // 有 token，验证有效性
      const user = await fetchMe(stored);
      if (cancelled) return;
      if (user) {
        setState((s) => ({ ...s, phase: 'ready', user, token: stored, providers: info }));
      } else {
        writeStoredToken(null);
        if (info.bootstrapMode) {
          setState((s) => ({ ...s, phase: 'register', providers: info }));
        } else {
          setState((s) => ({ ...s, phase: 'login', providers: info }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '登录失败');
    }
    setAuth(data.token, data.user);
    setState((s) => ({ ...s, phase: 'ready', error: null }));
  }, [setAuth]);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '注册失败');
    }
    setAuth(data.token, data.user);
    setState((s) => ({ ...s, phase: 'ready', error: null }));
  }, [setAuth]);

  const logout = useCallback(() => {
    writeStoredToken(null);
    setState((s) => ({
      ...s,
      token: null,
      user: null,
      phase: s.providers?.required ? 'login' : 'optional',
      error: null,
    }));
    // 清掉后端 session（虽然无状态，但保持习惯）
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const token = readStoredToken();
    if (!token) throw new Error('未登录');
    const res = await fetch('/api/auth/change-password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '修改密码失败');
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, login, register, logout, changePassword, setPhase }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内部使用');
  return ctx;
}

/** 供外部 API 调用时读取当前 token */
export function getCurrentToken(): string | null {
  return readStoredToken();
}
