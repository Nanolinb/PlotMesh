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
import { loadHiddenSet } from '../utils/canvasVisibility';

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
  // v1.7：抽屉级"隐藏"集合（IDB.META 持久化，CanvasManager 控制）
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(new Set());
  // v1.7：右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; rec: CanvasRecord } | null>(null);
  // v1.7：横滚 ref + 左右按钮显示状态
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // v1.7：拖拽排序
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // v1.7：自定义 tab 顺序（持久化到 LS）
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('plotmesh-tab-order');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const refresh = async () => {
    try {
      const all = await listCanvases({ workspaceId: 'workspace-default' });
      const filtered = all
        .filter((c) => !c.id.startsWith('recent-'))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // 按创建顺序，稳定不跳
      setItems(filtered);
      // 同步 hiddenSet（抽屉里改过会触发 'plotmesh-hidden-changed' 事件）
      const hs = await loadHiddenSet();
      setHiddenSet(hs);
    } catch (e) {
      console.warn('[plotmesh] CanvasTabs 读列表失败：', e);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCanvasId, activeCanvasName, recentCanvasesSig]);

  // 抽屉改了 hidden 之后通知 tabs 刷新（CanvasManager dispatch 这个事件）
  useEffect(() => {
    const onHiddenChanged = () => {
      loadHiddenSet().then(setHiddenSet);
    };
    window.addEventListener('plotmesh-hidden-changed', onHiddenChanged);
    return () => window.removeEventListener('plotmesh-hidden-changed', onHiddenChanged);
  }, []);

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
   *   - 如果关的是当前 active，先切到下一个未关闭的画布，再加入 closedIds
   *     （避免 useEffect 自动把 active 从 closedIds 移除导致页签不消失）
   */
  const handleClose = async (rec: CanvasRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // 关 active 的特殊处理：先切走 active，再标记关闭
    if (rec.id === activeCanvasId) {
      const next = new Set(closedIds);
      next.add(rec.id);
      // 找候补：在 items 里挑一个不是自己且不在 closedIds 里的
      const fallback = items.find((c) => c.id !== rec.id && !next.has(c.id));
      if (fallback) {
        // 先切走 → 再写 closedIds（顺序很重要：第 100 行的 useEffect 只会把"切到的 active"从 closedIds 移除，
        // 不会动我们刚刚标记关闭的 rec.id）
        await switchActiveCanvas(fallback.id);
        setClosedIds(next);
        saveClosedSet(next);
      } else {
        // 所有画布都关了 → 先标关闭，再创建空白；createNewCanvas 会变成新 active
        setClosedIds(next);
        saveClosedSet(next);
        await createNewCanvas();
      }
      return;
    }
    // 非 active → 直接加 closedIds 即可
    const next = new Set(closedIds);
    next.add(rec.id);
    setClosedIds(next);
    saveClosedSet(next);
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
  // 同时按 tabOrder 排序（v1.7 拖拽排序结果）
  const sortedItems = (() => {
    const orderMap = new Map<string, number>();
    tabOrder.forEach((id, idx) => orderMap.set(id, idx));
    return [...items].sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : 1e9 + (a.createdAt || 0);
      const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : 1e9 + (b.createdAt || 0);
      return ai - bi;
    });
  })();
  const visibleItems = sortedItems.filter((rec) => {
    // active 永远显示（即使被 closed 或 hidden）
    if (rec.id === activeCanvasId) return true;
    if (closedIds.has(rec.id)) return false;
    if (hiddenSet.has(rec.id)) return false;
    return true;
  });
  const hiddenCount = sortedItems.length - visibleItems.length;

  // v1.7：滚动可达性检测（左右按钮启用/禁用）
  const [isOverflowing, setIsOverflowing] = useState(false);
  const updateScrollable = () => {
    const el = scrollRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 1;
    // 调试：临时打日志看为什么没溢出
    if (visibleItems.length > 3) {
      console.debug('[CanvasTabs] scrollW=', el.scrollWidth, 'clientW=', el.clientWidth, 'overflow=', overflow, 'tabs=', visibleItems.length);
    }
    setIsOverflowing(overflow);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 多次延迟测量，等 tab DOM 渲染完毕（首次挂载 scrollWidth 可能还是 0）
    updateScrollable();
    const t1 = setTimeout(updateScrollable, 50);
    const t2 = setTimeout(updateScrollable, 200);
    const onScroll = () => updateScrollable();
    el.addEventListener('scroll', onScroll, { passive: true });

    // v1.7：wheel 事件统一拦截，转横滚
    // - macOS 触摸板双指横向滑动 → deltaX，直接累加到 scrollLeft
    // - macOS 触摸板/鼠标滚轮垂直滚动 → deltaY，也转成横滚（页签里向上滚没意义）
    // - 设 passive:false 才能 preventDefault 阻止页面整体竖滚
    const onWheel = (e: WheelEvent) => {
      const dx = e.deltaX;
      const dy = e.deltaY;
      if (Math.abs(dx) > Math.abs(dy)) {
        // 已经是横向（触摸板双指水平）—— 让浏览器原生滚（horizontal default 行为已生效）
        // 但有些场景浏览器不会自动横滚，强制处理一下
        el.scrollLeft += dx;
        e.preventDefault();
      } else if (Math.abs(dy) > 0) {
        // 垂直 → 转横向
        el.scrollLeft += dy;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // 容器变化（窗口缩放）也重测
    const ro = new ResizeObserver(updateScrollable);
    ro.observe(el);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel as any);
      ro.disconnect();
    };
  }, [visibleItems.length]);

  const scrollByDir = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 220, behavior: 'smooth' });
  };

  // v1.7：拖拽排序
  const handleDragStart = (id: string, e: React.DragEvent) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // 必须设置 dataTransfer 才能跨 chromium 触发 dragover
    try { e.dataTransfer.setData('text/plain', id); } catch {/* ignore */}
  };
  const handleDragOver = (id: string, e: React.DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    if (id !== draggingId) setDragOverId(id);
  };
  const handleDrop = (targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    // 计算新顺序
    const ids = sortedItems.map((c) => c.id);
    const fromIdx = ids.indexOf(draggingId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggingId);
    setTabOrder(next);
    try { localStorage.setItem('plotmesh-tab-order', JSON.stringify(next)); } catch {/* ignore */}
    setDraggingId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

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

      {/* v1.7：左滚按钮（溢出时显示；启用/禁用根据 canScrollLeft） */}
      {isOverflowing && (
        <button
          className="canvas-tabs-icon-btn"
          onClick={() => scrollByDir(-1)}
          disabled={!canScrollLeft}
          title={canScrollLeft ? '向左滚动' : '已到最左'}
          style={{
            flexShrink: 0,
            opacity: canScrollLeft ? 1 : 0.35,
            cursor: canScrollLeft ? 'pointer' : 'not-allowed',
          }}
        >
          ‹
        </button>
      )}

      {/* 横向滚动区 */}
      <div className="canvas-tabs-scroll" ref={scrollRef}>
        {visibleItems.map((rec) => {
          const isActive = rec.id === activeCanvasId;
          const isRenaming = renamingId === rec.id;
          const isDragOver = dragOverId === rec.id && draggingId !== rec.id;
          const isDragging = draggingId === rec.id;
          // active tab 的显示名优先用 store（避免 IDB 异步写盘期间的短暂滞后）
          const displayName =
            (isActive ? activeCanvasName : rec.name) || '未命名画布';
          return (
            <div
              key={rec.id}
              className={`canvas-tab${isActive ? ' active' : ''}`}
              draggable={!isRenaming}
              onDragStart={(e) => handleDragStart(rec.id, e)}
              onDragOver={(e) => handleDragOver(rec.id, e)}
              onDrop={(e) => handleDrop(rec.id, e)}
              onDragEnd={handleDragEnd}
              onClick={() => !isRenaming && handleSwitch(rec.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginRename(rec);
              }}
              onContextMenu={(e) => handleContextMenu(rec, e)}
              title={isRenaming ? '' : `${displayName}（双击重命名 / 拖拽排序 / 右键删除）`}
              data-canvas-id={rec.id}
              style={{
                opacity: isDragging ? 0.4 : 1,
                ...(isDragOver
                  ? { boxShadow: 'inset 3px 0 0 0 var(--accent, #6366f1)' }
                  : null),
              }}
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

      {/* v1.7：右滚按钮（溢出时显示；启用/禁用根据 canScrollRight） */}
      {isOverflowing && (
        <button
          className="canvas-tabs-icon-btn"
          onClick={() => scrollByDir(1)}
          disabled={!canScrollRight}
          title={canScrollRight ? '向右滚动' : '已到最右'}
          style={{
            flexShrink: 0,
            opacity: canScrollRight ? 1 : 0.35,
            cursor: canScrollRight ? 'pointer' : 'not-allowed',
          }}
        >
          ›
        </button>
      )}

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
