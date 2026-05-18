/**
 * CanvasManager.tsx · v1.5 D3 多画布管理抽屉
 * ---------------------------------------------------------------
 * 左侧抽屉，列出所有画布（按 lastOpenedAt 倒序）。
 *
 * 功能：
 *   - 切换 active 画布（点击行）
 *   - 新建画布（顶部 ＋）
 *   - 重命名（行内 ✎ 按钮）
 *   - 删除（行内 ✕ 按钮，需二次确认）
 *   - 搜索（按名称过滤）
 *
 * 数据来自 IDB（每次打开抽屉时主动 listCanvases；切换/新建/删除完会自动刷新）。
 *
 * 注意：把 id 以 'recent-' 开头的画布过滤掉 —— 那些是导出/导入时的"快照"，
 *       由 Sidebar 中的"最近画布"区域呈现，不放到管理器里避免混淆。
 */
import { useEffect, useState } from 'react';
import { useNodeStore } from '../store/nodes';
import { listCanvases } from '../store/storage';
import type { Canvas as CanvasRecord } from '../types/db';

interface CanvasManagerProps {
  open: boolean;
  onClose: () => void;
}

export default function CanvasManager({ open, onClose }: CanvasManagerProps) {
  const activeCanvasId = useNodeStore((s) => s.activeCanvasId);
  const activeCanvasName = useNodeStore((s) => s.activeCanvasName);
  const switchActiveCanvas = useNodeStore((s) => s.switchActiveCanvas);
  const createNewCanvas = useNodeStore((s) => s.createNewCanvas);
  const renameCanvasById = useNodeStore((s) => s.renameCanvasById);
  const deleteCanvasById = useNodeStore((s) => s.deleteCanvasById);

  const [items, setItems] = useState<CanvasRecord[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const all = await listCanvases({ workspaceId: 'workspace-default' });
      // 过滤掉 'recent-' 前缀的快照画布
      const filtered = all
        .filter((c) => !c.id.startsWith('recent-'))
        .sort(
          (a, b) =>
            (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)
        );
      setItems(filtered);
    } catch (e) {
      console.warn('[plotmesh] CanvasManager 读列表失败：', e);
    }
  };

  // 抽屉打开时刷新列表；activeCanvasId / activeCanvasName 变化时也刷新
  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeCanvasId, activeCanvasName]);

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
      await createNewCanvas();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (rec: CanvasRecord) => {
    const next = prompt('修改画布名称：', rec.name || '');
    if (!next || !next.trim() || next.trim() === rec.name) return;
    await renameCanvasById(rec.id, next.trim());
    refresh();
  };

  const handleDelete = async (rec: CanvasRecord) => {
    const ok = confirm(
      `确定删除画布「${rec.name || '未命名'}」？\n此操作不可撤销。`
    );
    if (!ok) return;
    await deleteCanvasById(rec.id);
    refresh();
  };

  if (!open) return null;

  const filtered = items.filter((c) =>
    (c.name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* 遮罩层 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.32)',
          zIndex: 999,
        }}
      />
      {/* 抽屉本体 */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: 320,
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
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="save-pkg-btn"
              onClick={handleCreate}
              title="新建画布"
              disabled={busy}
            >
              ＋
            </button>
            <button
              className="save-pkg-btn"
              onClick={onClose}
              title="关闭"
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '8px 12px' }}>
          <input
            placeholder="搜索画布..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: 6,
              background: 'var(--bg-1, #f8fafc)',
              color: 'var(--text, #1e293b)',
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
              没有匹配的画布
            </div>
          ) : (
            filtered.map((rec) => {
              const isActive = rec.id === activeCanvasId;
              const nodeCount = Array.isArray(rec.nodes)
                ? (rec.nodes as any[]).length
                : 0;
              return (
                <div
                  key={rec.id}
                  onClick={() => handleSwitch(rec.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    margin: '2px 0',
                    borderRadius: 6,
                    cursor: isActive ? 'default' : 'pointer',
                    background: isActive
                      ? 'var(--accent-light, #eef2ff)'
                      : 'transparent',
                    border: isActive
                      ? '1px solid var(--accent, #6366f1)'
                      : '1px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--bg-1, #f1f5f9)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.background =
                        'transparent';
                  }}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive
                          ? 'var(--accent, #6366f1)'
                          : 'var(--text, #1e293b)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isActive ? '● ' : ''}
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
                      {new Date(
                        rec.lastOpenedAt ?? rec.updatedAt
                      ).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
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
            })
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
          共 {items.length} 张画布
        </div>
      </div>
    </>
  );
}
