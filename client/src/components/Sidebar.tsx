import { useState } from 'react';
import type { NodePackage, PackageGroup } from '../types/nodes';
import { useNodeStore, listRecentCanvases, deleteRecentCanvas, type RecentCanvas } from '../store/nodes';

interface SidebarProps {
  packages: NodePackage[];
  packageGroups: PackageGroup[];
  onLoadPackage: (id: string) => void;
  onDeletePackage: (id: string) => void;
  onSavePackage: () => void;
  /** 最近画布列表的版本号，每变化一次促使本组件重新读取 localStorage */
  recentCanvasesVersion?: number;
  onLoadRecentCanvas?: (item: RecentCanvas) => void;
}

const NODE_TYPES = [
  { type: 'textPrompt', label: '✏️ 文本提示词', description: '输入提示词内容' },
  { type: 'fileUpload', label: '📁 文件上传', description: '上传并解析文件' },
  { type: 'llm', label: '🤖 大模型', description: '调用 LLM 处理' },
  { type: 'textTransform', label: '🔤 文本处理', description: '大小写/替换/提取' },
  { type: 'condition', label: '🔀 条件分支', description: '按关键词分流' },
  { type: 'output', label: '📤 输出', description: '预览/下载/复制' },
];

export default function Sidebar({ packages, packageGroups, onDeletePackage, onSavePackage, recentCanvasesVersion, onLoadRecentCanvas }: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showGroupMenu, setShowGroupMenu] = useState<string | null>(null); // 哪个 pkgId 正在弹"移动到分组"
  const createGroup = useNodeStore((s) => s.createPackageGroup);
  const renameGroup = useNodeStore((s) => s.renamePackageGroup);
  const deleteGroup = useNodeStore((s) => s.deletePackageGroup);
  const toggleCollapsed = useNodeStore((s) => s.togglePackageGroupCollapsed);
  const movePackageToGroup = useNodeStore((s) => s.movePackageToGroup);
  const renamePackage = useNodeStore((s) => s.renamePackage);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  // 拖拽包到分组
  const onPackageDragStart = (event: React.DragEvent, pkgId: string) => {
    event.dataTransfer.setData('application/pkg-id', pkgId);
    event.dataTransfer.effectAllowed = 'move';
  };
  const onGroupDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('application/pkg-id')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };
  const onGroupDrop = (event: React.DragEvent, groupName: string) => {
    const pkgId = event.dataTransfer.getData('application/pkg-id');
    if (pkgId) {
      event.preventDefault();
      event.stopPropagation();
      movePackageToGroup(pkgId, groupName);
    }
  };

  const filteredPackages = packages.filter((pkg) =>
    pkg.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 按分组归类
  const groupedPackages: Record<string, NodePackage[]> = { '': [] };
  packageGroups.forEach((g) => {
    groupedPackages[g.name] = [];
  });
  filteredPackages.forEach((pkg) => {
    const g = pkg.group || '';
    if (!groupedPackages[g]) groupedPackages[g] = [];
    groupedPackages[g].push(pkg);
  });

  const handleNewGroup = () => {
    const name = prompt('请输入新分组名称：');
    if (name && name.trim()) {
      const ok = createGroup(name);
      if (!ok) alert('分组名称已存在');
    }
  };

  const handleDeleteGroup = (groupName: string, count: number) => {
    if (count === 0) {
      deleteGroup(groupName, 'unassign');
      return;
    }
    const choice = confirm(
      `分组「${groupName}」内有 ${count} 个常用功能。\n\n点击「确定」一并删除分组和功能；点击「取消」仅删除分组（功能保留为未分组）。`
    );
    deleteGroup(groupName, choice ? 'delete-all' : 'unassign');
  };

  const handleRenameGroup = (oldName: string) => {
    const next = prompt('修改分组名称：', oldName);
    if (next && next.trim() && next.trim() !== oldName) {
      const ok = renameGroup(oldName, next);
      if (!ok) alert('该名称已被占用');
    }
  };

  const handleRenamePackage = (pkgId: string, oldName: string) => {
    const next = prompt('修改名称：', oldName);
    if (next && next.trim() && next.trim() !== oldName) {
      const ok = renamePackage(pkgId, next);
      if (!ok) alert('该名称已被占用');
    }
  };

  const renderPkgItem = (pkg: NodePackage) => (
    <div
      key={pkg.id}
      className="package-item"
      draggable
      onDragStart={(e) => onPackageDragStart(e, pkg.id)}
    >
      <div
        className="package-item-content"
        title={`拖到画布即可使用「${pkg.name}」${pkg.description ? `\n${pkg.description}` : ''}`}
        style={{ cursor: 'grab' }}
      >
        <span className="package-name">{pkg.name}</span>
        <span className="package-meta">
          {pkg.nodes.length} 个节点 · {new Date(pkg.updatedAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <button
          className="package-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowGroupMenu(showGroupMenu === pkg.id ? null : pkg.id);
          }}
          title="更多操作"
        >
          ⋯
        </button>
        {showGroupMenu === pkg.id && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: 0,
              top: 22,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
              zIndex: 100,
              minWidth: 140,
              fontSize: 12,
              overflow: 'hidden',
            }}
          >
            <button
              className="package-menu-item"
              onClick={() => { handleRenamePackage(pkg.id, pkg.name); setShowGroupMenu(null); }}
            >✎ 重命名</button>
            <div style={{ borderTop: '1px solid var(--border-color)' }} />
            <div style={{ padding: '4px 10px', color: 'var(--text-muted)', fontSize: 10 }}>移动到分组</div>
            <button
              className="package-menu-item"
              onClick={() => { movePackageToGroup(pkg.id, ''); setShowGroupMenu(null); }}
            >📂 无分组</button>
            {packageGroups.map((g) => (
              <button
                key={g.id}
                className="package-menu-item"
                onClick={() => { movePackageToGroup(pkg.id, g.name); setShowGroupMenu(null); }}
              >📁 {g.name}</button>
            ))}
            <div style={{ borderTop: '1px solid var(--border-color)' }} />
            <button
              className="package-menu-item danger"
              onClick={() => {
                if (confirm(`确定删除「${pkg.name}」？`)) {
                  onDeletePackage(pkg.id);
                }
                setShowGroupMenu(null);
              }}
            >🗑 删除</button>
          </div>
        )}
      </div>
    </div>
  );

  // 关掉菜单（点空白）
  const onSidebarClick = () => {
    if (showGroupMenu) setShowGroupMenu(null);
  };

  return (
    <div className="sidebar" onClick={onSidebarClick}>
      <div className="sidebar-header">
        <h2>🧩 节点面板</h2>
      </div>

      {/* 节点类型列表 */}
      <div className="sidebar-section">
        <h3>节点类型</h3>
        <div className="node-list">
          {NODE_TYPES.map((node) => (
            <div
              key={node.type}
              className="node-item"
              draggable
              onDragStart={(e) => onDragStart(e, node.type)}
              title={node.description}
            >
              <span className="node-item-label">{node.label}</span>
              <span className="node-item-drag">⋮⋮</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* 常用功能（打包） */}
      <div className="sidebar-section packages-section">
        <div className="packages-header">
          <h3>📦 常用功能</h3>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="save-pkg-btn" onClick={handleNewGroup} title="新建分组">
              📁
            </button>
            <button className="save-pkg-btn" onClick={onSavePackage} title="保存选中节点为常用功能">
              ＋
            </button>
          </div>
        </div>

        {packages.length === 0 && packageGroups.length === 0 && (
          <p className="empty-hint">框选节点后点 ＋ 保存为常用功能</p>
        )}

        <input
          className="package-search"
          placeholder="搜索..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <div className="package-list">
          {/* 分组列表 */}
          {packageGroups.map((g) => {
            const items = groupedPackages[g.name] || [];
            return (
              <div
                key={g.id}
                className="package-group"
                onDragOver={onGroupDragOver}
                onDrop={(e) => onGroupDrop(e, g.name)}
              >
                <div className="package-group-header">
                  <span
                    onClick={() => toggleCollapsed(g.name)}
                    style={{ cursor: 'pointer', flex: 1, fontSize: 12, fontWeight: 600 }}
                    title="点击折叠/展开"
                  >
                    {g.collapsed ? '▶' : '▼'} 📁 {g.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({items.length})</span>
                  </span>
                  <button
                    className="package-delete-btn"
                    onClick={(e) => { e.stopPropagation(); handleRenameGroup(g.name); }}
                    title="重命名分组"
                    style={{ fontSize: 11 }}
                  >✎</button>
                  <button
                    className="package-delete-btn"
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.name, items.length); }}
                    title="删除分组"
                  >✕</button>
                </div>
                {!g.collapsed && items.length > 0 && (
                  <div className="package-group-body">
                    {items.map(renderPkgItem)}
                  </div>
                )}
                {!g.collapsed && items.length === 0 && (
                  <div className="package-group-empty">把功能拖到这里</div>
                )}
              </div>
            );
          })}

          {/* 未分组 */}
          {(groupedPackages[''] || []).length > 0 && (
            <div
              className="package-group"
              onDragOver={onGroupDragOver}
              onDrop={(e) => onGroupDrop(e, '')}
            >
              {packageGroups.length > 0 && (
                <div className="package-group-header" style={{ color: 'var(--text-muted)' }}>
                  📂 未分组 <span style={{ color: 'var(--text-muted)' }}>({(groupedPackages[''] || []).length})</span>
                </div>
              )}
              <div className="package-group-body">
                {(groupedPackages[''] || []).map(renderPkgItem)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 最近画布：每次画布导入/导出时会推一份快照到这里，方便快速回到旧画布 */}
      {(() => {
        // 通过 recentCanvasesVersion 强制重读 localStorage
        void recentCanvasesVersion;
        const recents = listRecentCanvases();
        if (recents.length === 0) return null;
        return (
          <div className="sidebar-section" style={{ borderTop: '1px solid var(--border, #e2e8f0)', marginTop: 'auto' }}>
            <div className="sidebar-section-header">
              <h3>🕘 最近画布</h3>
            </div>
            <div className="package-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {recents.map((r) => (
                <div
                  key={r.id}
                  className="package-item"
                  title={`${r.nodes.length} 个节点 · ${new Date(r.savedAt).toLocaleString('zh-CN')}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => onLoadRecentCanvas?.(r)}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)' }}>
                      {r.nodes.length} 节点 · {new Date(r.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button
                    className="save-pkg-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`从最近画布列表中删除「${r.name}」？`)) {
                        deleteRecentCanvas(r.id);
                        onLoadRecentCanvas && (() => {})(); // 触发外层重渲染
                        // 简单做法：刷新自己 — 只能依赖外层调用 setRecentCanvasesVersion
                        // 这里直接触发一次假调用让 React 重新比较
                        const evt = new CustomEvent('plotmesh-recent-changed');
                        window.dispatchEvent(evt);
                      }
                    }}
                    style={{ marginLeft: 4, fontSize: 11 }}
                    title="从列表删除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
