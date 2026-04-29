import { useState } from 'react';
import type { NodePackage } from '../types/nodes';

interface SidebarProps {
  packages: NodePackage[];
  onLoadPackage: (id: string) => void;
  onDeletePackage: (id: string) => void;
  onSavePackage: () => void;
}

const NODE_TYPES = [
  { type: 'textPrompt', label: '✏️ 文本提示词', description: '输入提示词内容' },
  { type: 'fileUpload', label: '📁 文件上传', description: '上传并解析文件' },
  { type: 'llm', label: '🤖 大模型', description: '调用 LLM 处理' },
  { type: 'textTransform', label: '🔤 文本处理', description: '大小写/替换/提取' },
  { type: 'condition', label: '🔀 条件分支', description: '按关键词分流' },
  { type: 'output', label: '📤 输出', description: '预览/下载/复制' },
];

export default function Sidebar({ packages, onLoadPackage, onDeletePackage, onSavePackage }: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const filteredPackages = packages.filter((pkg) =>
    pkg.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="sidebar">
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

      {/* 分隔线 */}
      <div className="sidebar-divider" />

      {/* 常用功能（打包） */}
      <div className="sidebar-section packages-section">
        <div className="packages-header">
          <h3>📦 常用功能</h3>
          <button className="save-pkg-btn" onClick={onSavePackage} title="保存选中节点为常用功能">
            ＋
          </button>
        </div>

        {packages.length === 0 && (
          <p className="empty-hint">框选节点后按 Ctrl+S 保存</p>
        )}

        <input
          className="package-search"
          placeholder="搜索常用功能..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <div className="package-list">
          {filteredPackages.map((pkg) => (
            <div key={pkg.id} className="package-item">
              <div
                className="package-item-content"
                onClick={() => onLoadPackage(pkg.id)}
                title={`点击加载「${pkg.name}」`}
              >
                <span className="package-name">{pkg.name}</span>
                <span className="package-meta">
                  {pkg.nodes.length} 个节点 · {new Date(pkg.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
              <button
                className="package-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`确定删除「${pkg.name}」？`)) {
                    onDeletePackage(pkg.id);
                  }
                }}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
