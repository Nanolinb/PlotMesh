/**
 * DashboardView.tsx · 总控画布 + PM 调度面板（v2.0 Phase C 续）
 * ---------------------------------------------------------------
 * 项目级俯瞰图：聚合所有子画布运行状态、跨画布依赖、堵车预警。
 * 使用 /api/project/list + /api/project/:id 作为数据源。
 * owner/admin 可做宏观操作（一键提醒、批量重试、管理 Flex Pool）。
 *
 * v2.0 升级：内联编辑替代 prompt/alert，Toast 通知替代 alert 弹窗。
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { authFetch } from '../auth/api';
import { useAuth } from '../auth/authContext';
import { useNodeStore } from '../store/nodes';

/* ─── 类型 ──────────────────────────────────────────────────── */

interface PoolMember {
  userId: string;
  role: string;
  name: string;
  email: string;
  color: string;
  joinedAt?: number;
}

interface FolderItem {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  order?: number;
  collapsed?: boolean;
  createdAt: number;
}

interface CanvasStat {
  id: string;
  name: string;
  nodeCount: number;
  folderId: string | null;
  lastRunStatus: string | null;
  lastRunAt: number | null;
  stuckCount: number;
  connectionCount: number;
  updatedAt: number;
}

interface DepConn {
  id: string;
  srcCanvasId: string;
  srcCanvasName: string;
  dstCanvasId: string;
  dstCanvasName: string;
  status: string;
}

interface ProjectBrief {
  id: string;
  name: string;
  description: string;
  color: string;
  ownerId: string | null;
  ownerName: string;
  myRole: string | null;
  canvasCount: number;
  memberCount: number;
  createdAt: number | null;
  updatedAt: number | null;
}

interface ProjectDetail extends ProjectBrief {
  flexPool: PoolMember[];
  folders: FolderItem[];
  canvasFolderMap: Record<string, string>;
  canvases: CanvasStat[];
  connections: DepConn[];
}

/* ─── Toast 通知 ──────────────────────────────────────────── */

interface ToastItem { id: number; text: string; type: 'ok' | 'err' }
let toastCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, type: 'ok' | 'err' = 'ok') => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500);
  }, []);
  return { toasts, show };
}

/* ─── 预设色板 ────────────────────────────────────────────── */

const PROJECT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16'];

/* ─── 主组件 ──────────────────────────────────────────────── */

