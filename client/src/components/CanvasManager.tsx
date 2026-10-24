/**
 * CanvasManager.tsx · v1.5 D3 多画布管理抽屉
 * ---------------------------------------------------------------
 * 左侧抽屉，列出所有画布。v1.7-alpha 起支持文件夹分组：
 *   - 顶部 ＋ 新建画布 / 📁 新建文件夹
 *   - 每个文件夹可折叠，自定义主题色（chip + 边框）
 *   - 拖拽画布行到文件夹标题归类（HTML5 drag）
 *   - 未分组的画布在底部"未分类"
 *
 * 文件夹元数据存 IDB.META（不动 Canvas schema），见 utils/canvasFolders.ts。
 */
import { useEffect, useState } from 'react';
import { useNodeStore } from '../store/nodes';
import { listCanvases, getCanvas, putCanvas } from '../store/storage';
import type { Canvas as CanvasRecord } from '../types/db';
import {
  type Folder,
  listFolders,
  loadFolderMap,
  addFolder,
  ensureProjectCanvasFolder,
  updateFolder,
  removeFolder,
  assignCanvasToFolder,
  FOLDER_PRESET_COLORS,
} from '../utils/canvasFolders';
import {
  loadHiddenSet,
  toggleHidden,
  setHiddenBatch,
} from '../utils/canvasVisibility';
import { useAuth } from '../auth/authContext';
import { authFetch } from '../auth/api';

interface ProjectBrief {
  id: string;
  name: string;
  color: string;
  myRole: string | null;
}

interface CanvasManagerProps {
  open: boolean;
  onClose: () => void;
}

