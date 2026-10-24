import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth/api';

type Candidate = {
  userId: string;
  name: string;
  email: string;
  color: string;
  systemRole: string;
  provider: string;
  source: string;
};

type Props = {
  projectId: string;
  disabled?: boolean;
  onAdded: () => void | Promise<void>;
  onError?: (message: string) => void;
  compact?: boolean;
};

const fieldStyle: React.CSSProperties = {
  minWidth: 0,
  padding: '5px 8px',
  borderRadius: 5,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  fontSize: 12,
};

export default function ProjectMemberPicker({ projectId, disabled, onAdded, onError, compact }: Props) {
  const [mode, setMode] = useState<'registered' | 'email'>('registered');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'registered') return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await authFetch(
          `/api/project/${encodeURIComponent(projectId)}/member-candidates?q=${encodeURIComponent(query.trim())}`,
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '加载系统用户失败');
        if (cancelled) return;
        setCandidates(body.candidates || []);
        setSelectedUserId((current) =>
          current && (body.candidates || []).some((candidate: Candidate) => candidate.userId === current)
            ? current
            : '',
        );
      } catch (reason: any) {
        if (!cancelled) setError(reason.message || '加载系统用户失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, projectId, query]);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.userId === selectedUserId) || null,
    [candidates, selectedUserId],
  );

  const submit = async () => {
    const body = mode === 'registered'
      ? { action: 'add', userId: selectedUserId, role }
      : { action: 'add', email: email.trim(), role };
    if (mode === 'registered' ? !selectedUserId : !email.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await authFetch(`/api/project/${encodeURIComponent(projectId)}/flex-pool`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '添加成员失败');
      setSelectedUserId('');
      setEmail('');
      setQuery('');
      await onAdded();
    } catch (reason: any) {
      const message = reason.message || '添加成员失败';
      setError(message);
      onError?.(message);
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = disabled || submitting;
  const canSubmit = mode === 'registered' ? !!selectedUserId : !!email.trim();

  return (
    <div style={{ marginTop: 8, padding: compact ? 8 : 10, minWidth: 0, borderRadius: 6, border: '1px dashed var(--border-color)', background: 'var(--bg-card-body)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setMode('registered')}
          style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border-color)', background: mode === 'registered' ? 'var(--accent)' : 'transparent', color: mode === 'registered' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}
        >
          从系统选择
        </button>
        <button
          type="button"
          onClick={() => setMode('email')}
          style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border-color)', background: mode === 'email' ? 'var(--accent)' : 'transparent', color: mode === 'email' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}
        >
          按邮箱添加
        </button>
      </div>

      {mode === 'registered' ? (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或邮箱；未来可接 HR / 花名册"
            style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
          />
          <select
            aria-label="已注册用户"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            disabled={isDisabled || loading}
            style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box' }}
          >
            <option value="">{loading ? '正在搜索…' : candidates.length ? '— 选择已注册用户 —' : '没有可添加的系统用户'}</option>
            {candidates.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.name} · {candidate.email}{candidate.systemRole === 'admin' ? ' · 系统管理员' : ''}
              </option>
            ))}
          </select>
          {selected && (
            <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)' }}>
              来源：{selected.provider === 'builtin' ? '系统账号' : selected.provider} · {selected.email}
            </div>
          )}
        </>
      ) : (
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="输入已注册邮箱"
          style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box' }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) auto', gap: 6, marginTop: 7 }}>
        <select value={role} onChange={(event) => setRole(event.target.value)} disabled={isDisabled} style={fieldStyle}>
          <option value="admin">项目 Admin</option>
          <option value="editor">编辑</option>
          <option value="viewer">查看</option>
        </select>
        <button
          type="button"
          disabled={isDisabled || !canSubmit}
          onClick={submit}
          style={{ padding: '5px 11px', border: 'none', borderRadius: 5, background: 'var(--accent)', color: '#fff', cursor: isDisabled || !canSubmit ? 'not-allowed' : 'pointer', fontSize: 12, opacity: isDisabled || !canSubmit ? 0.5 : 1 }}
        >
          {submitting ? '添加中…' : '加入 Flex Pool'}
        </button>
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>{error}</div>}
    </div>
  );
}
