/**
 * store/nodes.ts · 全局工作流状态（zustand）· v1.5 D2 IDB 版
 * ---------------------------------------------------------------
 * 单一真相源。负责：
 *
 *   1. nodes / edges          — 当前画布数据（与 React Flow 双向绑定）
 *   2. packages / groups       — 用户保存的"常用功能"和它们的分组
 *   3. recentCanvases          — 最近 8 张画布（store 内维护）
 *   4. activeCanvasId          — 当前活动画布 id（用于 IDB 写盘）
 *   5. hydrated                — 是否已从 IDB 加载完成（启动 gate 用）
 *   6. history / future        — 撤销 / 重做栈（最多 MAX_HISTORY 条）
 *
 * 持久化策略（v1.5 D2 起）：
 *   - 主存：IndexedDB（store/db.ts + store/storage.ts）
 *   - 兜底：LS key 'plotmesh-pending-flush' —— beforeunload 同步写最近一笔，
 *           启动 hydrate 时回填到 IDB 后删除（防异步写盘丢数据，方案 A）
 *   - UI 偏好（ui-theme / plotmesh-pan-button / plotmesh-autosave-min）
 *     仍保留在 LS（在 Canvas 组件管理），不走 IDB
 *
 * 启动顺序（App.tsx）：
 *   await migrateFromLocalStorageIfNeeded()  // D1 一次性迁移
 *   await hydrateNodeStore()                 // 从 IDB 灌进 store
 *   render <Canvas/>
 *
 * 重要约束：
 *   - group 节点必须排在它的 children 之前（React Flow v12 要求）
 *   - 节点的 data 字段不能塞 Date / 函数 等非 JSON 值
 *   - 任何会改变 nodes/edges 的 setter 应当在动作前先 pushHistory()
 */
import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import type { CustomNodeData, NodePackage, PackageGroup } from '../types/nodes';
import { inferExposedPorts } from '../utils/composite';
import { SAMPLE_PACKAGES, SAMPLE_GROUPS } from '../data/presets';
import {
  getMeta,
  setMeta,
  getCanvas,
  putCanvas,
  deleteCanvas,
  listCanvases,
  listRecentCanvases as listRecentCanvasesIDB,
  listPackages,
  listPackageGroups,
  replaceAllPackages,
  replaceAllPackageGroups,
} from './storage';
import {
  META_KEYS,
  type Canvas as CanvasRecord,
  type PackageRecord,
  type PackageGroupRecord,
} from '../types/db';

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

  /** 最近画布快照（store 内维护，写盘交给 IDB） */
  recentCanvases: RecentCanvas[];
  /** 当前活动画布 id（决定写到 IDB 的哪条 canvases 记录） */
  activeCanvasId: string | null;
  /** 当前活动画布名称（顶栏 Tab Bar 显示用；与 IDB 中那条 Canvas.name 同步） */
  activeCanvasName: string;
  /** 是否已从 IDB hydrate 完成；false 时 UI 应显示 loading */
  hydrated: boolean;

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

  // 多画布管理（v1.5 D3 起）
  /** 切换 active 画布：先 flush 当前，再从 IDB 灌新画布到 store；同时清空 history。 */
  switchActiveCanvas: (canvasId: string) => Promise<void>;
  /** 创建一张新空白画布并切过去；返回新 canvasId。 */
  createNewCanvas: (name?: string) => Promise<string>;
  /** 重命名当前 active 画布。 */
  renameActiveCanvas: (newName: string) => Promise<void>;
  /** 重命名指定画布。 */
  renameCanvasById: (canvasId: string, newName: string) => Promise<void>;
  /** 删除某张画布；如果删的是 active，自动切到剩下的最近一张（或新建空白）。 */
  deleteCanvasById: (canvasId: string) => Promise<void>;
  /** 刷新 store.recentCanvases（从 IDB 读最新 8 条，排除当前 active）。 */
  refreshRecentCanvases: () => Promise<void>;
}

const MAX_HISTORY = 50;
const RECENT_CANVASES_MAX = 8;
const DEFAULT_WORKSPACE_ID = 'workspace-default';
const DEFAULT_PROJECT_ID = 'project-default';

/** 兜底 LS key（方案 A）：beforeunload 同步写最近一笔，启动 hydrate 时回填到 IDB */
const PENDING_FLUSH_KEY = 'plotmesh-pending-flush';

