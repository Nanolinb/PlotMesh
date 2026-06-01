/**
 * AdminPanel · 管理员后台面板（v2.0-β，v2.0 增强）
 * ---------------------------------------------------------------
 * 仅 admin 可见（由父组件 ApiKeyConfigModal 按 useAuth().user.role 控制是否渲染 tab）。
 * 三个子区：
 *   👤 成员管理：列出所有用户 / 删除 / 重置密码 / 改角色（admin↔member）
 *   ⚙️ server 设置：联网模式(required) / 自助注册(allowSelfRegister) / 远端访问(remoteAccess) 开关
 *   📜 引用审计：connectionsArchive（rejected/cancelled 的跨画布引用历史）
 *
 * 后端：
 *   GET/DELETE/PATCH  /api/auth/admin/users[/:id[/reset-password|/role]]
 *   GET/PATCH         /api/auth/admin/server-config
 *   GET               /api/auth/admin/audit
 * 鉴权：authFetch 自动带 JWT；后端 requireAdmin 校验 role。
 */
import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../auth/api';
import { useAuth } from '../auth/authContext';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  color?: string;
  createdAt?: number;
}

interface ServerCfg {
  remoteAccess: boolean;
  auth: { required: boolean; allowSelfRegister: boolean };
}

interface AuditRecord {
  id: string;
  status: string;
  srcCanvasName: string;
  dstCanvasName: string;
  requestedBy: string | null;
  decidedAt: number | null;
  cancelledAt: number | null;
  history: Array<{ at: number; by: string | null; action: string; reason?: string }>;
}

type Sub = 'users' | 'server' | 'audit';