export default function CanvasManager({ open, onClose }: CanvasManagerProps) {
  const { phase, user } = useAuth();
  const isLoggedIn = phase === 'ready';
  const activeCanvasId = useNodeStore((s) => s.activeCanvasId);
  const activeCanvasName = useNodeStore((s) => s.activeCanvasName);
  const switchActiveCanvas = useNodeStore((s) => s.switchActiveCanvas);
  const createNewCanvas = useNodeStore((s) => s.createNewCanvas);
  const renameCanvasById = useNodeStore((s) => s.renameCanvasById);
  const deleteCanvasById = useNodeStore((s) => s.deleteCanvasById);
  const saveActiveCanvasAsTemplate = useNodeStore((s) => s.saveActiveCanvasAsTemplate);
  const instantiateTemplate = useNodeStore((s) => s.instantiateTemplate);

  const [viewMode, setViewMode] = useState<'canvas' | 'template'>('canvas');
  const [items, setItems] = useState<CanvasRecord[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderMap, setFolderMap] = useState<Record<string, string>>({});
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [draggingCanvasId, setDraggingCanvasId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null); // null 不画 hover；'__none__' = 未分类
  // v2.0：项目归属（仅登录态）
  const [projects, setProjects] = useState<ProjectBrief[]>([]);
  const [assignMenuFor, setAssignMenuFor] = useState<string | null>(null); // 正在为哪张画布选项目

  /** 通知顶部页签组与其它 CanvasManager 实例刷新本地文件夹关系。 */
  const notifyFoldersChanged = () => {
    window.dispatchEvent(new CustomEvent('plotmesh-folders-changed'));
  };

  const refresh = async () => {
    try {
      const all = await listCanvases({ workspaceId: 'workspace-default' });
      const filtered = all
        .filter((c) => !c.id.startsWith('recent-'))
        .filter((c) => viewMode === 'template' ? c.kind === 'template' : c.kind !== 'template')
        .sort(
          (a, b) =>
            (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)
        );
      setItems(filtered);
      const fs = await listFolders();
      setFolders(fs);
      const m = await loadFolderMap();
      setFolderMap(m);
      const hs = await loadHiddenSet();
      setHiddenSet(hs);
      // 登录态：拉项目列表用于"归属到项目"
      if (isLoggedIn) {
        try {
          const r = await authFetch('/api/project/list');
          const d = await r.json();
          if (r.ok) setProjects((d.projects || []).filter((p: any) => p.id !== '__unassigned'));
        } catch { /* 离线忽略 */ }
      }
    } catch (e) {
      console.warn('[plotmesh] CanvasManager 读列表失败：', e);
    }
  };

  /** 把画布归属到项目（同步 server + 本地 IDB 的 projectId 字段） */
  const assignToProject = async (canvasId: string, projectId: string | null) => {
    setAssignMenuFor(null);
    try {
      if (projectId) {
        const r = await authFetch(`/api/project/${projectId}/assign-canvas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvasId }),
        });
        if (!r.ok) { const d = await r.json(); alert(`归属失败：${d.error}`); return; }
        const rec = await getCanvas(canvasId);
        if (rec) await putCanvas({ ...rec, projectId });
        // 项目内第一张画布会自动建立项目默认文件夹；后续画布复用该文件夹。
        const project = projects.find((item) => item.id === projectId);
        const folder = await ensureProjectCanvasFolder({
          projectId,
          name: project?.name || '项目画布',
          color: project?.color,
        });
        await assignCanvasToFolder(canvasId, folder.id);
        notifyFoldersChanged();
      } else {
        // 移出到未分类：找当前所属项目调 unassign
        const rec = await getCanvas(canvasId);
        const curPid = (rec as any)?.projectId;
        if (curPid && curPid !== 'project-default') {
          const r = await authFetch(`/api/project/${curPid}/assign-canvas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canvasId, unassign: true }),
          });
          if (!r.ok) { const d = await r.json(); alert(`移出失败：${d.error}`); return; }
        }
        if (rec) await putCanvas({ ...rec, projectId: 'project-default' });
        await assignCanvasToFolder(canvasId, null);
        notifyFoldersChanged();
      }
      refresh();
    } catch (e: any) {
      alert(`操作失败：${e.message}`);
    }
  };

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeCanvasId, activeCanvasName, isLoggedIn, viewMode]);

  const handleSwitch = async (id: string) => {
    if (id === activeCanvasId || busy) return;
    setBusy(true);
    try {
      await switchActiveCanvas(id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 在项目画布中点“新建”时，默认延续当前项目，并自动进入该项目的默认画布文件夹。
      const current = activeCanvasId ? await getCanvas(activeCanvasId) : undefined;
      const projectId = current?.projectId && current.projectId !== 'project-default'
        ? current.projectId
        : null;
      const createdId = await createNewCanvas();
      if (projectId) await assignToProject(createdId, projectId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (busy || !activeCanvasId) return;
    const name = prompt('模板名称：', `${activeCanvasName || '未命名画布'} · 模板`);
    if (!name || !name.trim()) return;
    const description = prompt('模板说明（可留空）：', '') || '';
    setBusy(true);
    try {
      const id = await saveActiveCanvasAsTemplate(name.trim(), description.trim(), user?.id);
      if (!id) {
        alert('保存模板失败，请稍后重试。');
        return;
      }
      await refresh();
      alert(`模板「${name.trim()}」已保存，可在“模板”页签中编辑或使用。`);
    } finally {
      setBusy(false);
    }
  };

  const handleInstantiate = async (rec: CanvasRecord) => {
    if (busy) return;
    const name = prompt('新画布名称：', `${rec.name || '模板'} · 实例`);
    if (name === null) return;
    setBusy(true);
    try {
      const id = await instantiateTemplate(rec.id, name.trim() || undefined, user?.id);
      if (!id) {
        alert('创建实例失败，请稍后重试。');
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (rec: CanvasRecord) => {
    const next = prompt(`修改${rec.kind === 'template' ? '模板' : '画布'}名称：`, rec.name || '');
    if (!next || !next.trim() || next.trim() === rec.name) return;
    await renameCanvasById(rec.id, next.trim());
    refresh();
  };

  const handleDelete = async (rec: CanvasRecord) => {
    const typeLabel = rec.kind === 'template' ? '模板' : '画布';
    const ok = confirm(
      `确定删除${typeLabel}「${rec.name || '未命名'}」？\n该项目会进入回收站。`
    );
    if (!ok) return;
    await deleteCanvasById(rec.id);
    refresh();
  };

  // ── 文件夹操作 ───────────────────────────────────────
  const handleAddFolder = async () => {
    const name = prompt('新建文件夹，输入名称：', '新文件夹');
    if (!name || !name.trim()) return;
    await addFolder({ name: name.trim() });
    notifyFoldersChanged();
    refresh();
  };

  const handleRenameFolder = (f: Folder) => {
    setEditingFolderId(f.id);
    setEditingFolderName(f.name);
  };

  const commitRenameFolder = async (id: string) => {
    const name = editingFolderName.trim();
    if (name) {
      await updateFolder(id, { name });
      notifyFoldersChanged();
      refresh();
    }
    setEditingFolderId(null);
    setEditingFolderName('');
  };

  const handleDeleteFolder = async (f: Folder) => {
    const ok = confirm(
      `确定删除文件夹「${f.name}」？\n` +
        `（其中的画布会被移到"未分类"，画布本身不会被删除）`,
    );
    if (!ok) return;
    await removeFolder(f.id);
    notifyFoldersChanged();
    refresh();
  };

  const handlePickColor = async (f: Folder, color: string) => {
    await updateFolder(f.id, { color });
    notifyFoldersChanged();
    refresh();
  };

  const handleToggleFolder = async (f: Folder) => {
    await updateFolder(f.id, { collapsed: !f.collapsed });
    // 抽屉自己的折叠状态不影响顶部页签组，故无需发 folders-changed。
    refresh();
  };

  // ── v1.7：抽屉级"显示/隐藏" ───────────────────────────
  /** 通知 CanvasTabs 刷新 hidden set（同窗口 store 之间用 event 替代轮询） */
  const notifyHiddenChanged = () => {
    window.dispatchEvent(new CustomEvent('plotmesh-hidden-changed'));
  };

  const handleToggleCanvasHidden = async (rec: CanvasRecord) => {
    // 保护：不允许隐藏 active 画布（先切走才能隐）
    if (rec.id === activeCanvasId) {
      alert('当前正在编辑的画布不能隐藏，请先切到其他画布。');
      return;
    }
    // 保护：至少保留 1 个可见
    const visibleCount = items.filter((c) => !hiddenSet.has(c.id)).length;
    const willHide = !hiddenSet.has(rec.id);
    if (willHide && visibleCount <= 1) {
      alert('至少需要保留 1 个可见画布在顶部页签条。');
      return;
    }
    await toggleHidden(rec.id);
    const hs = await loadHiddenSet();
    setHiddenSet(hs);
    notifyHiddenChanged();
  };

  const handleSetFolderHidden = async (f: Folder, hide: boolean) => {
    const list = items.filter((c) => folderMap[c.id] === f.id);
    if (list.length === 0) return;
    // 隐藏时排除 active（active 永远不隐藏）
    const targetIds = hide
      ? list.filter((c) => c.id !== activeCanvasId).map((c) => c.id)
      : list.map((c) => c.id);
    if (targetIds.length === 0) return;

    // 保护：批量隐藏前估算可见数
    if (hide) {
      const allHiddenAfter = new Set(hiddenSet);
      targetIds.forEach((id) => allHiddenAfter.add(id));
      const visibleAfter = items.filter((c) => !allHiddenAfter.has(c.id)).length;
      if (visibleAfter <= 0) {
        alert('至少需要保留 1 个可见画布在顶部页签条。');
        return;
      }
    }
    await setHiddenBatch(targetIds, hide);
    const hs = await loadHiddenSet();
    setHiddenSet(hs);
    notifyHiddenChanged();
  };

  // ── 拖拽 ────────────────────────────────────────────
  const handleDragStart = (canvasId: string) => {
    setDraggingCanvasId(canvasId);
  };
  const handleDragEnd = () => {
    setDraggingCanvasId(null);
    setDragOverFolderId(null);
  };
  const handleDropOnFolder = async (folderId: string | null) => {
    if (!draggingCanvasId) return;
    await assignCanvasToFolder(draggingCanvasId, folderId);
    notifyFoldersChanged();
    setDraggingCanvasId(null);
    setDragOverFolderId(null);
    refresh();
  };

  if (!open) return null;

  // ── 数据分组 ───────────────────────────────────────
  const filtered = items.filter((c) =>
    (c.name || '').toLowerCase().includes(search.toLowerCase())
  );
  const grouped: Record<string, CanvasRecord[]> = {};
  const ungrouped: CanvasRecord[] = [];
  for (const c of filtered) {
    const fid = folderMap[c.id];
    if (fid && folders.find((f) => f.id === fid)) {
      (grouped[fid] = grouped[fid] || []).push(c);
    } else {
      ungrouped.push(c);
    }
  }

  // ── 渲染辅助 ───────────────────────────────────────
  const renderCanvasRow = (rec: CanvasRecord) => {
    const isActive = rec.id === activeCanvasId;
    const nodeCount = Array.isArray(rec.nodes)
      ? (rec.nodes as any[]).length
      : 0;
    const isDragging = draggingCanvasId === rec.id;
    const isRowHidden = hiddenSet.has(rec.id);
    return (
      <div
        key={rec.id}
        draggable
        onDragStart={() => handleDragStart(rec.id)}
        onDragEnd={handleDragEnd}
        onClick={() => handleSwitch(rec.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          margin: '2px 0',
          borderRadius: 6,
          cursor: isActive ? 'default' : 'pointer',
          background: isActive ? 'var(--accent-bg)' : 'transparent',
          border: isActive
            ? '1px solid var(--accent, #6366f1)'
            : '1px solid transparent',
          opacity: isDragging ? 0.5 : isRowHidden ? 0.55 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLElement).style.background =
              'var(--bg-card-body)';
        }}
        onMouseLeave={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
        title="拖拽到文件夹标题以归类"
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.5, cursor: 'grab' }}>⋮⋮</span>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive
                ? 'var(--accent, #6366f1)'
                : 'var(--text-primary, #1e293b)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textDecoration: isRowHidden ? 'line-through' : 'none',
            }}
          >
            {isActive ? '● ' : ''}
            {isRowHidden && !isActive ? '🚫 ' : ''}
            {rec.name || '未命名画布'}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted, #94a3b8)',
              marginTop: 2,
            }}
          >
            {nodeCount} 节点 ·{' '}
            {new Date(rec.lastOpenedAt ?? rec.updatedAt).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {isLoggedIn && (() => {
              const pid = (rec as any).projectId;
              const proj = pid && pid !== 'project-default' ? projects.find((p) => p.id === pid) : null;
              return proj ? (
                <span style={{
                  marginLeft: 6, fontSize: 9, padding: '0 5px', borderRadius: 8,
                  background: `${proj.color}22`, color: proj.color,
                }}>{proj.name}</span>
              ) : null;
            })()}
          </div>
        </div>
        {/* 归属到项目（仅登录态） */}
        {isLoggedIn && (
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              className="package-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                setAssignMenuFor(assignMenuFor === rec.id ? null : rec.id);
              }}
              title="归属到项目"
              style={{ fontSize: 12 }}
            >
              📁→
            </button>
            {assignMenuFor === rec.id && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', zIndex: 1100,
                marginTop: 4, minWidth: 160, padding: 4, borderRadius: 6,
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 8px' }}>归属到项目</div>
                {projects.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 8px', fontStyle: 'italic' }}>
                    暂无项目，请在「📊 项目总控」新建
                  </div>
                )}
                {projects.map((p) => (
                  <button key={p.id}
                    onClick={(e) => { e.stopPropagation(); assignToProject(rec.id, p.id); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                      padding: '6px 8px', fontSize: 12, border: 'none', borderRadius: 4,
                      background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-body)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                    {p.name}
                  </button>
                ))}
                {(rec as any).projectId && (rec as any).projectId !== 'project-default' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); assignToProject(rec.id, null); }}
                    style={{
                      display: 'block', width: '100%', marginTop: 2, padding: '6px 8px',
                      fontSize: 11, border: 'none', borderTop: '1px solid var(--border-color)',
                      background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left',
                    }}
                  >移出项目（未分类）</button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          className="package-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleCanvasHidden(rec);
          }}
          title={
            isRowHidden
              ? '在顶部页签条显示这张画布'
              : '从顶部页签条隐藏（抽屉里仍可见）'
          }
          style={{ fontSize: 12 }}
        >
          {isRowHidden ? '🚫' : '👁'}
        </button>
        <button
          className="package-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleRename(rec);
          }}
          title="重命名"
          style={{ fontSize: 11 }}
        >
          ✎
        </button>
        <button
          className="package-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(rec);
          }}
          title="删除画布"
        >
          ✕
        </button>
      </div>
    );
  };

  const renderTemplateRow = (rec: CanvasRecord) => {
    const isActive = rec.id === activeCanvasId;
    const nodeCount = Array.isArray(rec.nodes) ? rec.nodes.length : 0;
    return (
      <div
        key={rec.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          padding: '10px',
          margin: '4px 0',
          borderRadius: 8,
          background: isActive ? 'var(--accent-bg)' : 'transparent',
          border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-color)',
        }}
      >
        <div style={{ flex: '1 1 100%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 8,
              color: 'var(--accent)',
              background: 'var(--accent-bg)',
            }}>模板</span>
            <strong style={{
              fontSize: 13,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{rec.name || '未命名模板'}</strong>
          </div>
          {rec.template?.description && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
              {rec.template.description}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            {nodeCount} 节点 · 草稿
            {rec.template?.sourceCanvasId ? ' · 来源于画布' : ''}
          </div>
        </div>
        <button
          className="save-pkg-btn"
          onClick={() => handleSwitch(rec.id)}
          disabled={busy || isActive}
          title={isActive ? '正在编辑此模板' : '打开并编辑模板'}
          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        >
          {isActive ? '编辑中' : '编辑模板'}
        </button>
        <button
          className="save-pkg-btn"
          onClick={() => handleInstantiate(rec)}
          disabled={busy}
          title="从模板创建一张独立的可编辑画布"
          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        >
          使用模板
        </button>
        <button
          className="package-delete-btn"
          onClick={() => handleRename(rec)}
          title="重命名模板"
        >
          ✎
        </button>
        <button
          className="package-delete-btn"
          onClick={() => handleDelete(rec)}
          title="删除模板"
        >
          ✕
        </button>
      </div>
    );
  };

  const renderFolder = (f: Folder) => {
    const list = grouped[f.id] || [];
    const isEditingName = editingFolderId === f.id;
    const isDragOver = dragOverFolderId === f.id;
    // v1.7：文件夹内画布的隐藏统计
    const folderHiddenCount = list.filter((c) => hiddenSet.has(c.id)).length;
    const folderAllHidden = list.length > 0 && folderHiddenCount === list.length;
    return (
      <div
        key={f.id}
        style={{
          margin: '4px 0',
          borderLeft: `3px solid ${f.color}`,
          paddingLeft: 4,
          background: isDragOver ? `${f.color}1a` : 'transparent',
          borderRadius: 4,
          transition: 'background 0.15s',
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (draggingCanvasId) setDragOverFolderId(f.id);
        }}
        onDragLeave={() => setDragOverFolderId(null)}
        onDrop={(e) => {
          e.preventDefault();
          handleDropOnFolder(f.id);
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 6px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
          onClick={() => !isEditingName && handleToggleFolder(f)}
        >
          <span style={{ width: 10, fontSize: 10, color: 'var(--text-muted)' }}>
            {f.collapsed ? '▶' : '▼'}
          </span>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: f.color,
              flexShrink: 0,
            }}
          />
          {isEditingName ? (
            <input
              autoFocus
              value={editingFolderName}
              onChange={(e) => setEditingFolderName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => commitRenameFolder(f.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRenameFolder(f.id);
                else if (e.key === 'Escape') {
                  setEditingFolderId(null);
                  setEditingFolderName('');
                }
              }}
              style={{
                flex: 1,
                fontSize: 12,
                padding: '2px 4px',
                border: '1px solid var(--border-color)',
                borderRadius: 3,
              }}
            />
          ) : (
            <span style={{ flex: 1 }}>
              {f.name}
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                }}
              >
                ({list.length})
              </span>
            </span>
          )}
          {/* 主题色快捷选择（hover 才显示） */}
          <div
            className="folder-actions"
            style={{ display: 'flex', gap: 2, alignItems: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="package-delete-btn"
              onClick={() => handleSetFolderHidden(f, !folderAllHidden)}
              title={
                folderAllHidden
                  ? `在顶部页签条显示该文件夹下全部画布（${list.length}）`
                  : folderHiddenCount > 0
                  ? `从页签条批量隐藏文件夹下全部画布（已隐藏 ${folderHiddenCount}/${list.length}）`
                  : `从页签条批量隐藏该文件夹（${list.length}）`
              }
              style={{ fontSize: 12, position: 'relative' }}
              disabled={list.length === 0}
            >
              {folderAllHidden ? '🚫' : folderHiddenCount > 0 ? '👁⚡' : '👁'}
            </button>
            <button
              className="package-delete-btn"
              onClick={() => handleRenameFolder(f)}
              title="重命名"
              style={{ fontSize: 10 }}
            >
              ✎
            </button>
            <button
              className="package-delete-btn"
              onClick={() => handleDeleteFolder(f)}
              title="删除文件夹（画布不会被删）"
            >
              ✕
            </button>
          </div>
        </div>
        {/* 主题色色板 */}
        {!f.collapsed && (
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '2px 8px 4px 24px',
              flexWrap: 'wrap',
            }}
          >
            {FOLDER_PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handlePickColor(f, c)}
                title={c}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: c,
                  border:
                    c.toLowerCase() === f.color.toLowerCase()
                      ? '2px solid var(--text-primary)'
                      : '1px solid rgba(0,0,0,0.1)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        )}
        {/* 文件夹内画布列表 */}
        {!f.collapsed &&
          (list.length > 0 ? (
            <div style={{ paddingLeft: 4 }}>
              {list.map((rec) => renderCanvasRow(rec))}
            </div>
          ) : (
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                padding: '4px 8px 4px 24px',
                fontStyle: 'italic',
              }}
            >
              空 · 拖拽画布到此
            </div>
          ))}
      </div>
    );
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.32)',
          zIndex: 999,
        }}
      />
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: 340,
          background: 'var(--bg-card, #fff)',
          borderRight: '1px solid var(--border-color, #e2e8f0)',
          boxShadow: '4px 0 16px rgba(0,0,0,0.12)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>📑 画布管理</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {viewMode === 'canvas' && (
              <>
                <button
                  className="save-pkg-btn"
                  onClick={handleSaveAsTemplate}
                  title="将当前画布另存为可编辑模板"
                  disabled={busy || !activeCanvasId}
                  style={{ fontSize: 11 }}
                >
                  模板＋
                </button>
                <button
                  className="save-pkg-btn"
                  onClick={handleAddFolder}
                  title="新建文件夹"
                  disabled={busy}
                >
                  📁＋
                </button>
                <button
                  className="save-pkg-btn"
                  onClick={handleCreate}
                  title="新建画布"
                  disabled={busy}
                >
                  📄＋
                </button>
              </>
            )}
            <button className="save-pkg-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '8px 12px 0' }}>
          {(['canvas', 'template'] as const).map((mode) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                className="save-pkg-btn"
                onClick={() => {
                  setViewMode(mode);
                  setSearch('');
                }}
                style={{
                  flex: 1,
                  background: active ? 'var(--accent-bg)' : 'var(--bg-card-body)',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                }}
              >
                {mode === 'canvas' ? '画布' : '模板'}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '8px 12px' }}>
          <input
            placeholder={viewMode === 'template' ? '搜索模板...' : '搜索画布...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: 6,
              background: 'var(--bg-input)',
              color: 'var(--text-primary, #1e293b)',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 8px 12px',
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                color: 'var(--text-muted, #94a3b8)',
                fontSize: 12,
                padding: '24px 12px',
                textAlign: 'center',
              }}
            >
              {viewMode === 'template' ? '没有匹配的模板' : '没有匹配的画布'}
            </div>
          ) : viewMode === 'template' ? (
            <>{filtered.map((rec) => renderTemplateRow(rec))}</>
          ) : (
            <>
              {/* 各文件夹 */}
              {folders.map((f) => renderFolder(f))}
              {/* 未分类 */}
              {ungrouped.length > 0 && (
                <div
                  style={{
                    margin: '8px 0 4px',
                    padding: '6px 4px',
                    background:
                      dragOverFolderId === '__none__'
                        ? 'var(--accent-bg)'
                        : 'transparent',
                    borderRadius: 4,
                    transition: 'background 0.15s',
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggingCanvasId) setDragOverFolderId('__none__');
                  }}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnFolder(null);
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      padding: '2px 6px 4px',
                      fontWeight: 600,
                    }}
                  >
                    📂 未分类 ({ungrouped.length})
                  </div>
                  {ungrouped.map((rec) => renderCanvasRow(rec))}
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
            fontSize: 11,
            color: 'var(--text-muted, #94a3b8)',
          }}
        >
          {viewMode === 'template' ? (
            <>共 {items.length} 个可编辑模板</>
          ) : (
            <>
              共 {items.length} 张画布 · {folders.length} 个文件夹
              {hiddenSet.size > 0 && (
                <span style={{ marginLeft: 8 }}>· 🚫 {hiddenSet.size} 张已从页签条隐藏</span>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
