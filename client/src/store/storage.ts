/**
 * 统一数据访问层（v1.5 数据底座）
 *
 * 上层（nodes.ts / 画布管理器 / 包面板）只调用本文件，不直接读 IDB。
 *
 * 提供：
 * - workspace / project / canvas / package / packageGroup 的 CRUD
 * - meta KV 读写
 * - 列表查询（按 workspace、按 project、按 lastOpenedAt 排序）
 *
 * 不在本层做的事：
 * - 迁移（migration.ts）
 * - 业务逻辑（节点合并/校验/默认值）
 */
import { getDB } from './db';
import {
  STORE,
  type Canvas,
  type Workspace,
  type Project,
  type PackageRecord,
  type PackageGroupRecord,
  type MetaRecord,
  type MetaKey,
} from '../types/db';

// ---------- Workspace ----------

export async function listWorkspaces(): Promise<Workspace[]> {
  const db = await getDB();
  return db.getAll(STORE.WORKSPACES);
}

export async function getWorkspace(id: string): Promise<Workspace | undefined> {
  const db = await getDB();
  return db.get(STORE.WORKSPACES, id);
}

export async function putWorkspace(ws: Workspace): Promise<void> {
  const db = await getDB();
  await db.put(STORE.WORKSPACES, { ...ws, updatedAt: Date.now() });
}

export async function deleteWorkspace(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.WORKSPACES, id);
}

// ---------- Project ----------

export async function listProjects(workspaceId?: string): Promise<Project[]> {
  const db = await getDB();
  if (workspaceId) {
    return db.getAllFromIndex(STORE.PROJECTS, 'by-workspace', workspaceId);
  }
  return db.getAll(STORE.PROJECTS);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get(STORE.PROJECTS, id);
}

export async function putProject(p: Project): Promise<void> {
  const db = await getDB();
  await db.put(STORE.PROJECTS, { ...p, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.PROJECTS, id);
}

// ---------- Canvas ----------

export async function listCanvases(opts?: {
  workspaceId?: string;
  projectId?: string;
}): Promise<Canvas[]> {
  const db = await getDB();
  if (opts?.projectId) {
    return db.getAllFromIndex(STORE.CANVASES, 'by-project', opts.projectId);
  }
  if (opts?.workspaceId) {
    return db.getAllFromIndex(STORE.CANVASES, 'by-workspace', opts.workspaceId);
  }
  return db.getAll(STORE.CANVASES);
}

/** 按"最近打开时间"倒序，取前 N 个 */
export async function listRecentCanvases(limit = 4): Promise<Canvas[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE.CANVASES, 'by-lastOpenedAt');
  // idb 的 getAllFromIndex 是升序，反转一下
  return all.reverse().slice(0, limit);
}

export async function getCanvas(id: string): Promise<Canvas | undefined> {
  const db = await getDB();
  return db.get(STORE.CANVASES, id);
}

export async function putCanvas(c: Canvas): Promise<void> {
  const db = await getDB();
  await db.put(STORE.CANVASES, { ...c, updatedAt: Date.now() });
}

export async function deleteCanvas(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.CANVASES, id);
}

/** 仅触碰画布的 lastOpenedAt（不动其他字段，避免和 autosave 抢写） */
export async function touchCanvasOpened(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE.CANVASES, 'readwrite');
  const cur = await tx.store.get(id);
  if (cur) {
    cur.lastOpenedAt = Date.now();
    await tx.store.put(cur);
  }
  await tx.done;
}

// ---------- Package ----------

export async function listPackages(workspaceId?: string): Promise<PackageRecord[]> {
  const db = await getDB();
  if (workspaceId) {
    return db.getAllFromIndex(STORE.PACKAGES, 'by-workspace', workspaceId);
  }
  return db.getAll(STORE.PACKAGES);
}

export async function putPackage(p: PackageRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE.PACKAGES, { ...p, updatedAt: Date.now() });
}

export async function deletePackage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.PACKAGES, id);
}

/** 批量替换某 workspace 下的全部包（兼容老 nodes.ts 的 saveAllPackages 语义） */
export async function replaceAllPackages(
  workspaceId: string,
  packages: PackageRecord[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE.PACKAGES, 'readwrite');
  // 删旧
  const existing = await tx.store.index('by-workspace').getAllKeys(workspaceId);
  for (const k of existing) await tx.store.delete(k);
  // 写新
  const now = Date.now();
  for (const p of packages) {
    await tx.store.put({ ...p, workspaceId, updatedAt: now });
  }
  await tx.done;
}

// ---------- PackageGroup ----------

export async function listPackageGroups(
  workspaceId?: string
): Promise<PackageGroupRecord[]> {
  const db = await getDB();
  if (workspaceId) {
    return db.getAllFromIndex(STORE.PACKAGE_GROUPS, 'by-workspace', workspaceId);
  }
  return db.getAll(STORE.PACKAGE_GROUPS);
}

export async function putPackageGroup(g: PackageGroupRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE.PACKAGE_GROUPS, { ...g, updatedAt: Date.now() });
}

export async function deletePackageGroup(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.PACKAGE_GROUPS, id);
}

export async function replaceAllPackageGroups(
  workspaceId: string,
  groups: PackageGroupRecord[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE.PACKAGE_GROUPS, 'readwrite');
  const existing = await tx.store.index('by-workspace').getAllKeys(workspaceId);
  for (const k of existing) await tx.store.delete(k);
  const now = Date.now();
  for (const g of groups) {
    await tx.store.put({ ...g, workspaceId, updatedAt: now });
  }
  await tx.done;
}

// ---------- Meta ----------

export async function getMeta<T = unknown>(key: MetaKey | string): Promise<T | undefined> {
  const db = await getDB();
  const rec = await db.get(STORE.META, key);
  return rec?.value as T | undefined;
}

export async function setMeta(key: MetaKey | string, value: unknown): Promise<void> {
  const db = await getDB();
  const rec: MetaRecord = { key, value, updatedAt: Date.now() };
  await db.put(STORE.META, rec);
}

export async function deleteMeta(key: MetaKey | string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.META, key);
}