export default function DashboardView() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectBrief[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'pool' | 'folders'>('overview');
  const switchCanvas = useNodeStore((s) => s.switchActiveCanvas);
  const { toasts, show: toast } = useToast();

  // ── 项目创建内联表单 ──
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(PROJECT_COLORS[0]);
  const createInputRef = useRef<HTMLInputElement>(null);

  // ── 成员添加内联表单 ──
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('editor');

  // ── 项目名/描述编辑 ──
  const [editingName, setEditingName] = useState(false);
  const [editNameVal, setEditNameVal] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDescVal, setEditDescVal] = useState('');

  /* ─── 数据加载 ─────────────────────────────────────────── */

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/project/list');
      const d = await r.json();
      if (r.ok) setProjects(d.projects || []);
    } catch (e) {
      console.warn('[dashboard] 拉取失败：', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await authFetch(`/api/project/${id}`);
      const d = await r.json();
      if (r.ok) {
        setDetail(d);
        setEditingName(false);
        setEditingDesc(false);
        setShowAddMember(false);
      } else {
        toast(`加载失败：${d.error}`, 'err');
      }
    } catch (e: any) {
      toast(`加载失败：${e.message}`, 'err');
    }
  }, [toast]);

  /* ─── 项目创建 ─────────────────────────────────────────── */

  const createProject = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await authFetch('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newDesc.trim(), color: newColor }),
      });
      const d = await r.json();
      if (r.ok) {
        toast('项目已创建');
        setShowCreateForm(false);
        setNewName('');
        setNewDesc('');
        setNewColor(PROJECT_COLORS[0]);
        refresh();
      } else {
        toast(`创建失败：${d.error}`, 'err');
      }
    } catch (e: any) {
      toast(`创建失败：${e.message}`, 'err');
    }
  };

  /* ─── 项目编辑 ─────────────────────────────────────────── */

  const updateProject = async (patch: { name?: string; description?: string; color?: string }) => {
    if (!detail) return;
    try {
      const r = await authFetch(`/api/project/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        toast('已更新');
        loadDetail(detail.id);
        refresh();
      } else {
        const d = await r.json();
        toast(`更新失败：${d.error}`, 'err');
      }
    } catch (e: any) {
      toast(`更新失败：${e.message}`, 'err');
    }
  };

  const deleteProject = async () => {
    if (!detail) return;
    if (!confirm('确认删除项目？画布会变为未分类。')) return;
    try {
      const r = await authFetch(`/api/project/${detail.id}`, { method: 'DELETE' });
      if (r.ok) {
        toast('项目已删除');
        setDetail(null);
        refresh();
      }
    } catch (e: any) {
      toast(`删除失败：${e.message}`, 'err');
    }
  };

  /* ─── 成员管理 ─────────────────────────────────────────── */

  const addMember = async () => {
    if (!detail || !memberEmail.trim()) return;
    try {
      const r = await authFetch(`/api/project/${detail.id}/flex-pool`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', email: memberEmail.trim(), role: memberRole }),
      });
      const d = await r.json();
      if (r.ok) {
        toast('成员已添加');
        setShowAddMember(false);
        setMemberEmail('');
        setMemberRole('editor');
        loadDetail(detail.id);
      } else {
        toast(`添加失败：${d.error}`, 'err');
      }
    } catch (e: any) {
      toast(`添加失败：${e.message}`, 'err');
    }
  };

  const removeMember = async (userId: string) => {
    if (!detail) return;
    if (!confirm('确认移除该成员？')) return;
    try {
      const r = await authFetch(`/api/project/${detail.id}/flex-pool/${userId}`, { method: 'DELETE' });
      if (r.ok) {
        toast('已移除');
        loadDetail(detail.id);
      } else {
        const d = await r.json();
        toast(`移除失败：${d.error}`, 'err');
      }
    } catch (e: any) {
      toast(`移除失败：${e.message}`, 'err');
    }
  };

  const changeMemberRole = async (userId: string, role: string) => {
    if (!detail) return;
    try {
      const r = await authFetch(`/api/project/${detail.id}/flex-pool`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setRole', userId, role }),
      });
      if (r.ok) {
        toast('角色已更新');
        loadDetail(detail.id);
      } else {
        const d = await r.json();
        toast(`更新失败：${d.error}`, 'err');
      }
    } catch (e: any) {
      toast(`更新失败：${e.message}`, 'err');
    }
  };

  /* ─── 文件夹操作 ───────────────────────────────────────── */

  const addFolder = async (projectId: string, parentId?: string | null) => {
    const name = prompt('文件夹名称：');
    if (!name?.trim()) return;
    try {
      const r = await authFetch(`/api/project/${projectId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: name.trim(), parentId: parentId || null }),
      });
      if (r.ok) { toast('文件夹已创建'); loadDetail(projectId); }
      else { const d = await r.json(); toast(`创建失败：${d.error}`, 'err'); }
    } catch (e: any) { toast(`创建失败：${e.message}`, 'err'); }
  };

  const deleteFolder = async (projectId: string, folderId: string) => {
    if (!confirm('删除文件夹？画布会被移到上级。')) return;
    try {
      const r = await authFetch(`/api/project/${projectId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', folderId }),
      });
      if (r.ok) { toast('文件夹已删除'); loadDetail(projectId); }
    } catch (e: any) { toast(`删除失败：${e.message}`, 'err'); }
  };

  const renameFolder = async (projectId: string, folderId: string, currentName: string) => {
    const name = prompt('修改文件夹名称：', currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try {
      const r = await authFetch(`/api/project/${projectId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', folderId, name: name.trim() }),
      });
      if (r.ok) { toast('已重命名'); loadDetail(projectId); }
    } catch (e: any) { toast(`重命名失败：${e.message}`, 'err'); }
  };

  /* ─── 宏观操作 ─────────────────────────────────────────── */

  const broadcast = async (projectId: string) => {
    const msg = prompt('输入要广播给项目成员的消息：');
    if (!msg) return;
    try {
      const r = await authFetch('/api/dashboard/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectOwnerId: null, message: msg, canvasId: null }),
      });
      const d = await r.json();
      if (r.ok) toast(`已发送给 ${d.sent} 位成员`);
      else toast(`发送失败：${d.error}`, 'err');
    } catch (e: any) { toast(`发送失败：${e.message}`, 'err'); }
  };

  const batchRetry = async (canvasIds: string[]) => {
    if (!confirm(`确认批量重试 ${canvasIds.length} 张画布？`)) return;
    try {
      const r = await authFetch('/api/dashboard/batch-retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasIds }),
      });
      const d = await r.json();
      if (r.ok) {
        const ok = (d.results || []).filter((x: any) => x.ok).length;
        toast(`${ok}/${canvasIds.length} 已触发重试`);
      } else toast(`批量重试失败：${d.error}`, 'err');
    } catch (e: any) { toast(`批量重试失败：${e.message}`, 'err'); }
  };

  /* ─── 样式辅助 ─────────────────────────────────────────── */

  const statusColor: Record<string, string> = {
    succeeded: '#22c55e', running: '#3b82f6', pending: '#f59e0b',
    failed: '#ef4444', cancelled: '#94a3b8', stuck: '#ef4444',
    error: '#ef4444', null: '#94a3b8',
  };

  const roleColor: Record<string, string> = {
    owner: '#6366f1', admin: '#8b5cf6', editor: '#10b981', viewer: '#94a3b8',
  };
  const roleLabel: Record<string, string> = {
    owner: 'Owner', admin: 'Admin', editor: '编辑', viewer: '查看',
  };

  const btnSmall: React.CSSProperties = {
    fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)',
  };

  /* ─── 构建文件夹树 ─────────────────────────────────────── */

  const buildFolderTree = (folders: FolderItem[], canvasFolderMap: Record<string, string>, canvases: CanvasStat[]) => {
    const roots: Array<FolderItem & { children: any[]; canvasItems: CanvasStat[] }> = [];
    const map = new Map<string, any>();

    for (const f of folders) {
      map.set(f.id, { ...f, children: [], canvasItems: [] });
    }
    for (const c of canvases) {
      const fid = canvasFolderMap[c.id];
      if (fid && map.has(fid)) {
        map.get(fid).canvasItems.push(c);
      }
    }
    for (const f of folders) {
      const node = map.get(f.id)!;
      if (f.parentId && map.has(f.parentId)) {
        map.get(f.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    const unassigned = canvases.filter((c) => !canvasFolderMap[c.id]);
    return { roots, unassigned };
  };

  /* ─── Toast 渲染 ──────────────────────────────────────── */

  const renderToasts = () => (
    <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: '8px 14px', borderRadius: 6, fontSize: 12,
          background: t.type === 'ok' ? '#10b981' : '#ef4444', color: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', animation: 'fadeIn 0.2s',
        }}>
          {t.text}
        </div>
      ))}
    </div>
  );

  /* ─── 渲染 ─────────────────────────────────────────────── */

  // 项目详情视图
  if (detail) {
    const { roots, unassigned } = buildFolderTree(detail.folders, detail.canvasFolderMap, detail.canvases);
    const failedCanvases = detail.canvases.filter((c) => c.stuckCount > 0);
    const canManage = detail.myRole === 'owner' || detail.myRole === 'admin';

    const renderFolderNode = (f: any, depth = 0) => (
      <div key={f.id} style={{ marginLeft: depth * 16, marginTop: 4 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px', borderRadius: 6,
          background: `${f.color}18`, borderLeft: `3px solid ${f.color}`,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: f.color }} />
          <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{f.name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.canvasItems.length} 画布</span>
          {canManage && (
            <>
              <button onClick={() => addFolder(detail.id, f.id)} style={{ ...btnSmall, fontSize: 9, padding: '2px 4px', border: 'none', color: 'var(--accent)' }}>＋子</button>
              <button onClick={() => renameFolder(detail.id, f.id, f.name)} style={{ ...btnSmall, fontSize: 9, padding: '2px 4px', border: 'none', color: 'var(--text-secondary)' }}>✎</button>
              <button onClick={() => deleteFolder(detail.id, f.id)} style={{ ...btnSmall, fontSize: 9, padding: '2px 4px', border: 'none', color: '#ef4444' }}>✕</button>
            </>
          )}
        </div>
        {f.canvasItems.map((c: CanvasStat) => renderCanvasRow(c))}
        {f.children.map((child: any) => renderFolderNode(child, depth + 1))}
      </div>
    );

    const renderCanvasRow = (c: CanvasStat) => (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', marginLeft: 16, marginTop: 2, borderRadius: 5,
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: statusColor[c.lastRunStatus || 'null'],
        }} />
        <span style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', flex: 1 }}
          onClick={() => switchCanvas(c.id)}>
          {c.name}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {c.nodeCount}n
          {c.stuckCount > 0 && <span style={{ color: '#ef4444' }}> ⚠{c.stuckCount}</span>}
          {c.connectionCount > 0 && <span style={{ color: '#3b82f6' }}> 🔗{c.connectionCount}</span>}
        </span>
      </div>
    );

    return (
      <div style={{ padding: 16, color: 'var(--text-primary)', overflow: 'auto', height: '100%' }}>
        {renderToasts()}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button onClick={() => setDetail(null)} style={btnSmall}>← 返回</button>
          {/* 项目颜色可编辑 */}
          {canManage ? (
            <div style={{ position: 'relative' }}>
              <span style={{
                width: 14, height: 14, borderRadius: 4, background: detail.color, flexShrink: 0,
                display: 'inline-block', cursor: 'pointer',
              }} title="更换颜色"
                onClick={(e) => {
                  const idx = PROJECT_COLORS.indexOf(detail.color);
                  const next = PROJECT_COLORS[(idx + 1) % PROJECT_COLORS.length];
                  updateProject({ color: next });
                }} />
            </div>
          ) : (
            <span style={{ width: 14, height: 14, borderRadius: 4, background: detail.color, flexShrink: 0 }} />
          )}
          {/* 项目名可编辑 */}
          {editingName ? (
            <input autoFocus value={editNameVal}
              onChange={(e) => setEditNameVal(e.target.value)}
              onBlur={() => { if (editNameVal.trim() && editNameVal.trim() !== detail.name) updateProject({ name: editNameVal.trim() }); setEditingName(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } else if (e.key === 'Escape') setEditingName(false); }}
              style={{ fontSize: 16, fontWeight: 700, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, flex: 1 }}
            />
          ) : (
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1, cursor: canManage ? 'pointer' : 'default' }}
              onClick={() => { if (canManage) { setEditNameVal(detail.name); setEditingName(true); } }}
              title={canManage ? '点击编辑项目名称' : undefined}>
              {detail.name}
            </h2>
          )}
          {detail.myRole === 'owner' && (
            <button onClick={deleteProject} style={{ ...btnSmall, color: '#ef4444', borderColor: '#ef4444' }}>删除项目</button>
          )}
        </div>

        {/* 项目描述可编辑 */}
        {canManage && !editingDesc && (
          <p style={{ fontSize: 12, color: detail.description ? 'var(--text-secondary)' : 'var(--text-muted)', marginTop: 0, marginBottom: 12, cursor: 'pointer', fontStyle: detail.description ? 'normal' : 'italic' }}
            onClick={() => { setEditDescVal(detail.description); setEditingDesc(true); }}
            title="点击编辑描述">
            {detail.description || '点击添加项目描述…'}
          </p>
        )}
        {editingDesc && (
          <input autoFocus value={editDescVal}
            onChange={(e) => setEditDescVal(e.target.value)}
            onBlur={() => { if (editDescVal.trim() !== detail.description) updateProject({ description: editDescVal.trim() }); setEditingDesc(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setEditingDesc(false); }}
            placeholder="项目描述"
            style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--accent)', borderRadius: 4, width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
          />
        )}

        {/* tab 切换 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {([
            { key: 'overview' as const, label: '🗺️ 画布' },
            { key: 'folders' as const, label: '📁 文件夹' },
            { key: 'pool' as const, label: '👥 成员' },
          ]).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border-color)',
              background: tab === t.key ? 'var(--accent)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--text-secondary)',
              fontWeight: tab === t.key ? 600 : 400,
            }}>{t.label}</button>
          ))}
        </div>

        {/* 画布列表 */}
        {tab === 'overview' && (
          <>
            {detail.canvases.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
                暂无画布（在画布管理中将画布归属到此项目）
              </div>
            ) : (
              <>
                {roots.map((f) => renderFolderNode(f))}
                {unassigned.map((c) => renderCanvasRow(c))}
              </>
            )}

            {/* 跨画布依赖 */}
            {detail.connections.length > 0 && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, border: '1px dashed var(--border-color)', background: 'var(--bg-card-body)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>🔗 跨画布依赖</div>
                {detail.connections.map((conn) => (
                  <div key={conn.id} style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {conn.srcCanvasName} → {conn.dstCanvasName}
                    <span style={{
                      fontSize: 10, marginLeft: 4, padding: '0 4px', borderRadius: 4,
                      background: conn.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                      color: conn.status === 'active' ? '#22c55e' : '#f59e0b',
                    }}>{conn.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 宏观操作 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => broadcast(detail.id)} style={{ ...btnSmall, borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                📢 提醒全员
              </button>
              {failedCanvases.length > 0 && (
                <button onClick={() => batchRetry(failedCanvases.map((c) => c.id))} style={{ ...btnSmall, borderColor: '#ef4444', color: '#ef4444' }}>
                  🔄 批量重试 ({failedCanvases.length})
                </button>
              )}
            </div>
          </>
        )}

        {/* 文件夹管理 */}
        {tab === 'folders' && (
          <>
            <button onClick={() => addFolder(detail.id)} style={{
              ...btnSmall, marginBottom: 8, borderColor: 'var(--accent)', color: 'var(--accent)',
            }}>＋ 新建文件夹</button>
            {roots.map((f) => renderFolderNode(f))}
            {unassigned.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                  未分类 ({unassigned.length})
                </div>
                {unassigned.map((c) => renderCanvasRow(c))}
              </div>
            )}
            {detail.folders.length === 0 && (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
                暂无文件夹，点击上方按钮创建
              </div>
            )}
          </>
        )}

        {/* 成员管理 */}
        {tab === 'pool' && (
          <>
            {canManage && (
              <>
                <button onClick={() => { setShowAddMember(!showAddMember); setMemberEmail(''); setMemberRole('editor'); }} style={{
                  ...btnSmall, marginBottom: showAddMember ? 4 : 8, borderColor: 'var(--accent)', color: 'var(--accent)',
                }}>{showAddMember ? '取消' : '＋ 添加成员'}</button>
                {showAddMember && (
                  <div style={{
                    display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8,
                    padding: '8px 10px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--accent)',
                  }}>
                    <input placeholder="邮箱" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)}
                      style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid var(--border-color)', borderRadius: 4 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
                    />
                    <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}
                      style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-color)' }}>
                      <option value="admin">Admin</option>
                      <option value="editor">编辑</option>
                      <option value="viewer">查看</option>
                    </select>
                    <button onClick={addMember} style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600,
                    }}>确认</button>
                  </div>
                )}
              </>
            )}
            {detail.flexPool.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                暂无成员
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detail.flexPool.map((m) => (
                  <div key={m.userId} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 6,
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: m.color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12 }}>{m.name}</span>
                      <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-muted)' }}>{m.email}</span>
                    </div>
                    {canManage && m.role !== 'owner' ? (
                      <select value={m.role} onChange={(e) => changeMemberRole(m.userId, e.target.value)}
                        style={{ fontSize: 10, padding: '1px 4px', borderRadius: 4, border: '1px solid var(--border-color)' }}>
                        <option value="admin">Admin</option>
                        <option value="editor">编辑</option>
                        <option value="viewer">查看</option>
                      </select>
                    ) : (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                        background: `${roleColor[m.role] || '#94a3b8'}22`,
                        color: roleColor[m.role] || '#94a3b8',
                      }}>{roleLabel[m.role] || m.role}</span>
                    )}
                    {m.role !== 'owner' && canManage && (
                      <button onClick={() => removeMember(m.userId)} style={{
                        fontSize: 10, padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
                        border: '1px solid #ef4444', background: 'transparent', color: '#ef4444',
                      }}>移除</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // 项目列表视图
  return (
    <div style={{ padding: 16, color: 'var(--text-primary)', overflow: 'auto', height: '100%' }}>
      {renderToasts()}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>📊 项目总控</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowCreateForm(!showCreateForm); setNewName(''); setNewDesc(''); setNewColor(PROJECT_COLORS[0]); }} style={{
            fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
            border: showCreateForm ? '1px solid var(--border-color)' : 'none',
            background: showCreateForm ? 'transparent' : 'var(--accent)',
            color: showCreateForm ? 'var(--text-secondary)' : '#fff',
            fontWeight: showCreateForm ? 400 : 600,
          }}>{showCreateForm ? '取消' : '＋ 新建项目'}</button>
          <button onClick={refresh} style={btnSmall}>🔄</button>
        </div>
      </div>

      {/* 创建项目内联表单 */}
      {showCreateForm && (
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 8,
          border: '1px solid var(--accent)', background: 'var(--bg-card-body)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>新建项目</div>
          <input placeholder="项目名称" value={newName} onChange={(e) => setNewName(e.target.value)}
            autoFocus ref={createInputRef}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createProject(); }}
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 6, boxSizing: 'border-box' }}
          />
          <input placeholder="项目描述（可选）" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createProject(); }}
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 8, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {PROJECT_COLORS.map((c) => (
              <button key={c} onClick={() => setNewColor(c)} style={{
                width: 20, height: 20, borderRadius: 4, background: c, padding: 0, cursor: 'pointer',
                border: c === newColor ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.15)',
              }} />
            ))}
          </div>
          <button onClick={createProject} disabled={!newName.trim()} style={{
            fontSize: 12, padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
            border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600,
            opacity: newName.trim() ? 1 : 0.5,
          }}>创建</button>
        </div>
      )}

      {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>加载中…</div>}

      {!loading && projects.length === 0 && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40, fontSize: 13 }}>
          暂无项目。点击「＋ 新建项目」开始。
        </div>
      )}

      {!loading && projects.map((proj) => (
        <div key={proj.id} style={{ marginBottom: 10 }}>
          <div
            style={{
              padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-color)',
              background: 'var(--bg-card-body)', cursor: 'pointer', transition: 'border-color 0.15s',
              borderLeft: `3px solid ${proj.color}`,
            }}
            onClick={() => proj.id !== '__unassigned' && loadDetail(proj.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 4, flexShrink: 0, background: proj.color,
                }} />
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {proj.name}
                  </span>
                  {proj.description && (
                    <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--text-muted)' }}>
                      {proj.description.slice(0, 30)}{proj.description.length > 30 ? '…' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {proj.myRole && proj.id !== '__unassigned' && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 8,
                    background: `${roleColor[proj.myRole] || '#94a3b8'}22`,
                    color: roleColor[proj.myRole] || '#94a3b8',
                  }}>{roleLabel[proj.myRole] || proj.myRole}</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {proj.canvasCount} 画布
                </span>
                {proj.memberCount > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    · {proj.memberCount} 人
                  </span>
                )}
                {proj.id !== '__unassigned' && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>▸</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* 迁移按钮（admin only） */}
      {!loading && projects.filter((p) => p.id !== '__unassigned').length === 0 && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: '1px dashed var(--border-color)', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            已有画布但没有项目？可以自动迁移：
          </div>
          <button onClick={async () => {
            try {
              const r = await authFetch('/api/project/migrate', { method: 'POST' });
              const d = await r.json();
              if (r.ok) {
                toast(`迁移完成：${JSON.stringify(d.migrated)}`);
                refresh();
              } else toast(`迁移失败：${d.error}`, 'err');
            } catch (e: any) { toast(`迁移失败：${e.message}`, 'err'); }
          }} style={{
            ...btnSmall, borderColor: 'var(--accent)', color: 'var(--accent)',
          }}>🔄 自动迁移已有画布到项目</button>
        </div>
      )}
    </div>
  );
}
