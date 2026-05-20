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
 * 删除策略（v1.5.x，跨画布引用尚未落地）：
 *   - 调用 store.deleteCanvasById：当前是直删；后续 v1.x 接入 findCrossCanvasReferences 时
 *     先做引用检测、再执行删除/拒绝/换 placeholder。
 *
 * 数据来源：
 *   - 直接 listCanvases() 从 IDB 读全部，过滤掉 'recent-' 快照前缀。
 *   - 在 activeCanvasId / activeCanvasName 变化时主动刷新一次。
 */
import { useEffect, useRef, useState } from 'react';
import { useNodeStore } from '../store/nodes';
import { listCanvases } from '../store/storage';
import type { Canvas as CanvasRecord } from '../types/db';

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

  // 点外部关闭溢出菜单
  useEffect(() => {
    if (!showOverflow) return;
    const onDocClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showOverflow]);

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

  const handleDelete = async (rec: CanvasRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO(v2.0-β)：findCrossCanvasReferences(rec.id) 后再决定是否真删
    const ok = confirm(`确定删除画布「${rec.name || '未命名'}」？\n此操作不可撤销。`);
    if (!ok) return;
    await deleteCanvasById(rec.id);
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

      {/* 横向滚动区 */}
      <div className="canvas-tabs-scroll">
        {items.map((rec) => {
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
              title={isRenaming ? '' : `${displayName}（双击重命名）`}
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
                  onClick={(e) => handleDelete(rec, e)}
                  title="关闭画布"
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
          title="所有画布"
        >
          ▾
        </button>
        {showOverflow && (
          <div className="canvas-tabs-overflow-menu">
            {items.length === 0 && (
              <div className="canvas-tabs-overflow-empty">暂无画布</div>
            )}
            {items.map((rec) => {
              const isActive = rec.id === activeCanvasId;
              return (
                <button
                  key={rec.id}
                  className={`canvas-tabs-overflow-item${isActive ? ' active' : ''}`}
                  onClick={() => {
                    setShowOverflow(false);
                    handleSwitch(rec.id);
                  }}
                  title={rec.name || '未命名画布'}
                >
                  {isActive ? '● ' : ''}
                  {rec.name || '未命名画布'}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
