/**
 * store/nodes.ts · 全局工作流状态（zustand）
 * ---------------------------------------------------------------
 * 这是整个 PlotMesh 前端的"单一真相源"。负责：
 *
 *   1. nodes / edges      — 当前画布数据（与 React Flow 双向绑定）
 *   2. packages / groups   — 用户保存的"常用功能"（package）和它们的分组
 *   3. history / future   — 撤销 / 重做栈（最多 MAX_HISTORY 条）
 *
 * 持久化策略（localStorage）：
 *   - 'plotmesh-canvas-draft'      画布工作中草稿（含 nodes / edges，会清掉运行时状态）
 *   - 'node-editor-packages'       常用功能列表
 *   - 'node-editor-package-groups' 常用功能的分组
 *   - 'plotmesh-recent-canvases'   最近 8 张画布快照
 *   - 'plotmesh-autosave-min'      自动保存间隔（分钟，0=关闭）
 *   - 'ui-theme' / 'plotmesh-pan-button' 等其它偏好（在 Canvas 组件管理）
 *
 * 重要约束：
 *   - group 节点必须排在它的 children 之前（React Flow v12 要求）
 *   - 节点的 data 字段不能塞 Date / 函数 等非 JSON 值（会破坏导出/草稿）
 *   - 任何会改变 nodes/edges 的 setter 应当在动作前先 pushHistory()
 */
import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import type { CustomNodeData, NodePackage, PackageGroup } from '../types/nodes';
import { inferExposedPorts } from '../utils/composite';
import { SAMPLE_PACKAGES, SAMPLE_GROUPS } from '../data/presets';

export type CustomNode = Node<CustomNodeData>;
export type CustomEdge = Edge;

/** 撤销/重做栈中的一帧快照（仅画布数据，不含包/历史本身） */
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
const PRESETS_INJECTED_KEY = 'node-editor-presets-injected';
const CANVAS_KEY = 'plotmesh-canvas-draft'; // 画布的"工作中草稿"，用于下次打开继续编辑
const MAX_HISTORY = 50;

/**
 * 把画布持久化到 localStorage。剥掉运行时状态，避免下次打开时显示过期的输出。
 */
export function saveCanvasDraft(nodes: any[], edges: any[]) {
  try {
    const cleanNodes = nodes.map((n) => {
      if (!n.data) return n;
      const cleanedData: any = { ...n.data };
      // 这些字段是运行时产物，不该在重启后保留
      if ('output' in cleanedData) cleanedData.output = '';
      if ('streamOutput' in cleanedData) cleanedData.streamOutput = '';
      if ('error' in cleanedData) cleanedData.error = undefined;
      cleanedData.status = 'idle';
      return { ...n, data: cleanedData };
    });
    localStorage.setItem(
      CANVAS_KEY,
      JSON.stringify({ version: 1, savedAt: Date.now(), nodes: cleanNodes, edges })
    );
  } catch (e) {
    // localStorage 可能写满或被禁用——尽力而为，不抛错
    console.warn('画布草稿保存失败：', e);
  }
}

export function loadCanvasDraft(): { nodes: any[]; edges: any[] } | null {
  try {
    const raw = localStorage.getItem(CANVAS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.nodes)) return null;
    return { nodes: data.nodes, edges: Array.isArray(data.edges) ? data.edges : [] };
  } catch {
    return null;
  }
}

export function clearCanvasDraft() {
  try { localStorage.removeItem(CANVAS_KEY); } catch {}
}

// ─────── 最近画布列表 ───────
const RECENT_CANVASES_KEY = 'plotmesh-recent-canvases';
const RECENT_CANVASES_MAX = 8;

export type RecentCanvas = {
  id: string;
  name: string;
  savedAt: number;
  nodes: any[];
  edges: any[];
};

