/**
 * Sidebar · 左侧节点 / 常用功能 / 最近画布 面板
 * ---------------------------------------------------------------
 * 三个区域，从上到下：
 *   1. 节点类型列表 — 拖到画布即创建对应节点
 *   2. 常用功能（package）— 把选中节点保存为可复用的预设，支持分组、搜索、重命名、移动到分组
 *   3. 最近画布 — 最多 8 张导入/导出/被覆盖的画布快照，一键回到旧版本
 *
 * 所有数据都持久化在 localStorage（key 见 store/nodes.ts）。
 * 拖拽用 dataTransfer.setData('application/reactflow', type) 触发 Canvas 的 onDrop。
 */
import { useState } from 'react';
import type { NodePackage, PackageGroup } from '../types/nodes';
import { useNodeStore, deleteRecentCanvas, type RecentCanvas } from '../store/nodes';
import ServerStatusIndicator from './ServerStatusIndicator';

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

/**
 * 节点类型按用途分三类（v1.7 alpha）：
 *   - 数据：原始资料 / 远端引用 / 数据提炼
 *   - 文本：文本生成、加工、分流、输出
 *   - 图形：可视化与时序
 * 每类可独立折叠，状态保存在 localStorage。
 */
const NODE_CATEGORIES: Array<{
  key: string;
  label: string;
  items: Array<{ type: string; label: string; description: string }>;
}> = [
  {
    key: 'data',
    label: '📥 数据',
    items: [
      { type: 'fileUpload', label: '📁 文件上传', description: '上传并解析文件' },
      { type: 'webLink', label: '🔗 Web 链接', description: 'wiki / 在线文档 / 新闻' },
      { type: 'extract', label: '📊 数据提取', description: 'LLM 把自由文本/图片规整为 JSON' },
      { type: 'crossOutput', label: '🌐 跨画布输出', description: '把内容投递到另一个画布的 crossInput' },
      { type: 'crossInput', label: '🌐 跨画布输入', description: '接收远端 crossOutput 的回写' },
    ],
  },
  {
    key: 'text',
    label: '📝 文本',
    items: [
      { type: 'textPrompt', label: '✏️ 文本提示词', description: '输入提示词内容' },
      { type: 'llm', label: '🤖 大模型', description: '调用 LLM 处理' },
      { type: 'textTransform', label: '🔤 文本处理', description: '大小写/替换/提取' },
      { type: 'condition', label: '🔀 条件分支', description: '按关键词分流' },
      { type: 'splitter', label: '🔀 分叉', description: '一段切成 N 路输出' },
      { type: 'output', label: '📤 输出', description: '预览/下载/复制/腾讯文档' },
    ],
  },
  {
    key: 'chart',
    label: '🎨 图形',
    items: [
      { type: 'pieChart', label: '🥧 饼图', description: 'JSON 数据可视化（试验性）' },
      { type: 'barChart', label: '📊 柱状图', description: '柱条/条形图（本地 SVG，0 token）' },
      { type: 'genericChart', label: '🎨 自由图形', description: 'LLM 看参考图直接画 SVG（任意形态）' },
      { type: 'dashboard', label: '📊 仪表盘', description: '合并多个图形为一个 HTML 页面' },
      { type: 'timeline', label: '⏱ 时间轴', description: '横向时间轴/镜头切换' },
      { type: 'swimlane', label: '🏊 项目泳道', description: '横向泳道 / 项目时序' },
    ],
  },
  {
    key: 'theme',
    label: '🎨 主题',
    items: [
      { type: 'themeNode', label: '🎨 主题', description: '定调/样式合并，沿连线广播给子节点' },
    ],
  },
  {
    key: 'ai',
    label: '🤖 AI',
    items: [
      { type: 'aiBuilder', label: '🤖 AI 构建器', description: 'AI 读上下文生成节点结构，预览后一键应用' },
    ],
  },
];

