import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import type { CustomNodeData, NodePackage, PackageGroup } from '../types/nodes';
import { inferExposedPorts } from '../utils/composite';

export type CustomNode = Node<CustomNodeData>;
export type CustomEdge = Edge;

interface HistorySnapshot {
  nodes: CustomNode[];
  edges: CustomEdge[];
}

interface NodeStore {
  nodes: CustomNode[];
  edges: CustomEdge[];
  packages: NodePackage[];
  packageGroups: PackageGroup[];

  // 历史记录（用于撤销/重做）
  history: HistorySnapshot[];
  future: HistorySnapshot[];

  // 节点操作
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addNode: (node: CustomNode) => void;
  updateNodeData: (nodeId: string, data: Partial<CustomNodeData>) => void;
  deleteNodes: (nodeIds: string[]) => void;
  setEdges: (updater: any) => void;

  // 连线操作
  addEdge: (edge: CustomEdge) => void;
  deleteEdges: (edgeIds: string[]) => void;

  // 打包操作
  /**
   * 保存常用功能。
   * mode='create'   ：永远新增（如果重名会自动追加 (2)/(3) 编号）
   * mode='overwrite'：覆盖同名包（保留旧 id 和 group），找不到则新增
   * 返回操作结果：{ ok, action: 'created' | 'overwritten' | 'renamed', pkgId, message? }
   */
  savePackage: (
    name: string,
    description: string,
    nodeIds: string[],
    options?: { group?: string; mode?: 'create' | 'overwrite' }
  ) => { ok: boolean; action: 'created' | 'overwritten' | 'renamed'; pkgId?: string; message?: string };
  loadPackage: (pkgId: string) => void;
  deletePackage: (pkgId: string) => void;
  renamePackage: (pkgId: string, newName: string) => boolean;
  movePackageToGroup: (pkgId: string, group: string) => void;
  hasPackageName: (name: string) => boolean;
  getPackages: () => NodePackage[];

  // 分组操作
  createPackageGroup: (name: string) => boolean;
  renamePackageGroup: (oldName: string, newName: string) => boolean;
  deletePackageGroup: (name: string, mode: 'unassign' | 'delete-all') => void;
  togglePackageGroupCollapsed: (name: string) => void;

  // 复合节点（group 节点）的折叠/展开
  toggleGroupCollapsed: (groupId: string) => void;

  // 提示词编号更新
  updatePromptNumbers: () => void;
  reorderPromptsByManual: () => void;
  swapPromptOrder: (nodeId: string, direction: 'up' | 'down') => void;

  // 历史/撤销
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // 重置
  reset: () => void;

  // 工作流导入 / 导出
  exportWorkflow: () => string;
  importWorkflow: (jsonText: string) => boolean;
}

const STORAGE_KEY = 'node-editor-packages';
const GROUPS_KEY = 'node-editor-package-groups';
const MAX_HISTORY = 50;

function loadPackages(): NodePackage[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function savePackages(packages: NodePackage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packages));
}