export default function AdminPanel() {
  const { user: me } = useAuth();
  const [sub, setSub] = useState<Sub>('users');

  return (
    <div>
      {/* 子区切换 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {([
          { key: 'users', label: '👤 成员' },
          { key: 'server', label: '⚙️ server 设置' },
          { key: 'audit', label: '📜 引用审计' },
        ] as Array<{ key: Sub; label: string }>).map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border-color)',
              background: sub === t.key ? 'var(--accent)' : 'transparent',
              color: sub === t.key ? '#fff' : 'var(--text-secondary)',
              fontWeight: sub === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'users' && <UsersSection me={me} />}
      {sub === 'server' && <ServerSection />}
      {sub === 'audit' && <AuditSection />}
    </div>
  );
}

// ════════════════════════ 成员管理 ════════════════════════

function UsersSection({ me }: { me: { id: string } | null }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [newPwd, setNewPwd] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await authFetch('/api/auth/admin/users');
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '加载失败');
      setUsers(d.users || []);
    } catch (e: any) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (u: AdminUser) => {
    if (!confirm(`确认删除用户「${u.name}」(${u.email})？\n此操作不可恢复。`)) return;
    setBusyId(u.id);
    try {
      const r = await authFetch(`/api/auth/admin/users/${u.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '删除失败');
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e: any) {
      alert(`删除失败：${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const doReset = async () => {
    if (!resetFor) return;
    if (!newPwd || newPwd.length < 6) { alert('新密码至少 6 位'); return; }
    setBusyId(resetFor.id);
    try {
      const r = await authFetch(`/api/auth/admin/users/${resetFor.id}/reset-password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPwd }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '重置失败');
      alert(`已重置「${resetFor.name}」的密码`);
      setResetFor(null);
      setNewPwd('');
    } catch (e: any) {
      alert(`重置失败：${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleRole = async (u: AdminUser) => {
    const next = u.role === 'admin' ? 'member' : 'admin';
    if (!confirm(`把「${u.name}」设为${next === 'admin' ? '管理员' : '普通成员'}？`)) return;
    setBusyId(u.id);
    try {
      const r = await authFetch(`/api/auth/admin/users/${u.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '改角色失败');
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: next } : x)));
    } catch (e: any) {
      alert(`操作失败：${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const btn = (color: string): React.CSSProperties => ({
    fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
    border: `1px solid ${color}`, background: 'transparent', color,
    whiteSpace: 'nowrap',
  });

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
        管理已注册成员：重置密码、删除、设/取消管理员。
        <br />第一个注册的用户自动成为管理员。不能删除或降级最后一个管理员。
      </p>

      {err && (
        <div style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 12 }}>
          {err}
        </div>
      )}
      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中…</div>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map((u) => {
            const isMe = u.id === me?.id;
            return (
              <div
                key={u.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card-body)',
                }}
              >
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                  background: u.color || '#6366f1',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {u.name}
                    {u.role === 'admin' && (
                      <span style={{
                        fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 8,
                        background: 'rgba(99,102,241,0.15)', color: 'var(--accent)',
                      }}>管理员</span>
                    )}
                    {isMe && <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-muted)' }}>（我）</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btn('var(--accent)')} disabled={busyId === u.id}
                    onClick={() => { setResetFor(u); setNewPwd(''); }}>重置密码</button>
                  <button style={btn('var(--text-secondary)')} disabled={busyId === u.id || isMe}
                    onClick={() => toggleRole(u)} title={isMe ? '不能改自己的角色' : ''}>
                    {u.role === 'admin' ? '降为成员' : '设为管理员'}
                  </button>
                  <button style={btn('#ef4444')} disabled={busyId === u.id || isMe}
                    onClick={() => del(u)} title={isMe ? '不能删除自己' : ''}>删除</button>
                </div>
              </div>
            );
          })}
          {users.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>暂无用户</div>}
        </div>
      )}

      {/* 重置密码弹窗 */}
      {resetFor && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'var(--bg-overlay)', zIndex: 10002,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setResetFor(null); }}
        >
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 10, padding: '20px 24px', minWidth: 300, color: 'var(--text-primary)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
              重置「{resetFor.name}」的密码
            </div>
            <input
              type="text"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="新密码（至少 6 位）"
              style={{
                width: '100%', padding: '7px 9px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border-color)', boxSizing: 'border-box',
                background: 'var(--bg-input)', color: 'var(--text-primary)', marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setResetFor(null)} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)',
              }}>取消</button>
              <button onClick={doReset} disabled={busyId === resetFor.id} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: 'none', background: 'var(--accent)', color: '#fff',
                cursor: busyId === resetFor.id ? 'not-allowed' : 'pointer',
              }}>{busyId === resetFor.id ? '重置中…' : '确认重置'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════ server 设置 ════════════════════════

function ServerSection() {
  const [cfg, setCfg] = useState<ServerCfg | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await authFetch('/api/auth/admin/server-config');
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '加载失败');
      setCfg(d);
    } catch (e: any) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = async (body: any) => {
    setBusy(true);
    try {
      const r = await authFetch('/api/auth/admin/server-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '更新失败');
      setCfg(d.config);
      if (d.restartRequired) setRestartHint(true);
    } catch (e: any) {
      alert(`更新失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        width: 42, height: 24, borderRadius: 12, border: 'none', position: 'relative',
        background: on ? 'var(--accent)' : 'var(--border-color)',
        cursor: busy ? 'not-allowed' : 'pointer', transition: 'background 0.15s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );

  const Row = ({ title, desc, on, onClick, danger }: { title: string; desc: string; on: boolean; onClick: () => void; danger?: boolean }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card-body)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
          {title}{danger && on && <span style={{ fontSize: 10, marginLeft: 6, color: '#f59e0b' }}>⚠️ 暴露到局域网</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <Toggle on={on} onClick={onClick} />
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
        server 行为开关。以前只能改 env 或手动编辑 <code>~/.plotmesh/server-config.json</code>，现在可直接在此切换。
      </p>

      {err && (
        <div style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{err}</div>
      )}
      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中…</div>}

      {cfg && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row
            title="联网模式（要求登录）"
            desc="开启后所有人必须登录才能进入画布；关闭则离线模式，本机直接进画布。改动需重启 server。"
            on={cfg.auth.required}
            onClick={() => patch({ auth: { required: !cfg.auth.required } })}
          />
          <Row
            title="允许自助注册"
            desc="开启后任何人可在登录页注册新账号；关闭则只有管理员能添加成员。即时生效，无需重启。"
            on={cfg.auth.allowSelfRegister}
            onClick={() => patch({ auth: { allowSelfRegister: !cfg.auth.allowSelfRegister } })}
          />
          <Row
            title="远端访问"
            desc="开启后 server 监听 0.0.0.0 + 全员强制 token（局域网/NAS 可访问）；关闭则仅本机、localhost 豁免。改动需重启 server。"
            on={cfg.remoteAccess}
            danger
            onClick={() => patch({ remoteAccess: !cfg.remoteAccess })}
          />
        </div>
      )}

      {restartHint && (
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)',
        }}>
          ⚠️ 部分改动（联网模式 / 远端访问）需<strong>重启 server</strong> 才生效。
          <br />重启命令：<code>launchctl kickstart -k gui/$(id -u)/com.plotmesh.server</code>
          <br />若不可靠，杀掉 3001 旧进程后重装自启脚本（见部署文档）。
        </div>
      )}
    </div>
  );
}

// ════════════════════════ 引用审计 ════════════════════════

function AuditSection() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await authFetch('/api/auth/admin/audit');
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || '加载失败');
      setRecords(d.records || []);
    } catch (e: any) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const statusLabel: Record<string, { text: string; color: string }> = {
    rejected: { text: '已拒绝', color: '#ef4444' },
    cancelled: { text: '已解除', color: '#f59e0b' },
  };

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
        跨画布引用的合约审计流水（被拒绝 / 解除的引用永久归档，可追溯纠纷）。
      </p>

      {err && (
        <div style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{err}</div>
      )}
      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中…</div>}

      {!loading && records.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>
          暂无审计记录（还没有被拒绝或解除的引用）
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {records.map((rec) => {
          const sl = statusLabel[rec.status] || { text: rec.status, color: 'var(--text-secondary)' };
          const last = rec.history[rec.history.length - 1];
          return (
            <div key={rec.id} style={{
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border-color)', background: 'var(--bg-card-body)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  <strong>{rec.srcCanvasName}</strong>
                  <span style={{ color: 'var(--text-muted)' }}> → </span>
                  <strong>{rec.dstCanvasName}</strong>
                </div>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap',
                  background: `${sl.color}22`, color: sl.color,
                }}>{sl.text}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                {fmt(rec.cancelledAt || rec.decidedAt)}
                {last?.reason ? ` · 原因：${last.reason}` : ''}
              </div>
              {rec.history.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  流转：{rec.history.map((h) => h.action).join(' → ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