export function listRecentCanvases(): RecentCanvas[] {
  try {
    const raw = localStorage.getItem(RECENT_CANVASES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function pushRecentCanvas(name: string, nodes: any[], edges: any[]) {
  // 保存的快照剥掉运行时状态，与 saveCanvasDraft 行为一致
  const cleanNodes = nodes.map((n) => {
    if (!n.data) return n;
    const cleanedData: any = { ...n.data };
    if ('output' in cleanedData) cleanedData.output = '';
    if ('streamOutput' in cleanedData) cleanedData.streamOutput = '';
    if ('error' in cleanedData) cleanedData.error = undefined;
    cleanedData.status = 'idle';
    return { ...n, data: cleanedData };
  });
  const item: RecentCanvas = {
    id: `recent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `画布 ${new Date().toLocaleString('zh-CN')}`,
    savedAt: Date.now(),
    nodes: cleanNodes,
    edges,
  };
  const list = [item, ...listRecentCanvases()].slice(0, RECENT_CANVASES_MAX);
  try {
    localStorage.setItem(RECENT_CANVASES_KEY, JSON.stringify(list));
  } catch (e) {
    // 容量不够时去掉最老的几条再尝试
    try {
      localStorage.setItem(RECENT_CANVASES_KEY, JSON.stringify(list.slice(0, 4)));
    } catch {}
  }
}

export function deleteRecentCanvas(id: string) {
  const next = listRecentCanvases().filter((r) => r.id !== id);
  try { localStorage.setItem(RECENT_CANVASES_KEY, JSON.stringify(next)); } catch {}
}

/**
 * 首次打开 PlotMesh 时往 localStorage 里注入预制示例。
 * 用 PRESETS_INJECTED_KEY 标记，注入过一次就不会再覆盖用户数据。
 * 用户即使把示例都删了，下次启动也不会"复活"——这是有意为之，避免烦人。
 */
function ensurePresetsInjected(): { packages: NodePackage[]; groups: PackageGroup[] } {
  const alreadyInjected = localStorage.getItem(PRESETS_INJECTED_KEY) === '1';
  let packages: NodePackage[] = [];
  let groups: PackageGroup[] = [];
  try {
    const p = localStorage.getItem(STORAGE_KEY);
    if (p) packages = JSON.parse(p);
  } catch {}
  try {
    const g = localStorage.getItem(GROUPS_KEY);
    if (g) groups = JSON.parse(g);
  } catch {}

  if (!alreadyInjected) {
    // 仅当用户未注入过且原本两个都为空时才注入，避免误覆盖
    if (packages.length === 0 && groups.length === 0) {
      packages = [...SAMPLE_PACKAGES];
      groups = [...SAMPLE_GROUPS];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(packages));
      localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    }
    localStorage.setItem(PRESETS_INJECTED_KEY, '1');
  }
  return { packages, groups };
}

function loadPackages(): NodePackage[] {
  ensurePresetsInjected();
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

export const useNodeStore = create<NodeStore>((set, get) => {
  // 启动时尝试从 localStorage 读出上次未完成的画布
  const draft = loadCanvasDraft();
  return {
  nodes: draft?.nodes || [],
  edges: draft?.edges || [],
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

    // 递归收集：把"被选中节点 + 其所有后代节点（含嵌套 group）"全部纳入
    // 关键改进：保留 group 节点本身，从而支持多层 group 的打包/还原。
    const expandedIds = new Set<string>(nodeIds);
    const collectDescendants = (parentId: string) => {
      nodes.forEach((c: any) => {
        if (c.parentId === parentId && !expandedIds.has(c.id)) {
          expandedIds.add(c.id);
          if (c.type === 'group') collectDescendants(c.id);
        }
      });
    };
    nodeIds.forEach((id) => {
      const n = nodes.find((x: any) => x.id === id);
      if (n && n.type === 'group') collectDescendants(id);
    });

    // 全部节点（含嵌套 group）；外层 savePackage 包装时还会再裹一层新 group
    const pkgNodesAll = nodes.filter((n: any) => expandedIds.has(n.id));
    // 仅"叶子节点"用于推断对外端口、估算包围盒
    const pkgLeafNodes = pkgNodesAll.filter((n: any) => n.type !== 'group');
    if (pkgLeafNodes.length === 0) {
      return { ok: false, action: 'created', message: '没有可保存的节点' };
    }

    const pkgEdges = edges.filter(
      (e) => pkgNodesAll.some((n: any) => n.id === e.source) && pkgNodesAll.some((n: any) => n.id === e.target)
    );

    // 计算节点的绝对坐标（考虑父 group 的偏移链）
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

    // 顶层节点（在选中集合中、parent 不在集合中的节点）作为坐标归一化基准
    // 叶子坐标基准只看叶子最左上的绝对坐标
    let minXAbs = Infinity, minYAbs = Infinity;
    pkgLeafNodes.forEach((n: any) => {
      const abs = getAbsPos(n);
      minXAbs = Math.min(minXAbs, abs.x);
      minYAbs = Math.min(minYAbs, abs.y);
    });

    // 序列化保存：
    //  - 顶层节点（parent 不在 expandedIds 内）转绝对坐标，剥离 parentId/extent
    //  - 嵌套节点（parent 在 expandedIds 内）保留 parentId/extent + 原相对坐标
    //  - 嵌套 group 节点：用其后代叶子 + 内部边重新推断 exposedPorts（保证加载后折叠态端口正确）
    const collectAllDescendants = (gid: string): any[] => {
      const result: any[] = [];
      const stack = [gid];
      while (stack.length) {
        const cur = stack.pop()!;
        nodes.forEach((c: any) => {
          if (c.parentId === cur) {
            result.push(c);
            if (c.type === 'group') stack.push(c.id);
          }
        });
      }
      return result;
    };
    const pkgNodesNormalized = pkgNodesAll.map((n: any) => {
      // 嵌套 group：补 exposedPorts
      let nWithPorts = n;
      if (n.type === 'group') {
        const descendants = collectAllDescendants(n.id);
        const innerLeaves = descendants.filter((c) => c.type !== 'group');
        const innerEdges = edges.filter(
          (e) => descendants.some((c) => c.id === e.source) && descendants.some((c) => c.id === e.target)
        );
        nWithPorts = {
          ...n,
          data: {
            ...n.data,
            exposedPorts: inferExposedPorts(innerLeaves, innerEdges),
            childCount: innerLeaves.length,
          },
        };
      }

      const isTopLevel = !nWithPorts.parentId || !expandedIds.has(nWithPorts.parentId);
      if (isTopLevel) {
        const abs = getAbsPos(nWithPorts);
        const { parentId, extent, ...rest } = nWithPorts;
        return {
          ...rest,
          position: { x: abs.x - minXAbs, y: abs.y - minYAbs },
          selected: false,
        };
      }
      // 嵌套：保留原 parentId/extent 与相对位置；落地后由 loadPackage 重新映射 id
      return {
        ...nWithPorts,
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

    // 检测"顶层只有 1 个 group"的特殊情况：用户选中的就是一个完整 group
    // → 不再额外包一层 wrapper，直接给原 group 写上 packageId 标记，保留它在画布上的原状
    const topLevelSelected = nodeIds
      .map((id) => nodes.find((n: any) => n.id === id))
      .filter((n: any) => n);
    const isSingleGroupSelected =
      topLevelSelected.length === 1 && topLevelSelected[0].type === 'group';

    if (isSingleGroupSelected) {
      const orig = topLevelSelected[0];
      // 仅更新原 group 的 data（绑定 packageId + 同步 exposedPorts/childCount），其它节点不动
      const updatedNodes = nodes.map((n: any) => {
        if (n.id === orig.id) {
          return {
            ...n,
            data: {
              ...n.data,
              label: pkg.name || n.data?.label || '功能组',
              packageId: pkg.id,
              exposedPorts: inferExposedPorts(pkgLeafNodes, pkgEdges),
              childCount: pkgLeafNodes.length,
            },
            selected: false,
          };
        }
        return n;
      });
      set({ nodes: updatedNodes, packages });
      return { ok: true, action, pkgId: pkg.id };
    }

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
    // 用叶子节点计算包围盒（叶子有固定的默认尺寸；嵌套 group 的范围由其子节点决定）
    pkgLeafNodes.forEach((n: any) => {
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
        // 端口推断只看叶子节点（嵌套 group 内部边都算"内部"，所以推断仍正确）
        exposedPorts: inferExposedPorts(pkgLeafNodes, pkgEdges),
        childCount: pkgLeafNodes.length,
      },
      zIndex: -1,
      selectable: true,
      draggable: true,
    };

    // 把所有节点（含嵌套 group 与叶子）一并迁入新外层 group：
    //   - 顶层节点（parent 不在 expandedIds 内）→ 重新挂到 groupId，坐标转为相对新 group
    //   - 嵌套节点（parent 在 expandedIds 内）→ 维持原 parentId 与相对位置
    // 要从画布移除：所有原始 nodeIds（含原 group） + 自动展开的后代
    const removeIdSet = new Set<string>([...nodeIds, ...expandedIds]);
    const others = nodes.filter((n: any) => !removeIdSet.has(n.id));
    const newChildren = pkgNodesAll.map((n: any) => {
      const isTopLevel = !n.parentId || !expandedIds.has(n.parentId);
      if (isTopLevel) {
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
      }
      // 嵌套：parentId 仍指向原内部 group（同样在 newChildren 里），位置保持相对父级
      return { ...n, selected: false };
    });

    // group 节点必须在它所有子节点之前（React Flow 要求）。
    // 我们这里有一个外层新 group + 若干嵌套老 group + 叶子，
    // 必须按"父在前"的拓扑顺序输出。
    const ordered: any[] = [groupNode];
    const idToNode = new Map<string, any>();
    newChildren.forEach((n) => idToNode.set(n.id, n));
    const placed = new Set<string>([groupId]);
    // 反复扫描直到所有节点入列：parent 已 placed 才能 place
    let safety = newChildren.length + 10;
    let remaining = [...newChildren];
    while (remaining.length && safety-- > 0) {
      const next: any[] = [];
      remaining.forEach((n) => {
        if (placed.has(n.parentId)) {
          ordered.push(n);
          placed.add(n.id);
        } else {
          next.push(n);
        }
      });
      if (next.length === remaining.length) {
        // 出现孤儿（parent 不在集合内）—— 直接接到外层 group
        next.forEach((n) => {
          ordered.push({ ...n, parentId: groupId });
          placed.add(n.id);
        });
        remaining = [];
        break;
      }
      remaining = next;
    }

    set({
      nodes: [...others, ...ordered],
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
   * 折叠时：把内部子节点 hidden=true，width/height 收缩到单节点尺寸；
   *         同时把所有嵌套子 group 也设为 collapsed=true（递归折叠到底）。
   * 展开时：恢复 hidden=false 和原 width/height（嵌套子 group 保持各自状态）。
   */
  toggleGroupCollapsed: (groupId: string) => {
    const nodes = get().nodes as any[];
    const group = nodes.find((n) => n.id === groupId && n.type === 'group');
    if (!group) return;
    const collapsed = !group.data?.collapsed;

    // 收集所有后代（递归）
    const descendantIds = new Set<string>();
    const stack = [groupId];
    while (stack.length) {
      const cur = stack.pop()!;
      nodes.forEach((c: any) => {
        if (c.parentId === cur && !descendantIds.has(c.id)) {
          descendantIds.add(c.id);
          if (c.type === 'group') stack.push(c.id);
        }
      });
    }

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

      // 后代节点处理
      if (descendantIds.has(n.id)) {
        if (collapsed) {
          // 折叠：所有后代隐藏；嵌套 group 也强制折叠（保存其展开尺寸方便后续恢复）
          if (n.type === 'group') {
            const prevW = n.style?.width || n.width || 240;
            const prevH = n.style?.height || n.height || 160;
            const innerH = Math.max(
              90,
              ((n.data?.exposedPorts?.length || 1) * 16) + 70
            );
            return {
              ...n,
              hidden: true,
              width: COLLAPSED_W,
              height: innerH,
              style: { ...(n.style || {}), width: COLLAPSED_W, height: innerH },
              data: {
                ...n.data,
                collapsed: true,
                // 只在第一次折叠时保存原尺寸；如果已经有 expandedSize 就不动
                expandedSize: n.data?.expandedSize || { w: prevW, h: prevH },
              },
            };
          }
          return { ...n, hidden: true };
        } else {
          // 展开：只放出"直接子节点"（取消 hidden）；嵌套 group 保持各自折叠状态，
          // 它们里面的孙节点是否可见由它们自己的 collapsed 决定。
          if (n.parentId === groupId) {
            return { ...n, hidden: false };
          }
          // 间接后代：根据其父 group 是否折叠决定
          // 找其父 group
          const parent = nodes.find((p: any) => p.id === n.parentId);
          if (parent && parent.type === 'group' && parent.data?.collapsed) {
            return { ...n, hidden: true };
          }
          return { ...n, hidden: false };
        }
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

    // 1) 给所有节点（含嵌套 group）生成新 id
    const idMap = new Map<string, string>();
    const suffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const allPkgNodes = (pkg.nodes || []).map((n: any, i: number) => {
      const newId = `${n.type}-${suffix}-${i}`;
      idMap.set(n.id, newId);
      return { ...n, id: newId, selected: false };
    });

    // 2) parentId 也要映射到新 id（嵌套 group 的关键）
    //    嵌套 group 的 exposedPorts.childNodeId 也要映射，否则折叠态找不到对应子节点
    const remappedPkgNodes = allPkgNodes.map((n: any) => {
      let nMapped = n;
      if (n.type === 'group' && Array.isArray(n.data?.exposedPorts)) {
        nMapped = {
          ...n,
          data: {
            ...n.data,
            exposedPorts: n.data.exposedPorts.map((p: any) => ({
              ...p,
              childNodeId: idMap.get(p.childNodeId) || p.childNodeId,
            })),
          },
        };
      }
      if (nMapped.parentId && idMap.has(nMapped.parentId)) {
        return { ...nMapped, parentId: idMap.get(nMapped.parentId), extent: 'parent' as const };
      }
      // 没 parent 或 parent 不在包内 → 视为顶层
      const { parentId, extent, ...rest } = nMapped;
      return rest;
    });

    const newEdges = (pkg.edges || []).map((e: any, i: number) => ({
      ...e,
      id: `edge-${suffix}-${i}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
    }));

    // 3) 顶层节点 = 没有 parentId 的；只有顶层节点的坐标参与外层包围盒计算
    const topLevel = remappedPkgNodes.filter((n: any) => !n.parentId);
    const leafTopLevel = topLevel.filter((n: any) => n.type !== 'group');

    // 估算尺寸：叶子节点用预设；嵌套 group 节点用自身保存的 width/height
    const sizeOf = (n: any): { w: number; h: number } => {
      if (n.type === 'group') {
        return {
          w: n.style?.width || n.width || 240,
          h: n.style?.height || n.height || 160,
        };
      }
      return nodeSizes[n.type] || { w: 200, h: 130 };
    };

    const padding = 40;
    const headerPad = 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // 把"叶子顶层 + 嵌套 group 顶层"都纳入包围盒
    topLevel.forEach((n: any) => {
      const sz = sizeOf(n);
      const x = (n.position?.x || 0) + offsetX;
      const y = (n.position?.y || 0) + offsetY;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + sz.w);
      maxY = Math.max(maxY, y + sz.h);
    });
    if (!Number.isFinite(minX)) {
      // 包内连一个节点都没有 —— 异常路径，直接跳过
      return;
    }

    const groupId = `group-${suffix}-loaded`;
    const groupPosition = { x: minX - padding, y: minY - padding - headerPad };
    const groupWidth = Math.max(240, (maxX - minX) + padding * 2);
    const groupHeight = Math.max(140, (maxY - minY) + padding * 2 + headerPad);

    // 4) 推断对外端口：只看叶子节点（深层 group 内的边都视为内部边）
    const leafForPorts = remappedPkgNodes.filter((n: any) => n.type !== 'group');
    const exposed = inferExposedPorts(leafForPorts, newEdges);
    const collapsedH = Math.max(90, ((exposed.length || 1) * 16) + 70);

    const groupNode: any = {
      id: groupId,
      type: 'group',
      position: groupPosition,
      style: { width: 200, height: collapsedH },
      width: 200,
      height: collapsedH,
      data: {
        type: 'group',
        label: pkg.name || '功能组',
        packageId: pkg.id,
        collapsed: true,            // 拖出时默认折叠
        exposedPorts: exposed,
        childCount: leafForPorts.length,
        expandedSize: { w: groupWidth, h: groupHeight }, // 双击展开后还原此尺寸
      },
      zIndex: -1,
      selectable: true,
      draggable: true,
    };

    // 5) 顶层节点 → 重新挂到外层 groupId（坐标 + offset 后转为相对外层 group 的坐标）；
    //    嵌套节点 → 保留 parentId 与原相对位置即可。
    //    所有子节点折叠态默认 hidden=true。
    //    嵌套的 group 节点也强制 collapsed=true（折叠为黑盒），让用户看到的是层层包装的盒子，
    //    与单层 group 的折叠语义保持一致。
    const newChildrenMapped = remappedPkgNodes.map((n: any) => {
      const isInnerGroup = n.type === 'group';
      const baseData = isInnerGroup
        ? {
            ...n.data,
            collapsed: true,
            // 端口推断：只对该 group 内部直接子节点（一层）做推断 —— 这里简单沿用已保存的 exposedPorts
            // 若包内未保存 exposedPorts，留空，由用户后续展开时再操作
            expandedSize: n.data?.expandedSize || { w: n.style?.width || 240, h: n.style?.height || 160 },
          }
        : n.data;
      // 嵌套 group 折叠态尺寸用统一的 200×collapsedH 风格
      const innerCollapsedH = isInnerGroup
        ? Math.max(90, ((n.data?.exposedPorts?.length || 1) * 16) + 70)
        : null;

      if (!n.parentId) {
        const out: any = {
          ...n,
          parentId: groupId,
          extent: 'parent' as const,
          hidden: true,
          position: {
            x: (n.position?.x || 0) + offsetX - groupPosition.x,
            y: (n.position?.y || 0) + offsetY - groupPosition.y,
          },
          data: baseData,
        };
        if (isInnerGroup) {
          out.width = 200;
          out.height = innerCollapsedH;
          out.style = { ...(n.style || {}), width: 200, height: innerCollapsedH };
        }
        return out;
      }
      // 嵌套节点：跟随父级折叠隐藏；嵌套 group 也变为折叠态
      const out: any = { ...n, hidden: true, data: baseData };
      if (isInnerGroup) {
        out.width = 200;
        out.height = innerCollapsedH;
        out.style = { ...(n.style || {}), width: 200, height: innerCollapsedH };
      }
      return out;
    });

    // 6) 按 "父在前" 拓扑顺序输出（React Flow 要求）
    const ordered: any[] = [groupNode];
    const placed = new Set<string>([groupId]);
    let remaining = [...newChildrenMapped];
    let safety = newChildrenMapped.length + 10;
    while (remaining.length && safety-- > 0) {
      const next: any[] = [];
      remaining.forEach((n) => {
        if (placed.has(n.parentId)) {
          ordered.push(n);
          placed.add(n.id);
        } else {
          next.push(n);
        }
      });
      if (next.length === remaining.length) {
        // 孤儿兜底
        next.forEach((n) => {
          ordered.push({ ...n, parentId: groupId });
          placed.add(n.id);
        });
        break;
      }
      remaining = next;
    }

    set({
      nodes: [...existingNodes, ...ordered],
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
    clearCanvasDraft();
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
};
});

// 开发期调试用：暴露 store 到 window
if (typeof window !== 'undefined') {
  (window as any).__nodeStore = useNodeStore;
}
