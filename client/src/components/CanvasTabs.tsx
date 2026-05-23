/**
 * CanvasTabs.tsx · v1.5.x 顶部画布页签条（Chrome-style）
 * ---------------------------------------------------------------
 * 顶部横向并排的页签，模仿浏览器多标签页：
 *   - 每个 tab：显示画布名，hover 显示 ✕；双击 tab 名进入重命名
 *   - 当前 active tab：明显高亮（实底背景，无下边框，与画布主体"连体"）
 *   - 末尾 ＋ 按钮新建画布
 *   - 溢出策略：横向滚动 + ▾ 溢出菜单（点击挑选画布）
 *   - id 锚定：重命名只改 name，跨画布引用走 id 不受影响
 *
 * v1.7 起的关闭/删除策略（Chrome 风格）：
 *   - ✕ 按钮：**关闭页签**（画布数据保留，写到 localStorage 'plotmesh-closed-tabs'），
 *     画布仍能在 ≡ 抽屉/最近列表里重新打开
 *   - 右键 tab → 弹菜单：重新打开关闭的 / 删除画布（带二次确认 + 不可撤销红字）
 *
 * 数据来源：
 *   - 直接 listCanvases() 从 IDB 读全部，过滤掉 'recent-' 快照前缀。
 *   - 在 activeCanvasId / activeCanvasName 变化时主动刷新一次。
 */
import { useEffect, useRef, useState } from 'react';
import { useNodeStore } from '../store/nodes';
import { listCanvases } from '../store/storage';
import type { Canvas as CanvasRecord } from '../types/db';

const CLOSED_TABS_KEY = 'plotmesh-closed-tabs';

function loadClosedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(CLOSED_TABS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveClosedSet(s: Set<string>) {
  try {
    localStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(Array.from(s)));
  } catch {/* ignore */}
}

interface CanvasTabsProps {
  /** 打开高级管理抽屉的回调（≡ 按钮使用） */
  onOpenManager: () => void;
}