function loadPackageGroups(): PackageGroup[] {
  try {
    const data = localStorage.getItem(GROUPS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function savePackageGroups(groups: PackageGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

export const useNodeStore = create<NodeStore>((set, get) => ({
  nodes: [],
  edges: [],
  packages: loadPackages(),
  packageGroups: loadPackageGroups(),
  history: [],
  future: [],

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as CustomNode[] });
    // 位置/添加/删除变化时更新提示词编号
    const hasStructuralChange = changes.some(
      (c: any) => c.type === 'position' || c.type === 'add' || c.type === 'remove'
    );
    if (hasStructuralChange) {
      setTimeout(() => get().updatePromptNumbers(), 0);
    }
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
    setTimeout(() => get().updatePromptNumbers(), 0);
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      ),
    });
  },

  deleteNodes: (nodeIds) => {
    const cur = get().nodes as any[];
    // 如果删除的是 group 节点，释放其子节点
    const groupIdsToDelete = cur.filter((n: any) => n.type === 'group' && nodeIds.includes(n.id)).map((n: any) => n.id);
    const freedChildren = new Map<string, { x: number; y: number }>();
    if (groupIdsToDelete.length) {
      cur.forEach((n: any) => {
        if (n.parentId && groupIdsToDelete.includes(n.parentId)) {
          const parent = cur.find((p: any) => p.id === n.parentId);
          const abs = {
            x: (parent?.position?.x || 0) + (n.position?.x || 0),
            y: (parent?.position?.y || 0) + (n.position?.y || 0),
          };
          freedChildren.set(n.id, abs);
        }
      });
    }

    set({
      nodes: cur
        .filter((n: any) => !nodeIds.includes(n.id))
        .map((n: any) => {
          if (freedChildren.has(n.id)) {
            const { parentId, extent, ...rest } = n;
            return { ...rest, position: freedChildren.get(n.id)! };
          }
          return n;
        }),
      edges: get().edges.filter(
        (e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)
      ),
    });
    setTimeout(() => get().updatePromptNumbers(), 0);
  },

  setEdges: (updater: any) => {
    if (typeof updater === 'function') {
      set({ edges: updater(get().edges) });
    } else {
      set({ edges: updater });
    }
  },

  addEdge: (edge) => {
    // 去重：避免同 id 的 edge 被重复添加
    const existing = get().edges;
    if (existing.some((e: any) => e.id === edge.id)) return;
    set({ edges: [...existing, edge] });
  },

  deleteEdges: (edgeIds: string[]) => {
    set({ edges: get().edges.filter((e: any) => !edgeIds.includes(e.id)) });
  },

  savePackage: (name, description, nodeIds, options) => {
    const mode = options?.mode || 'create';
    const targetGroup = options?.group || '';
    const { nodes, edges, packages: existingPackages } = get();

    // 只处理真实节点（排除 group 节点，避免嵌套打包出错）
    const pkgNodes = nodes.filter((n: any) => nodeIds.includes(n.id) && n.type !== 'group');
    if (pkgNodes.length === 0) {
      return { ok: false, action: 'created', message: '没有可保存的节点' };
    }

    const pkgEdges = edges.filter(
      (e) => pkgNodes.some((n: any) => n.id === e.source) && pkgNodes.some((n: any) => n.id === e.target)
    );

    // 计算所有选中节点的绝对坐标（考虑父 group）
    const getAbsPos = (n: any) => {
      let x = n.position?.x || 0;
      let y = n.position?.y || 0;
      let parentId = n.parentId;
      while (parentId) {
        const parent = nodes.find((p: any) => p.id === parentId);
        if (!parent) break;
        x += parent.position?.x || 0;
        y += parent.position?.y || 0;
        parentId = (parent as any).parentId;
      }
      return { x, y };
    };

    // 存储时：以最左上角节点为原点 (0,0) 保存相对坐标，方便加载
    let minXAbs = Infinity, minYAbs = Infinity;
    pkgNodes.forEach((n: any) => {
      const abs = getAbsPos(n);
      minXAbs = Math.min(minXAbs, abs.x);
      minYAbs = Math.min(minYAbs, abs.y);
    });
    const pkgNodesNormalized = pkgNodes.map((n: any) => {
      const abs = getAbsPos(n);
      // 剥离 parentId 和 extent，保存的是"独立"节点
      const { parentId, extent, ...rest } = n;
      return {
        ...rest,
        position: { x: abs.x - minXAbs, y: abs.y - minYAbs },
        selected: false,
      };
    });

    // 处理重名 / 覆盖逻辑
    const trimmedName = (name || '').trim();
    const existingByName = existingPackages.find((p) => p.name === trimmedName);

    let pkg: NodePackage;
    let action: 'created' | 'overwritten' | 'renamed' = 'created';
    let packages: NodePackage[];

    if (existingByName && mode === 'overwrite') {
      // 覆盖：保留旧 id 和 group（除非显式指定 options.group）
      pkg = {
        ...existingByName,
        name: trimmedName,
        description: description || existingByName.description,
        group: options?.group !== undefined ? targetGroup : existingByName.group,
        nodes: pkgNodesNormalized,
        edges: pkgEdges,
        updatedAt: new Date().toISOString(),
      };
      packages = existingPackages.map((p) => (p.id === existingByName.id ? pkg : p));
      action = 'overwritten';
    } else {
      // 新建：如果重名（mode=create），自动追加 (2)/(3)
      let finalName = trimmedName;
      if (existingByName) {
        let i = 2;
        while (existingPackages.some((p) => p.name === `${trimmedName} (${i})`)) i++;
        finalName = `${trimmedName} (${i})`;
        action = 'renamed';
      }
      pkg = {
        id: `pkg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: finalName,
        description,
        group: targetGroup,
        nodes: pkgNodesNormalized,
        edges: pkgEdges,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      packages = [...existingPackages, pkg];
    }

    savePackages(packages);

    // 节点类型对应的默认尺寸（极简紧凑版）
    const nodeSizes: Record<string, { w: number; h: number }> = {
      fileUpload: { w: 150, h: 90 },
      textPrompt: { w: 150, h: 110 },
      llm: { w: 150, h: 150 },
      output: { w: 150, h: 110 },
    };
    const getSize = (type: string) => nodeSizes[type] || { w: 150, h: 110 };

    const padding = 40;
    const headerPad = 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pkgNodes.forEach((n: any) => {
      const abs = getAbsPos(n);
      const size = getSize(n.type);
      minX = Math.min(minX, abs.x);
      minY = Math.min(minY, abs.y);
      maxX = Math.max(maxX, abs.x + size.w);
      maxY = Math.max(maxY, abs.y + size.h);
    });
    if (!Number.isFinite(minX)) {
      set({ packages });
      return { ok: true, action, pkgId: pkg.id };
    }

    const groupId = `group-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const groupPosition = { x: minX - padding, y: minY - padding - headerPad };
    const groupWidth = Math.max(240, (maxX - minX) + padding * 2);
    const groupHeight = Math.max(140, (maxY - minY) + padding * 2 + headerPad);

    const groupNode: any = {
      id: groupId,
      type: 'group',
      position: groupPosition,
      style: { width: groupWidth, height: groupHeight },
      width: groupWidth,
      height: groupHeight,
      data: {
        type: 'group',
        label: pkg.name || '功能组',
        packageId: pkg.id,
        collapsed: false,
        exposedPorts: inferExposedPorts(pkgNodes, pkgEdges),
        childCount: pkgNodes.length,
      },
      zIndex: -1,
      selectable: true,
      draggable: true,
    };

    // 转子节点为相对于新 group 的坐标
    const pkgIdSet = new Set(nodeIds);
    const others = nodes.filter((n: any) => !pkgIdSet.has(n.id));
    const newChildren = pkgNodes.map((n: any) => {
      const abs = getAbsPos(n);
      return {
        ...n,
        parentId: groupId,
        extent: 'parent' as const,
        position: {
          x: abs.x - groupPosition.x,
          y: abs.y - groupPosition.y,
        },
        selected: false,
      };
    });

    // group 节点必须在子节点之前（React Flow 要求）
    set({
      nodes: [...others, groupNode, ...newChildren],
      packages,
    });

    return { ok: true, action, pkgId: pkg.id };
  },

  hasPackageName: (name: string) => {
    const trimmed = (name || '').trim();
    return get().packages.some((p) => p.name === trimmed);
  },

  renamePackage: (pkgId, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) return false;
    const pkgs = get().packages;
    if (pkgs.some((p) => p.name === trimmed && p.id !== pkgId)) return false;
    const updated = pkgs.map((p) => (p.id === pkgId ? { ...p, name: trimmed, updatedAt: new Date().toISOString() } : p));
    savePackages(updated);
    set({ packages: updated });
    return true;
  },

  movePackageToGroup: (pkgId, group) => {
    const pkgs = get().packages.map((p) =>
      p.id === pkgId ? { ...p, group, updatedAt: new Date().toISOString() } : p
    );
    savePackages(pkgs);
    set({ packages: pkgs });
  },

  createPackageGroup: (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    const groups = get().packageGroups;
    if (groups.some((g) => g.name === trimmed)) return false;
    const next: PackageGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      name: trimmed,
      collapsed: false,
      createdAt: new Date().toISOString(),
    };
    const updated = [...groups, next];
    savePackageGroups(updated);
    set({ packageGroups: updated });
    return true;
  },

  renamePackageGroup: (oldName, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) return false;
    const groups = get().packageGroups;
    if (groups.some((g) => g.name === trimmed)) return false;
    const updatedGroups = groups.map((g) => (g.name === oldName ? { ...g, name: trimmed } : g));
    savePackageGroups(updatedGroups);
    // 同步更新已绑定的包
    const pkgs = get().packages.map((p) => (p.group === oldName ? { ...p, group: trimmed } : p));
    savePackages(pkgs);
    set({ packageGroups: updatedGroups, packages: pkgs });
    return true;
  },

  deletePackageGroup: (name, mode) => {
    const groups = get().packageGroups.filter((g) => g.name !== name);
    savePackageGroups(groups);
    if (mode === 'delete-all') {
      const pkgs = get().packages.filter((p) => p.group !== name);
      savePackages(pkgs);
      set({ packageGroups: groups, packages: pkgs });
    } else {
      // unassign
      const pkgs = get().packages.map((p) => (p.group === name ? { ...p, group: '' } : p));
      savePackages(pkgs);
      set({ packageGroups: groups, packages: pkgs });
    }
  },

  togglePackageGroupCollapsed: (name) => {
    const groups = get().packageGroups.map((g) =>
      g.name === name ? { ...g, collapsed: !g.collapsed } : g
    );
    savePackageGroups(groups);
    set({ packageGroups: groups });
  },

  /**
   * 复合节点折叠 / 展开
   * 折叠时：把内部子节点 hidden=true，width/height 收缩到单节点尺寸
   * 展开时：恢复 hidden=false 和原 width/height
   */
  toggleGroupCollapsed: (groupId: string) => {
    const nodes = get().nodes as any[];
    const group = nodes.find((n) => n.id === groupId && n.type === 'group');
    if (!group) return;
    const collapsed = !group.data?.collapsed;

    const COLLAPSED_W = 200;
    const COLLAPSED_H = Math.max(
      90,
      ((group.data?.exposedPorts?.length || 1) * 16) + 70
    );

    const updated = nodes.map((n: any) => {
      if (n.id === groupId) {
        // 切到折叠：保存当前展开尺寸到 data.expandedSize；切到展开：恢复
        if (collapsed) {
          const prevW = n.style?.width || n.width || 240;
          const prevH = n.style?.height || n.height || 160;
          return {
            ...n,
            width: COLLAPSED_W,
            height: COLLAPSED_H,
            style: { ...(n.style || {}), width: COLLAPSED_W, height: COLLAPSED_H },
            data: {
              ...n.data,
              collapsed: true,
              expandedSize: { w: prevW, h: prevH },
            },
          };
        } else {
          const ex = n.data?.expandedSize || { w: 240, h: 160 };
          return {
            ...n,
            width: ex.w,
            height: ex.h,
            style: { ...(n.style || {}), width: ex.w, height: ex.h },
            data: {
              ...n.data,
              collapsed: false,
            },
          };
        }
      }
      // 子节点：折叠时隐藏，展开时显示
      if (n.parentId === groupId) {
        return { ...n, hidden: collapsed };
      }
      return n;
    });

    set({ nodes: updated });
  },

  loadPackage: (pkgId) => {
    const pkg = get().packages.find((p) => p.id === pkgId);
    if (!pkg) return;

    get().pushHistory();

    // 节点类型默认尺寸（和 savePackage 保持一致，极简紧凑版）
    const nodeSizes: Record<string, { w: number; h: number }> = {
      fileUpload: { w: 150, h: 90 },
      textPrompt: { w: 150, h: 110 },
      llm: { w: 150, h: 150 },
      output: { w: 150, h: 110 },
    };

    // 让新加载的节点整体偏移一个小距离，避免和现有节点重叠
    const existingNodes = get().nodes as any[];
    const offsetX = 20 + (existingNodes.length * 8);
    const offsetY = 20 + (existingNodes.length * 8);

    const idMap = new Map<string, string>();
    const suffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const newNodes = pkg.nodes.map((n: any, i: number) => {
      const newId = `${n.type}-${suffix}-${i}`;
      idMap.set(n.id, newId);
      return { ...n, id: newId, selected: false };
    });

    const newEdges = pkg.edges.map((e: any, i: number) => ({
      ...e,
      id: `edge-${suffix}-${i}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
    }));

    // 计算包围框
    const padding = 40;
    const headerPad = 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    newNodes.forEach((n: any) => {
      const size = nodeSizes[n.type] || { w: 300, h: 200 };
      const x = (n.position?.x || 0) + offsetX;
      const y = (n.position?.y || 0) + offsetY;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + size.w);
      maxY = Math.max(maxY, y + size.h);
    });

    const groupId = `group-${suffix}-loaded`;
    const groupPosition = { x: minX - padding, y: minY - padding - headerPad };
    const groupWidth = Math.max(240, (maxX - minX) + padding * 2);
    const groupHeight = Math.max(140, (maxY - minY) + padding * 2 + headerPad);

    const groupNode: any = {
      id: groupId,
      type: 'group',
      position: groupPosition,
      style: { width: 200, height: Math.max(90, ((inferExposedPorts(newNodes, newEdges).length || 1) * 16) + 70) },
      width: 200,
      height: Math.max(90, ((inferExposedPorts(newNodes, newEdges).length || 1) * 16) + 70),
      data: {
        type: 'group',
        label: pkg.name || '功能组',
        packageId: pkg.id,
        collapsed: true,            // 拖出时默认折叠
        exposedPorts: inferExposedPorts(newNodes, newEdges),
        childCount: newNodes.length,
        expandedSize: { w: groupWidth, h: groupHeight }, // 双击展开后还原此尺寸
      },
      zIndex: -1,
      selectable: true,
      draggable: true,
    };

    // 子节点转为相对 group 的坐标，默认隐藏（折叠态）
    const newChildren = newNodes.map((n: any) => ({
      ...n,
      parentId: groupId,
      extent: 'parent' as const,
      hidden: true,
      position: {
        x: (n.position?.x || 0) + offsetX - groupPosition.x,
        y: (n.position?.y || 0) + offsetY - groupPosition.y,
      },
    }));

    set({
      nodes: [...existingNodes, groupNode, ...newChildren],
      edges: [...get().edges, ...newEdges],
    });
    setTimeout(() => get().updatePromptNumbers(), 0);
  },

  deletePackage: (pkgId) => {
    const packages = get().packages.filter((p) => p.id !== pkgId);
    savePackages(packages);
    set({ packages });
  },

  getPackages: () => get().packages,

  updatePromptNumbers: () => {
    const { nodes } = get();
    const textNodes = nodes.filter((n) => n.data.type === 'textPrompt');

    // 优先按已有 promptNumber 排序，没有的按 x 坐标填充
    const withNumber = textNodes.filter((n: any) => typeof n.data.promptNumber === 'number' && n.data.promptNumber > 0);
    const withoutNumber = textNodes.filter((n: any) => !(typeof n.data.promptNumber === 'number' && n.data.promptNumber > 0));
    withoutNumber.sort((a, b) => (a.position?.x || 0) - (b.position?.x || 0));
    withNumber.sort((a: any, b: any) => (a.data.promptNumber || 0) - (b.data.promptNumber || 0));
    // 合并：已编号在前，未编号在后
    const sorted = [...withNumber, ...withoutNumber];
    // 按顺序重新分配 1..N 避免重复
    const idToIndex = new Map<string, number>();
    sorted.forEach((n, i) => idToIndex.set(n.id, i + 1));

    const updatedNodes = nodes.map((node) => {
      if (node.data.type === 'textPrompt') {
        const idx = idToIndex.get(node.id) || 1;
        return {
          ...node,
          data: { ...node.data, promptNumber: idx },
        };
      }
      return node;
    });

    const changed = updatedNodes.some((n, i) => {
      const old = nodes[i];
      return (old.data as any).promptNumber !== (n.data as any).promptNumber;
    });
    if (changed) {
      set({ nodes: updatedNodes });
    }
  },

  // 根据用户通过 ▲▼ 按钮修改的 promptNumber 重排（解决冲突、去重）
  reorderPromptsByManual: () => {
    const { nodes } = get();
    const textNodes = nodes.filter((n) => n.data.type === 'textPrompt');
    // 按 promptNumber 升序（同值时保持原序）
    const sorted = [...textNodes].sort((a: any, b: any) => {
      const an = a.data.promptNumber || 999999;
      const bn = b.data.promptNumber || 999999;
      return an - bn;
    });
    const idToIdx = new Map<string, number>();
    sorted.forEach((n, i) => idToIdx.set(n.id, i + 1));

    const updatedNodes = nodes.map((node) => {
      if (node.data.type === 'textPrompt') {
        const idx = idToIdx.get(node.id) || 1;
        if ((node.data as any).promptNumber !== idx) {
          return { ...node, data: { ...node.data, promptNumber: idx } };
        }
      }
      return node;
    });
    set({ nodes: updatedNodes });
  },

  // 用户点击 ▲ / ▼ 时：和相邻编号的节点交换
  swapPromptOrder: (nodeId: string, direction: 'up' | 'down') => {
    const { nodes } = get();
    const textNodes = nodes.filter((n: any) => n.data.type === 'textPrompt');
    const sorted = [...textNodes].sort((a: any, b: any) => {
      return (a.data.promptNumber || 0) - (b.data.promptNumber || 0);
    });
    const idx = sorted.findIndex((n: any) => n.id === nodeId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[swapIdx];
    const aNum = (a.data as any).promptNumber || (idx + 1);
    const bNum = (b.data as any).promptNumber || (swapIdx + 1);

    const updatedNodes = nodes.map((n: any) => {
      if (n.id === a.id) return { ...n, data: { ...n.data, promptNumber: bNum } };
      if (n.id === b.id) return { ...n, data: { ...n.data, promptNumber: aNum } };
      return n;
    });
    set({ nodes: updatedNodes });
    // 重排保证无冲突
    setTimeout(() => get().reorderPromptsByManual(), 0);
  },

  pushHistory: () => {
    const { nodes, edges, history } = get();
    const snapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    const newHistory = [...history, snapshot].slice(-MAX_HISTORY);
    set({ history: newHistory, future: [] });
  },

  undo: () => {
    const { history, nodes, edges, future } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const currentSnapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      history: history.slice(0, -1),
      future: [...future, currentSnapshot],
    });
  },

  redo: () => {
    const { future, nodes, edges, history } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const currentSnapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: future.slice(0, -1),
      history: [...history, currentSnapshot],
    });
  },

  reset: () => {
    set({ nodes: [], edges: [] });
  },

  // 导出当前画布为 JSON 字符串
  exportWorkflow: () => {
    const { nodes, edges } = get();
    const payload = {
      version: 1,
      type: 'node-editor-workflow',
      exportedAt: new Date().toISOString(),
      nodes,
      edges,
    };
    return JSON.stringify(payload, null, 2);
  },

  // 从 JSON 字符串导入工作流（整体替换画布）
  importWorkflow: (jsonText: string) => {
    try {
      const data = JSON.parse(jsonText);
      if (!data || !Array.isArray(data.nodes)) {
        throw new Error('无效的工作流文件格式');
      }
      get().pushHistory();
      set({
        nodes: data.nodes,
        edges: Array.isArray(data.edges) ? data.edges : [],
      });
      setTimeout(() => get().updatePromptNumbers(), 0);
      return true;
    } catch (e: any) {
      alert('导入失败：' + (e.message || '未知错误'));
      return false;
    }
  },
}));

// 开发期调试用：暴露 store 到 window
if (typeof window !== 'undefined') {
  (window as any).__nodeStore = useNodeStore;
}