const NODE_CAT_COLLAPSED_KEY = 'plotmesh.sidebar.nodeCatCollapsed';
const loadCatCollapsed = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(NODE_CAT_COLLAPSED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export default function Sidebar({ packages, packageGroups, onDeletePackage, onSavePackage, recentCanvasesVersion, onLoadRecentCanvas }: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showGroupMenu, setShowGroupMenu] = useState<string | null>(null); // 哪个 pkgId 正在弹"移动到分组"
  // v1.7 alpha：节点分类折叠状态，持久化到 localStorage
  const [catCollapsed, setCatCollapsed] = useState<Record<string, boolean>>(loadCatCollapsed);
  const toggleCategory = (key: string) => {
    setCatCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(NODE_CAT_COLLAPSED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const createGroup = useNodeStore((s) => s.createPackageGroup);
  const renameGroup = useNodeStore((s) => s.renamePackageGroup);
  const deleteGroup = useNodeStore((s) => s.deletePackageGroup);
  const toggleCollapsed = useNodeStore((s) => s.togglePackageGroupCollapsed);
  const movePackageToGroup = useNodeStore((s) => s.movePackageToGroup);
  const renamePackage = useNodeStore((s) => s.renamePackage);
  // 订阅最近画布列表（D2 起从 store 读，store 变化即重渲染）
  const recentCanvases = useNodeStore((s) => s.recentCanvases);

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
    // v1.5.2 起：删除分组就是删分组本身，组内功能自动放到未分组（不再二次问是否一并删功能）
    const ok = confirm(
      `确定删除分组「${groupName}」？\n\n组内 ${count} 个常用功能会被移到「未分组」保留。`
    );
    if (ok) deleteGroup(groupName, 'unassign');
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
              maxHeight: 360,
              overflowY: 'auto',
            }}
          >
            <button
              className="package-menu-item"
              onClick={() => { handleRenamePackage(pkg.id, pkg.name); setShowGroupMenu(null); }}
            >✎ 重命名</button>
            <button
              className="package-menu-item danger"
              onClick={() => {
                if (confirm(`确定删除常用功能「${pkg.name}」？\n\n此操作不可撤销。`)) {
                  onDeletePackage(pkg.id);
                }
                setShowGroupMenu(null);
              }}
            >🗑 删除</button>
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
      {/* 产品品牌区：左上角 logo 占位 + 产品名 + server 状态灯 */}
      <div className="app-brand" title="PlotMesh">
        <div className="app-brand-logo" aria-hidden="true">
          {/* TODO: 这里替换成真正的 logo（SVG / IMG）。当前为占位方块。 */}
          <span className="app-brand-logo-placeholder">P</span>
        </div>
        <div className="app-brand-name" style={{ flex: 1 }}>PlotMesh</div>
        {/* v1.6.2 server 在线状态指示灯 + 弹出引导 */}
        <ServerStatusIndicator />
      </div>

      {/* v1.6.2：去掉"节点面板"大标题（产品名 + 状态灯 + 子分类已经够清楚了） */}

      {/* 节点类型列表（分类折叠） */}
      <div className="sidebar-section">
        <h3>节点类型</h3>
        <div className="node-list">
          {NODE_CATEGORIES.map((cat) => {
            const collapsed = !!catCollapsed[cat.key];
            return (
              <div key={cat.key} className="node-category">
                <div
                  className="node-category-header"
                  onClick={() => toggleCategory(cat.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 6px',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-muted, #94a3b8)',
                    userSelect: 'none',
                  }}
                  title="点击折叠/展开"
                >
                  <span style={{ width: 10, display: 'inline-block' }}>{collapsed ? '▶' : '▼'}</span>
                  <span style={{ flex: 1 }}>{cat.label}</span>
                  <span style={{ fontWeight: 400 }}>({cat.items.length})</span>
                </div>
                {!collapsed && cat.items.map((node) => (
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
            );
          })}
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
        // recentCanvasesVersion 仅作为外部触发刷新的兼容入参；实际数据来自 store 订阅
        void recentCanvasesVersion;
        const recents = recentCanvases;
        if (recents.length === 0) return null;
        return (
          <div className="sidebar-section" style={{ borderTop: '1px solid var(--border-color, #e2e8f0)', marginTop: 'auto' }}>
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

      {/* v1.6.2：原 sidebar 底部的"外部 AI 接入"面板已搬到 toolbar → API 配置弹窗，
          这里保留 marginTop: auto 让最近画布沉底（如果有） */}
    </div>
  );
}