export type RecentCanvas = {
  id: string;
  name: string;
  savedAt: number;
  nodes: any[];
  edges: any[];
};

/** 把当前画布节点的运行时输出剥掉，避免重启后看到旧输出 */
function stripRuntimeFields(nodes: any[]): any[] {
  return nodes.map((n) => {
    if (!n.data) return n;
    const cleanedData: any = { ...n.data };
    if ('output' in cleanedData) cleanedData.output = '';
    if ('streamOutput' in cleanedData) cleanedData.streamOutput = '';
    if ('error' in cleanedData) cleanedData.error = undefined;
    cleanedData.status = 'idle';
    return { ...n, data: cleanedData };
  });
}

/** 写"待 flush"兜底：同步 LS 写一份，启动时回填 IDB 后会被清掉 */
function writePendingFlush(canvasId: string, nodes: any[], edges: any[]) {
  try {
    localStorage.setItem(
      PENDING_FLUSH_KEY,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        canvasId,
        nodes,
        edges,
      })
    );
  } catch {
    /* LS 满了就放弃，不挡主流程 */
  }
}

function readPendingFlush(): {
  canvasId: string;
  nodes: any[];
  edges: any[];
  savedAt: number;
} | null {
  try {
    const raw = localStorage.getItem(PENDING_FLUSH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.canvasId !== 'string' || !Array.isArray(data.nodes)) return null;
    return {
      canvasId: data.canvasId,
      nodes: data.nodes,
      edges: Array.isArray(data.edges) ? data.edges : [],
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function clearPendingFlush() {
  try {
    localStorage.removeItem(PENDING_FLUSH_KEY);
  } catch {}
}

/** 往 IDB 写当前活动画布（fire-and-forget；失败只 console.warn） */
function flushActiveCanvasToIDB(
  canvasId: string,
  nodes: any[],
  edges: any[],
  name?: string
) {
  // 先写兜底，再异步写 IDB；这样即使 IDB 还没写完关页面也不丢
  const cleanNodes = stripRuntimeFields(nodes);
  writePendingFlush(canvasId, cleanNodes, edges);
  void (async () => {
    try {
      const existing = await getCanvas(canvasId);
      const now = Date.now();
      const rec: CanvasRecord = {
        id: canvasId,
        workspaceId: existing?.workspaceId || DEFAULT_WORKSPACE_ID,
        projectId: existing?.projectId || DEFAULT_PROJECT_ID,
        name: name ?? existing?.name ?? '未命名画布',
        nodes: cleanNodes,
        edges,
        viewport: existing?.viewport,
        thumbnail: existing?.thumbnail,
        lastOpenedAt: existing?.lastOpenedAt ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await putCanvas(rec);
      // 写成功了才清 pending
      clearPendingFlush();
    } catch (e) {
      console.warn('[plotmesh] 画布草稿写 IDB 失败：', e);
    }
  })();
}

/** RecentCanvas 在 IDB 中即一条 Canvas 记录（用 lastOpenedAt 排序） */
function recordToRecent(c: CanvasRecord): RecentCanvas {
  return {
    id: c.id,
    name: c.name,
    savedAt: c.lastOpenedAt ?? c.updatedAt,
    nodes: Array.isArray(c.nodes) ? (c.nodes as any[]) : [],
    edges: Array.isArray(c.edges) ? (c.edges as any[]) : [],
  };
}

/** PackageRecord ↔ NodePackage 适配（payload 里包着完整老 schema） */
function packageRecordToNodePackage(r: PackageRecord): NodePackage | null {
  const p = (r.payload || {}) as Partial<NodePackage> & Record<string, unknown>;
  if (!p || !Array.isArray(p.nodes)) return null;
  return {
    id: r.id,
    name: r.name,
    description: typeof p.description === 'string' ? p.description : '',
    group: typeof p.group === 'string' ? p.group : '',
    nodes: p.nodes as any[],
    edges: Array.isArray(p.edges) ? (p.edges as any[]) : [],
    createdAt:
      typeof p.createdAt === 'string'
        ? p.createdAt
        : new Date(r.createdAt).toISOString(),
    updatedAt:
      typeof p.updatedAt === 'string'
        ? p.updatedAt
        : new Date(r.updatedAt).toISOString(),
  };
}

function nodePackageToRecord(pkg: NodePackage): PackageRecord {
  return {
    id: pkg.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    groupId: pkg.group || null,
    name: pkg.name,
    payload: pkg,
    createdAt: Date.parse(pkg.createdAt) || Date.now(),
    updatedAt: Date.parse(pkg.updatedAt) || Date.now(),
  };
}

function packageGroupToRecord(g: PackageGroup): PackageGroupRecord {
  return {
    id: g.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    name: g.name,
    collapsed: g.collapsed,
    createdAt: Date.parse(g.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function packageGroupRecordToNodeGroup(r: PackageGroupRecord): PackageGroup {
  return {
    id: r.id,
    name: r.name,
    collapsed: !!r.collapsed,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

/**
 * 把画布持久化（D2 起走 IDB；旧函数签名保留，Canvas 组件不用改）
 *
 * 实际逻辑：
 *   1. 写一份兜底到 LS（防异步写 IDB 没完成就刷新）
 *   2. fire-and-forget 写 IDB；写成功后清兜底
 *
 * 注意：必须先有一个 activeCanvasId；否则就当 'canvas-active-default' 处理。
 */
export function saveCanvasDraft(nodes: any[], edges: any[]) {
  try {
    const state = useNodeStore.getState();
    const canvasId = state.activeCanvasId || 'canvas-active-default';
    flushActiveCanvasToIDB(canvasId, nodes, edges);
  } catch (e) {
    console.warn('画布草稿保存失败：', e);
  }
}

/**
 * 老接口保留（仅供测试 / 历史代码）。生产代码直接用 store.activeCanvasId 做 hydrate。
 * 这里返回 null —— D2 起 hydrate 在 hydrateNodeStore() 中完成，不再走这个口。
 */
export function loadCanvasDraft(): { nodes: any[]; edges: any[] } | null {
  return null;
}

export function clearCanvasDraft() {
  // 清兜底 + 删 IDB 中活动画布
  clearPendingFlush();
  const state = useNodeStore.getState();
  if (state.activeCanvasId) {
    void deleteCanvas(state.activeCanvasId).catch(() => {});
  }
}

/**
 * @deprecated 改为 store.recentCanvases。保留同名导出供老代码不用改导入。
 *             启动后请用 useNodeStore((s) => s.recentCanvases) 读。
 *             同步调用时返回 store 中已 hydrate 的数据。
 */
export function listRecentCanvases(): RecentCanvas[] {
  return useNodeStore.getState().recentCanvases;
}

/** 推一份"最近画布快照"。落 IDB 时是新增一条 Canvas 记录。 */
export function pushRecentCanvas(name: string, nodes: any[], edges: any[]) {
  const cleanNodes = stripRuntimeFields(nodes);
  const id = `recent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const item: RecentCanvas = {
    id,
    name: name || `画布 ${new Date().toLocaleString('zh-CN')}`,
    savedAt: Date.now(),
    nodes: cleanNodes,
    edges,
  };
  const list = [item, ...useNodeStore.getState().recentCanvases].slice(
    0,
    RECENT_CANVASES_MAX
  );
  useNodeStore.setState({ recentCanvases: list });

  // fire-and-forget 写 IDB
  void (async () => {
    try {
      const now = Date.now();
      const rec: CanvasRecord = {
        id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        projectId: DEFAULT_PROJECT_ID,
        name: item.name,
        nodes: cleanNodes,
        edges,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await putCanvas(rec);
      // 超过上限的旧 recent 删掉，避免 IDB 越来越大
      const all = await listRecentCanvasesIDB(64);
      const recentIds = new Set(
        all
          .filter((c) => c.id.startsWith('recent-'))
          .slice(0, RECENT_CANVASES_MAX)
          .map((c) => c.id)
      );
      for (const c of all) {
        if (c.id.startsWith('recent-') && !recentIds.has(c.id)) {
          await deleteCanvas(c.id).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[plotmesh] pushRecentCanvas 写 IDB 失败：', e);
    }
  })();
}

export function deleteRecentCanvas(id: string) {
  const next = useNodeStore.getState().recentCanvases.filter((r) => r.id !== id);
  useNodeStore.setState({ recentCanvases: next });
  void deleteCanvas(id).catch(() => {});
}

/**
 * 启动时调用：从 IDB hydrate 整个 store。
 * 必须在 migrateFromLocalStorageIfNeeded() 之后、render 之前 await。
 *
 * 步骤：
 *   1) 读 meta:active-canvas-id，没有就生成一个空白 active 画布 id
 *   2) 处理 LS 兜底 plotmesh-pending-flush —— 如果存在，比 IDB 中那条新就以兜底为准
 *   3) 读取 active 画布的 nodes/edges → store
 *   4) 读取所有 packages / packageGroups → store
 *   5) 读最近画布列表 → store.recentCanvases
 *   6) 注入预置（如果还没注过）
 *   7) hydrated = true
 */
export async function hydrateNodeStore(): Promise<void> {
  // 1) active canvas id
  let activeId = (await getMeta<string>(META_KEYS.ACTIVE_CANVAS_ID)) || null;
  if (!activeId) {
    activeId = `canvas-active-${Date.now().toString(36)}`;
    await setMeta(META_KEYS.ACTIVE_CANVAS_ID, activeId);
  }

  // 2) 兜底 pending-flush
  const pending = readPendingFlush();
  let nodes: any[] = [];
  let edges: any[] = [];
  let activeName = '未命名画布';
  let hydratedFromPending = false;

  if (pending && pending.canvasId === activeId) {
    // 兜底比 IDB 那条更可信（因为它是关页面前最后写的）
    nodes = pending.nodes;
    edges = pending.edges;
    hydratedFromPending = true;
    // 立刻把兜底的内容回写到 IDB 当前活动画布，然后清掉兜底
    try {
      const existing = await getCanvas(activeId);
      activeName = existing?.name || activeName;
      const now = Date.now();
      await putCanvas({
        id: activeId,
        workspaceId: existing?.workspaceId || DEFAULT_WORKSPACE_ID,
        projectId: existing?.projectId || DEFAULT_PROJECT_ID,
        name: existing?.name || '未命名画布',
        nodes,
        edges,
        viewport: existing?.viewport,
        thumbnail: existing?.thumbnail,
        lastOpenedAt: existing?.lastOpenedAt ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      clearPendingFlush();
    } catch (e) {
      console.warn('[plotmesh] hydrate: 回填 pending-flush 失败：', e);
    }
  } else {
    const c = await getCanvas(activeId);
    if (c) {
      nodes = Array.isArray(c.nodes) ? (c.nodes as any[]) : [];
      edges = Array.isArray(c.edges) ? (c.edges as any[]) : [];
      activeName = c.name || activeName;
    } else {
      // active id 在 IDB 中没有对应记录 —— 第一次启动或被清掉了，写一条空白进去
      const now = Date.now();
      await putCanvas({
        id: activeId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        projectId: DEFAULT_PROJECT_ID,
        name: activeName,
        nodes: [],
        edges: [],
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 4) packages / groups
  const pkgRecs = await listPackages(DEFAULT_WORKSPACE_ID);
  const grpRecs = await listPackageGroups(DEFAULT_WORKSPACE_ID);
  let packages: NodePackage[] = pkgRecs
    .map(packageRecordToNodePackage)
    .filter((p): p is NodePackage => !!p);
  let packageGroups: PackageGroup[] = grpRecs.map(packageGroupRecordToNodeGroup);

  // 6) 注入预置（仅当从未注入过且当前两个都为空时）
  const presetsInjected = await getMeta<boolean>(META_KEYS.PRESETS_INJECTED);
  if (!presetsInjected) {
    if (packages.length === 0 && packageGroups.length === 0) {
      packages = [...SAMPLE_PACKAGES];
      packageGroups = [...SAMPLE_GROUPS];
      await replaceAllPackages(
        DEFAULT_WORKSPACE_ID,
        packages.map(nodePackageToRecord)
      );
      await replaceAllPackageGroups(
        DEFAULT_WORKSPACE_ID,
        packageGroups.map(packageGroupToRecord)
      );
    }
    await setMeta(META_KEYS.PRESETS_INJECTED, true);
  }

  // 5) recent canvases —— 从 IDB by-lastOpenedAt 倒序取 RECENT_CANVASES_MAX 条，
  //    排除当前 active 那条
  let recentCanvases: RecentCanvas[] = [];
  try {
    const all = await listRecentCanvasesIDB(RECENT_CANVASES_MAX + 4);
    recentCanvases = all
      .filter((c) => c.id !== activeId)
      .slice(0, RECENT_CANVASES_MAX)
      .map(recordToRecent);
  } catch (e) {
    console.warn('[plotmesh] hydrate: 读最近画布失败：', e);
  }

  useNodeStore.setState({
    nodes,
    edges,
    packages,
    packageGroups,
    recentCanvases,
    activeCanvasId: activeId,
    activeCanvasName: activeName,
    hydrated: true,
  });

  if (hydratedFromPending) {
    console.info('[plotmesh] hydrate: 已从 pending-flush 兜底回填画布');
  }
}

/** 全量重写 packages 到 IDB（fire-and-forget；失败 console.warn） */
function persistPackages(packages: NodePackage[]) {
  const records = packages.map(nodePackageToRecord);
  void replaceAllPackages(DEFAULT_WORKSPACE_ID, records).catch((e) => {
    console.warn('[plotmesh] 写 packages 失败：', e);
  });
}

/** 全量重写 packageGroups 到 IDB（fire-and-forget） */
function persistPackageGroups(groups: PackageGroup[]) {
  const records = groups.map(packageGroupToRecord);
  void replaceAllPackageGroups(DEFAULT_WORKSPACE_ID, records).catch((e) => {
    console.warn('[plotmesh] 写 packageGroups 失败：', e);
  });
}

// 内部 alias，老代码沿用
const savePackages = persistPackages;
const savePackageGroups = persistPackageGroups;

export const useNodeStore = create<NodeStore>((set, get) => {
  return {
  // 启动时全部置空；真实数据由 hydrateNodeStore() 在 App 启动 gate 中灌入
  nodes: [],
  edges: [],
  packages: [],
  packageGroups: [],
  recentCanvases: [],
  activeCanvasId: null,
  activeCanvasName: '未命名画布',
  hydrated: false,
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

  // ─────── v1.5 D3 多画布管理 ───────

  switchActiveCanvas: async (canvasId: string) => {
    const cur = get();
    if (cur.activeCanvasId === canvasId) return;

    // 1) 同步 flush 当前画布到 IDB（强制 await，确保数据落定再切）
    if (cur.activeCanvasId) {
      try {
        const cleanNodes = stripRuntimeFields(cur.nodes);
        const existing = await getCanvas(cur.activeCanvasId);
        const now = Date.now();
        await putCanvas({
          id: cur.activeCanvasId,
          workspaceId: existing?.workspaceId || DEFAULT_WORKSPACE_ID,
          projectId: existing?.projectId || DEFAULT_PROJECT_ID,
          name: cur.activeCanvasName || existing?.name || '未命名画布',
          nodes: cleanNodes,
          edges: cur.edges,
          viewport: existing?.viewport,
          thumbnail: existing?.thumbnail,
          lastOpenedAt: existing?.lastOpenedAt ?? now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        clearPendingFlush();
      } catch (e) {
        console.warn('[plotmesh] switchActiveCanvas: flush 当前画布失败：', e);
      }
    }

    // 2) 灌入目标画布
    let target = await getCanvas(canvasId);
    const now = Date.now();
    if (!target) {
      target = {
        id: canvasId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        projectId: DEFAULT_PROJECT_ID,
        name: '未命名画布',
        nodes: [],
        edges: [],
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await putCanvas(target);
    } else {
      // 触碰 lastOpenedAt 让最近排序更新
      await putCanvas({ ...target, lastOpenedAt: now });
    }

    await setMeta(META_KEYS.ACTIVE_CANVAS_ID, canvasId);

    set({
      activeCanvasId: canvasId,
      activeCanvasName: target.name || '未命名画布',
      nodes: Array.isArray(target.nodes) ? (target.nodes as any[]) : [],
      edges: Array.isArray(target.edges) ? (target.edges as any[]) : [],
      // history 与画布绑定，切换时清空
      history: [],
      future: [],
    });

    await get().refreshRecentCanvases();
    setTimeout(() => get().updatePromptNumbers(), 0);
  },

  createNewCanvas: async (name?: string) => {
    const cur = get();
    // 先 flush 当前
    if (cur.activeCanvasId) {
      try {
        const cleanNodes = stripRuntimeFields(cur.nodes);
        const existing = await getCanvas(cur.activeCanvasId);
        const now = Date.now();
        await putCanvas({
          id: cur.activeCanvasId,
          workspaceId: existing?.workspaceId || DEFAULT_WORKSPACE_ID,
          projectId: existing?.projectId || DEFAULT_PROJECT_ID,
          name: cur.activeCanvasName || existing?.name || '未命名画布',
          nodes: cleanNodes,
          edges: cur.edges,
          viewport: existing?.viewport,
          thumbnail: existing?.thumbnail,
          lastOpenedAt: existing?.lastOpenedAt ?? now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        clearPendingFlush();
      } catch (e) {
        console.warn('[plotmesh] createNewCanvas: flush 失败：', e);
      }
    }

    const id = `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const finalName = (name || '').trim() || `画布 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    const now = Date.now();
    await putCanvas({
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: DEFAULT_PROJECT_ID,
      name: finalName,
      nodes: [],
      edges: [],
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await setMeta(META_KEYS.ACTIVE_CANVAS_ID, id);

    set({
      activeCanvasId: id,
      activeCanvasName: finalName,
      nodes: [],
      edges: [],
      history: [],
      future: [],
    });
    await get().refreshRecentCanvases();
    return id;
  },

  renameActiveCanvas: async (newName: string) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const cur = get();
    if (!cur.activeCanvasId) return;
    set({ activeCanvasName: trimmed });
    try {
      const existing = await getCanvas(cur.activeCanvasId);
      const now = Date.now();
      // 重命名时 store 才是 source of truth：用当前 store 的 nodes/edges 写盘，
      // 避免 IDB 中旧 nodes 把 store 里更新过的内容覆盖掉
      await putCanvas({
        id: cur.activeCanvasId,
        workspaceId: existing?.workspaceId || DEFAULT_WORKSPACE_ID,
        projectId: existing?.projectId || DEFAULT_PROJECT_ID,
        name: trimmed,
        nodes: stripRuntimeFields(cur.nodes),
        edges: cur.edges,
        viewport: existing?.viewport,
        thumbnail: existing?.thumbnail,
        lastOpenedAt: existing?.lastOpenedAt ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      clearPendingFlush();
    } catch (e) {
      console.warn('[plotmesh] renameActiveCanvas 写盘失败：', e);
    }
    await get().refreshRecentCanvases();
  },

  renameCanvasById: async (canvasId: string, newName: string) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const cur = get();
    if (cur.activeCanvasId === canvasId) {
      await get().renameActiveCanvas(trimmed);
      return;
    }
    try {
      const existing = await getCanvas(canvasId);
      if (!existing) return;
      const now = Date.now();
      await putCanvas({ ...existing, name: trimmed, updatedAt: now });
    } catch (e) {
      console.warn('[plotmesh] renameCanvasById 写盘失败：', e);
    }
    await get().refreshRecentCanvases();
  },

  deleteCanvasById: async (canvasId: string) => {
    const cur = get();
    const isActive = cur.activeCanvasId === canvasId;
    try {
      await deleteCanvas(canvasId);
    } catch (e) {
      console.warn('[plotmesh] deleteCanvasById 失败：', e);
    }
    if (isActive) {
      // 删的是当前 active —— 找一张候补的最近画布切过去；都没有就开张空白
      const all = await listCanvases({ workspaceId: DEFAULT_WORKSPACE_ID });
      const sorted = all
        .filter((c) => c.id !== canvasId)
        .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt));
      if (sorted.length > 0) {
        await get().switchActiveCanvas(sorted[0].id);
      } else {
        await get().createNewCanvas();
      }
    } else {
      // 不是 active，单独刷一下 recent 列表即可
      await get().refreshRecentCanvases();
    }
  },

  refreshRecentCanvases: async () => {
    try {
      const activeId = get().activeCanvasId;
      const all = await listRecentCanvasesIDB(RECENT_CANVASES_MAX + 4);
      const recents = all
        .filter((c) => c.id !== activeId)
        .slice(0, RECENT_CANVASES_MAX)
        .map(recordToRecent);
      set({ recentCanvases: recents });
    } catch (e) {
      console.warn('[plotmesh] refreshRecentCanvases 失败：', e);
    }
  },
};
});

// 开发期调试用：暴露 store 到 window
if (typeof window !== 'undefined') {
  (window as any).__nodeStore = useNodeStore;
}
