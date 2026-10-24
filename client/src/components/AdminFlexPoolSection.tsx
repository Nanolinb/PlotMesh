import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth/api';
import ProjectMemberPicker from './ProjectMemberPicker';

type Membership = {
  projectId: string;
  projectName: string;
  projectColor: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  joinedAt: number | null;
  activeAssignments: number;
  pendingAssignments: number;
};

type Person = {
  userId: string;
  name: string;
  email: string;
  color: string;
  systemRole: string;
  provider: string;
  source: string;
  memberships: Membership[];
  activeAssignments: number;
  pendingAssignments: number;
  expertiseScore: number | null;
};

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  memberCount: number;
};

type Totals = {
  people: number;
  memberships: number;
  activeAssignments: number;
  pendingAssignments: number;
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: '编辑',
  viewer: '查看',
};

const ROLE_COLOR: Record<string, string> = {
  owner: '#6366f1',
  admin: '#8b5cf6',
  editor: '#10b981',
  viewer: '#94a3b8',
};

const cardStyle: React.CSSProperties = {
  minWidth: 0,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-card-body)',
};

export default function AdminFlexPoolSection() {
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [totals, setTotals] = useState<Totals>({ people: 0, memberships: 0, activeAssignments: 0, pendingAssignments: 0 });
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async (projectId = selectedProjectId, query = search) => {
    setLoading(true);
    setErr('');
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (query.trim()) params.set('q', query.trim());
      const response = await authFetch(`/api/project/flex-pool/people${params.size ? `?${params}` : ''}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '加载人员池失败');
      setPeople(body.people || []);
      setProjects(body.projects || []);
      setTotals(body.totals || { people: 0, memberships: 0, activeAssignments: 0, pendingAssignments: 0 });
    } catch (reason: any) {
      setErr(reason.message || '加载人员池失败');
    } finally {
      setLoading(false);
    }
  }, [search, selectedProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(selectedProjectId, search), 220);
    return () => window.clearTimeout(timer);
  }, [load, search, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const setRole = async (membership: Membership, person: Person, role: string) => {
    const key = `${person.userId}:${membership.projectId}`;
    setBusyKey(key);
    try {
      const response = await authFetch(`/api/project/${membership.projectId}/flex-pool`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setRole', userId: person.userId, role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '更新角色失败');
      await load();
    } catch (reason: any) {
      setErr(`更新角色失败：${reason.message || reason}`);
    } finally {
      setBusyKey('');
    }
  };

  const removeMembership = async (membership: Membership, person: Person) => {
    if (!confirm(`确认将「${person.name}」从项目「${membership.projectName}」移出？`)) return;
    const key = `${person.userId}:${membership.projectId}`;
    setBusyKey(key);
    try {
      const response = await authFetch(`/api/project/${membership.projectId}/flex-pool/${person.userId}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '移除失败');
      await load();
    } catch (reason: any) {
      setErr(`移除失败：${reason.message || reason}`);
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div style={{ minWidth: 0, overflowX: 'hidden' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>人员 Flex Pool</div>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          这里的第一层实体是人。项目只用于筛选人员所属范围和角色；画布、文件夹及无主项目不进入 Flex Pool。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginBottom: 12 }}>
        {[
          ['人员', totals.people, 'var(--accent)'],
          ['项目关系', totals.memberships, '#8b5cf6'],
          ['进行中', totals.activeAssignments, '#3b82f6'],
          ['待确认', totals.pendingAssignments, '#f59e0b'],
        ].map(([label, value, color]) => (
          <div key={String(label)} style={{ padding: '7px 8px', borderRadius: 7, background: 'var(--bg-card-body)', border: '1px solid var(--border-color)', minWidth: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ marginTop: 2, fontSize: 17, fontWeight: 700, color: String(color) }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 0.8fr) minmax(180px, 1.2fr) auto', gap: 7, marginBottom: 10 }}>
        <select
          aria-label="项目筛选"
          value={selectedProjectId}
          onChange={(event) => {
            setSelectedProjectId(event.target.value);
            setExpandedUserId(null);
            setShowAdd(false);
          }}
          style={{ minWidth: 0, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }}
        >
          <option value="">全部项目人员</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}（{project.memberCount}）</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索人员姓名或邮箱"
          style={{ minWidth: 0, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }}
        />
        <button
          onClick={() => load()}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}
        >
          刷新
        </button>
      </div>

      {selectedProject ? (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => setShowAdd((value) => !value)}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: showAdd ? 'var(--accent-bg)' : 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}
          >
            {showAdd ? '收起加人' : `＋ 向「${selectedProject.name}」加入人员`}
          </button>
          {showAdd && (
            <ProjectMemberPicker
              projectId={selectedProject.id}
              compact
              onAdded={async () => {
                setShowAdd(false);
                await load(selectedProject.id, search);
              }}
              onError={(message) => setErr(message)}
            />
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 10, fontSize: 10, color: 'var(--text-muted)' }}>
          如需加人，请先从上方选择一个项目；随后可从系统注册用户搜索，或按邮箱添加。
        </div>
      )}

      {err && <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 12 }}>{err}</div>}
      {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>加载人员池…</div>}

      {!loading && people.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          {search.trim() ? '没有匹配人员' : selectedProject ? '该项目还没有人员' : '当前没有项目人员'}
        </div>
      )}

      {!loading && people.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map((person) => {
            const expanded = expandedUserId === person.userId;
            return (
              <article key={person.userId} style={cardStyle}>
                <button
                  onClick={() => setExpandedUserId(expanded ? null : person.userId)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', minWidth: 0 }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: person.color || '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700 }}>
                    {(person.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                      <strong style={{ fontSize: 13 }}>{person.name}</strong>
                      {person.systemRole === 'admin' && <span style={{ padding: '1px 5px', borderRadius: 7, background: 'rgba(239,68,68,0.13)', color: '#ef4444', fontSize: 9 }}>系统管理员</span>}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{person.email}</div>
                    <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-secondary)' }}>
                      {person.memberships.length} 个项目 · 活跃 {person.activeAssignments} · 待确认 {person.pendingAssignments} · 擅长度待积累
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 3, maxWidth: 150, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {person.memberships.slice(0, 3).map((membership) => (
                      <span key={membership.projectId} title={membership.projectName} style={{ width: 8, height: 8, borderRadius: 2, background: membership.projectColor, flexShrink: 0 }} />
                    ))}
                    {person.memberships.length > 3 && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>+{person.memberships.length - 3}</span>}
                  </div>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
                </button>

                {expanded && (
                  <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ marginBottom: 6, fontSize: 10, color: 'var(--text-muted)' }}>所属项目与角色</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {person.memberships.map((membership) => {
                        const busy = busyKey === `${person.userId}:${membership.projectId}`;
                        return (
                          <div key={membership.projectId} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-card)', borderLeft: `3px solid ${membership.projectColor}` }}>
                            <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{membership.projectName}</div>
                              <div style={{ marginTop: 2, fontSize: 9, color: 'var(--text-muted)' }}>活跃 {membership.activeAssignments} · 待确认 {membership.pendingAssignments}</div>
                            </div>
                            {membership.role === 'owner' ? (
                              <span style={{ fontSize: 10, color: ROLE_COLOR.owner }}>Owner</span>
                            ) : (
                              <select
                                aria-label={`${person.name} 在 ${membership.projectName} 的角色`}
                                value={membership.role}
                                disabled={busy}
                                onChange={(event) => setRole(membership, person, event.target.value)}
                                style={{ maxWidth: 90, padding: '3px 5px', borderRadius: 5, border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: ROLE_COLOR[membership.role], fontSize: 10 }}
                              >
                                <option value="admin">Admin</option>
                                <option value="editor">编辑</option>
                                <option value="viewer">查看</option>
                              </select>
                            )}
                            <span style={{ fontSize: 9, color: ROLE_COLOR[membership.role] || 'var(--text-muted)' }}>{ROLE_LABEL[membership.role]}</span>
                            {membership.role !== 'owner' && (
                              <button
                                disabled={busy}
                                onClick={() => removeMembership(membership, person)}
                                style={{ padding: '2px 6px', borderRadius: 5, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 9 }}
                              >
                                移出项目
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
