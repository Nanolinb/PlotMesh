/**
 * canvasFolders.ts · v1.7.x 画布文件夹（抽屉里的分组）
 * ---------------------------------------------------------------
 * 把相关联画布归到一个文件夹，UI 可设置主题色。
 *
 * 持久化策略：
 *   - 元数据放 IDB.META，**不改 Canvas 表 schema**，老画布无感知
 *   - 两个 meta key：
 *     1. `canvas-folders` → Folder[]（文件夹列表）
 *     2. `canvas-folder-map` → Record<canvasId, folderId>（画布到文件夹的映射）
 *
 * 优点：
 *   - 改动隔离，任何阶段都能拆掉文件夹回到老抽屉
 *   - 同步逻辑（CanvasManager / sync）不受影响
 *
 * 使用：
 *   const folders = await listFolders();
 *   const map = await loadFolderMap();
 *   await addFolder({ name: '产品组', color: '#6366f1' });
 *   await assignCanvasToFolder(canvasId, folderId);
 */

import { getMeta, setMeta } from '../store/storage';

export interface Folder {
  id: string;
  name: string;
  /** 主题色 hex（用于侧栏 chip + 边框 + 折叠 header 背景） */
  color: string;
  /** 排序权重（越小越靠前），默认按 createdAt */
  order?: number;
  /** 是否在 UI 中折叠 */
  collapsed?: boolean;
  /** 若存在，表示这是某项目自动建立的默认画布文件夹。 */
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

const FOLDERS_KEY = 'canvas-folders';
const FOLDER_MAP_KEY = 'canvas-folder-map';

/** 预设主题色（用户也能改成自定义 hex） */
export const FOLDER_PRESET_COLORS = [
  '#6366f1', // 靛紫
  '#10b981', // 绿
  '#f59e0b', // 橙
  '#ef4444', // 红
  '#06b6d4', // 青
  '#8b5cf6', // 紫
  '#ec4899', // 粉
  '#84cc16', // 黄绿
];

export async function listFolders(): Promise<Folder[]> {
  const arr = (await getMeta<Folder[]>(FOLDERS_KEY)) || [];
  return [...arr].sort(
    (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
  );
}

export async function saveFolders(folders: Folder[]): Promise<void> {
  await setMeta(FOLDERS_KEY, folders);
}

export async function loadFolderMap(): Promise<Record<string, string>> {
  const m = (await getMeta<Record<string, string>>(FOLDER_MAP_KEY)) || {};
  return { ...m };
}

export async function saveFolderMap(map: Record<string, string>): Promise<void> {
  await setMeta(FOLDER_MAP_KEY, map);
}

export async function addFolder(input: {
  name: string;
  color?: string;
  projectId?: string;
}): Promise<Folder> {
  const all = await listFolders();
  const now = Date.now();
  const folder: Folder = {
    id: `folder-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim() || '未命名文件夹',
    color: input.color || FOLDER_PRESET_COLORS[all.length % FOLDER_PRESET_COLORS.length],
    order: now,
    collapsed: false,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await saveFolders([...all, folder]);
  return folder;
}

/**
 * 为项目准备一个默认画布文件夹。一个 projectId 始终复用同一文件夹，
 * 因而后续在该项目内创建/归属的画布会自动出现在同一个 CanvasManager 分组中。
 */
export async function ensureProjectCanvasFolder(input: {
  projectId: string;
  name: string;
  color?: string;
}): Promise<Folder> {
  const all = await listFolders();
  const existing = all.find((folder) => folder.projectId === input.projectId);
  if (existing) return existing;
  return addFolder({
    name: input.name.trim() || '项目画布',
    color: input.color,
    projectId: input.projectId,
  });
}

export async function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, 'name' | 'color' | 'order' | 'collapsed'>>,
): Promise<Folder | null> {
  const all = await listFolders();
  const idx = all.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  const next: Folder = { ...all[idx], ...patch, updatedAt: Date.now() };
  const updated = [...all];
  updated[idx] = next;
  await saveFolders(updated);
  return next;
}

/**
 * 删除文件夹。其内所有画布会被移到"未分类"（从 map 中移除）。
 * 注意：**不删画布本身**，只解除归属。
 */
export async function removeFolder(id: string): Promise<void> {
  const all = await listFolders();
  await saveFolders(all.filter((f) => f.id !== id));
  // 清理 map 里所有 folderId === id 的条目
  const map = await loadFolderMap();
  let dirty = false;
  for (const [cid, fid] of Object.entries(map)) {
    if (fid === id) {
      delete map[cid];
      dirty = true;
    }
  }
  if (dirty) await saveFolderMap(map);
}

/** 把一张画布归到文件夹（folderId=null/undefined = 移出文件夹） */
export async function assignCanvasToFolder(
  canvasId: string,
  folderId: string | null,
): Promise<void> {
  const map = await loadFolderMap();
  if (folderId) {
    map[canvasId] = folderId;
  } else {
    delete map[canvasId];
  }
  await saveFolderMap(map);
}

/** 一次性查多张画布的所属文件夹 */
export async function getFoldersByCanvasIds(
  canvasIds: string[],
): Promise<Record<string, string | null>> {
  const map = await loadFolderMap();
  const result: Record<string, string | null> = {};
  for (const cid of canvasIds) {
    result[cid] = map[cid] || null;
  }
  return result;
}