export default function CanvasTabs({ onOpenManager }: CanvasTabsProps) {
  const activeCanvasId = useNodeStore((s) => s.activeCanvasId);
  const activeCanvasName = useNodeStore((s) => s.activeCanvasName);
  // 订阅 recentCanvases 作为"画布列表变更"信号 —— store 的所有 create/rename/delete
  // 都会调 refreshRecentCanvases，进而触发 tabs 重新拉列表
  const recentCanvasesSig = useNodeStore((s) => s.recentCanvases);
  const switchActiveCanvas = useNodeStore((s) => s.switchActiveCanvas);
  const createNewCanvas = useNodeStore((s) => s.createNewCanvas);
  const renameCanvasById = useNodeStore((s) => s.renameCanvasById);
  const deleteCanvasById = useNodeStore((s) => s.deleteCanvasById);

  const [items, setItems] = useState<CanvasRecord[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  // v1.7：关闭的页签集合（只是隐藏 tab，画布数据保留）
  const [closedIds, setClosedIds] = useState<Set<string>>(() => loadClosedSet());
  // v1.7：右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; rec: CanvasRecord } | null>(null);

  const refresh = async () => {
    try {
      const all = await listCanvases({ workspaceId: 'workspace-default' });
      const filtered = all
        .filter((c) => !c.id.startsWith('recent-'))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // 按创建顺序，稳定不跳
      setItems(filtered);
    } catch (e) {
      console.warn('[plotmesh] CanvasTabs 读列表失败：', e);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCanvasId, activeCanvasName, recentCanvasesSig]);

  // 切到一个 active 画布时，自动从 closed 集合移除（你打开了它，就不应该被隐藏）
  useEffect(() => {
    if (activeCanvasId && closedIds.has(activeCanvasId)) {
      const next = new Set(closedIds);
      next.delete(activeCanvasId);
      setClosedIds(next);
      saveClosedSet(next);
    }
  }, [activeCanvasId, closedIds]);

  // 点外部关闭溢出菜单 + 右键菜单
  useEffect(() => {
    if (!showOverflow && !ctxMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
      setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showOverflow, ctxMenu]);

  const handleSwitch = async (id: string) => {
    if (id === activeCanvasId) return;
    await switchActiveCanvas(id);
  };

  const handleCreate = async () => {
    await createNewCanvas();
  };

  const beginRename = (rec: CanvasRecord) => {
    setRenamingId(rec.id);
    setRenameDraft(rec.name || '');
  };

  const commitRename = async (id: string) => {
    const v = renameDraft.trim();
    setRenamingId(null);
    const cur = items.find((c) => c.id === id);
    if (v && cur && v !== cur.name) {
      await renameCanvasById(id, v);
      // refresh 由 activeCanvasName 触发
    }
  };

  /**
   * v1.7：✕ = 关闭页签（不删数据）
   *   - 把 id 加进 closedIds，从 tab bar 隐藏
   *   - 如果关的是当前 active，自动切到列表里下一个未关闭的画布
   */
  const handleClose = async (rec: CanvasRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(closedIds);
    next.add(rec.id);
    setClosedIds(next);
    saveClosedSet(next);
    // 如果关的是当前 active → 切到下一个可见画布
    if (rec.id === activeCanvasId) {
      const visible = items.filter((c) => !next.has(c.id) && c.id !== rec.id);
      if (visible.length > 0) {
        await switchActiveCanvas(visible[0].id);
      } else {
        // 所有画布都被关了 → 新建一个空画布（不至于让用户看到空白）
        await createNewCanvas();
      }
    }
  };

  /**
   * v1.7：右键菜单 = "重新打开关闭的画布" / "删除画布（不可撤销）"
   */
  const handleContextMenu = (rec: CanvasRecord, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, rec });
  };

  const handleDelete = async (rec: CanvasRecord) => {
    setCtxMenu(null);
    const ok = confirm(
      `⚠ 确定要永久删除画布「${rec.name || '未命名'}」吗？\n\n` +
        `这会从磁盘清掉所有节点和边数据，30 天内可在回收站恢复。\n` +
        `（如果只想从顶部页签隐藏，请用 ✕ 按钮 / 关闭页签）`,
    );
    if (!ok) return;
    await deleteCanvasById(rec.id);
    // 同时从 closedIds 移除（删都删了，不需要再"隐藏"）
    if (closedIds.has(rec.id)) {
      const next = new Set(closedIds);
      next.delete(rec.id);
      setClosedIds(next);
      saveClosedSet(next);
    }
  };

  const reopenAll = () => {
    setClosedIds(new Set());
    saveClosedSet(new Set());
    setCtxMenu(null);
  };

  // 渲染时过滤掉 closed 的；但 active 画布永远显示（即使在 closed 里）
  const visibleItems = items.filter((rec) => !closedIds.has(rec.id) || rec.id === activeCanvasId);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="canvas-tabs-bar">
      {/* ≡ 高级管理入口 */}
      <button
        className="canvas-tabs-icon-btn"
        onClick={onOpenManager}
        title="打开画布管理器（搜索/批量）"
      >
        ≡
      </button>

      {/* 横向滚动区 */}
      <div className="canvas-tabs-scroll">
        {visibleItems.map((rec) => {
          const isActive = rec.id === activeCanvasId;
          const isRenaming = renamingId === rec.id;
          // active tab 的显示名优先用 store（避免 IDB 异步写盘期间的短暂滞后）
          const displayName =
            (isActive ? activeCanvasName : rec.name) || '未命名画布';
          return (
            <div
              key={rec.id}
              className={`canvas-tab${isActive ? ' active' : ''}`}
              onClick={() => !isRenaming && handleSwitch(rec.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginRename(rec);
              }}
              onContextMenu={(e) => handleContextMenu(rec, e)}
              title={isRenaming ? '' : `${displayName}（双击重命名 / 右键删除）`}
              data-canvas-id={rec.id}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  className="canvas-tab-input"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(rec.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span className="canvas-tab-label">{displayName}</span>
              )}
              {!isRenaming && (
                <button
                  className="canvas-tab-close"
                  onClick={(e) => handleClose(rec, e)}
                  title="关闭页签（画布数据保留，可从 ▾ 重新打开）"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}

        {/* ＋ 新建 */}
        <button
          className="canvas-tabs-icon-btn add"
          onClick={handleCreate}
          title="新建画布"
        >
          ＋
        </button>
      </div>

      {/* ▾ 溢出菜单 */}
      <div className="canvas-tabs-overflow" ref={overflowRef}>
        <button
          className="canvas-tabs-icon-btn"
          onClick={() => setShowOverflow((v) => !v)}
          title={hiddenCount > 0 ? `所有画布（${hiddenCount} 个已关闭）` : '所有画布'}
          style={hiddenCount > 0 ? { position: 'relative' } : undefined}
        >
          ▾
          {hiddenCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#f59e0b',
              }}
            />
          )}
        </button>
        {showOverflow && (
          <div className="canvas-tabs-overflow-menu">
            {items.length === 0 && (
              <div className="canvas-tabs-overflow-empty">暂无画布</div>
            )}
            {hiddenCount > 0 && (
              <button
                className="canvas-tabs-overflow-item"
                onClick={reopenAll}
                title="把所有关闭的页签重新打开"
                style={{ color: 'var(--accent, #6366f1)', fontWeight: 600 }}
              >
                ↺ 重新打开所有关闭的页签（{hiddenCount}）
              </button>
            )}
            {items.map((rec) => {
              const isActive = rec.id === activeCanvasId;
              const isClosed = closedIds.has(rec.id) && !isActive;
              return (
                <button
                  key={rec.id}
                  className={`canvas-tabs-overflow-item${isActive ? ' active' : ''}`}
                  onClick={() => {
                    setShowOverflow(false);
                    // 点已关闭的画布 → 自动重新打开
                    if (isClosed) {
                      const next = new Set(closedIds);
                      next.delete(rec.id);
                      setClosedIds(next);
                      saveClosedSet(next);
                    }
                    handleSwitch(rec.id);
                  }}
                  title={
                    isClosed
                      ? `${rec.name || '未命名画布'}（已关闭，点击重新打开）`
                      : rec.name || '未命名画布'
                  }
                  style={isClosed ? { opacity: 0.55 } : undefined}
                >
                  {isActive ? '● ' : isClosed ? '○ ' : ''}
                  {rec.name || '未命名画布'}
                  {isClosed ? ' ·已关闭' : ''}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(ctxMenu.x, window.innerWidth - 220),
            top: Math.min(ctxMenu.y, window.innerHeight - 100),
            zIndex: 9999,
            minWidth: 200,
            background: 'var(--bg-card, #fff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            padding: '6px 0',
            fontSize: 13,
            userSelect: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{ padding: '7px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              if (ctxMenu) beginRename(ctxMenu.rec);
              setCtxMenu(null);
            }}
          >
            🏷 重命名
          </div>
          <div
            style={{ padding: '7px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={(e) => {
              if (ctxMenu) handleClose(ctxMenu.rec, e);
              setCtxMenu(null);
            }}
          >
            ✕ 关闭页签（保留数据）
          </div>
          <div style={{ height: 1, background: 'var(--border-color, #e2e8f0)', margin: '4px 0' }} />
          <div
            style={{ padding: '7px 14px', cursor: 'pointer', color: '#ef4444' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => ctxMenu && handleDelete(ctxMenu.rec)}
            title="永久删除画布数据"
          >
            🗑 删除画布（不可撤销）
          </div>
        </div>
      )}
    </div>
  );
}
