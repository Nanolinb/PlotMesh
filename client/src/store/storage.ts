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

/**
 * 列出画布。默认过滤掉 deleted=true（回收站里的）；
 * 传 includeDeleted=true 则全部返回（用于回收站、同步合并等场景）。
 */
export async function listCanvases(opts?: {
  workspaceId?: string;
  projectId?: string;
  includeDeleted?: boolean;
}): Promise<Canvas[]> {
  const db = await getDB();
  let arr: Canvas[];
  if (opts?.projectId) {
    arr = await db.getAllFromIndex(STORE.CANVASES, 'by-project', opts.projectId);
  } else if (opts?.workspaceId) {
    arr = await db.getAllFromIndex(STORE.CANVASES, 'by-workspace', opts.workspaceId);
  } else {
    arr = await db.getAll(STORE.CANVASES);
  }
  return opts?.includeDeleted ? arr : arr.filter((c) => !c.deleted);
}

/** 仅"已软删"的画布，按 deletedAt 倒序（回收站列表） */
export async function listDeletedCanvases(workspaceId?: string): Promise<Canvas[]> {
  const all = await listCanvases({ workspaceId, includeDeleted: true });
  return all
    .filter((c) => c.deleted)
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

/** 按"最近打开时间"倒序，取前 N 个（自动排除已软删） */
export async function listRecentCanvases(limit = 4): Promise<Canvas[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE.CANVASES, 'by-lastOpenedAt');
  // idb 的 getAllFromIndex 是升序，反转一下 + 过滤 deleted / 模板。
  // 模板使用同一 Canvas schema，但不进入普通画布的“最近使用”列表。
  return all
    .reverse()
    .filter((c) => !c.deleted && c.kind !== 'template')
    .slice(0, limit);
}

export async function getCanvas(id: string): Promise<Canvas | undefined> {
  const db = await getDB();
  return db.get(STORE.CANVASES, id);
}

export async function putCanvas(c: Canvas): Promise<void> {
  const db = await getDB();
  await db.put(STORE.CANVASES, { ...c, updatedAt: Date.now() });
}

/** 真删（仅在彻底清空回收站 / 30 天 purge 时使用） */
export async function deleteCanvas(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.CANVASES, id);
}

/**
 * 软删画布：标 deleted=true + deletedAt=now。
 * 同步时通过 putCanvas 推送到 server，其他浏览器拉到后从可见列表中过滤。
 */
export async function softDeleteCanvas(id: string): Promise<void> {
  const db = await getDB();
  const cur = await db.get(STORE.CANVASES, id);
  if (!cur) return;
  await db.put(STORE.CANVASES, {
    ...cur,
    deleted: true,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** 从回收站恢复 */
export async function restoreCanvas(id: string): Promise<void> {
  const db = await getDB();
  const cur = await db.get(STORE.CANVASES, id);
  if (!cur) return;
  const { deleted: _d, deletedAt: _da, ...rest } = cur as any;
  await db.put(STORE.CANVASES, { ...rest, updatedAt: Date.now() });
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

/**
 * 启动时清理已软删超过 retentionDays 天的画布 / 包 / 包分组（默认 30 天）。
 */
export async function purgeOldDeleted(retentionDays = 30): Promise<{
  canvases: number;
  packages: number;
  groups: number;
}> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const db = await getDB();
  let canvasCount = 0;
  let pkgCount = 0;
  let grpCount = 0;
  {
    const tx = db.transaction(STORE.CANVASES, 'readwrite');
    for (const rec of await tx.store.getAll()) {
      if ((rec as any).deleted && ((rec as any).deletedAt || 0) < cutoff) {
        await tx.store.delete(rec.id);
        canvasCount++;
      }
    }
    await tx.done;
  }
  {
    const tx = db.transaction(STORE.PACKAGES, 'readwrite');
    for (const rec of await tx.store.getAll()) {
      if ((rec as any).deleted && ((rec as any).deletedAt || 0) < cutoff) {
        await tx.store.delete(rec.id);
        pkgCount++;
      }
    }
    await tx.done;
  }
  {
    const tx = db.transaction(STORE.PACKAGE_GROUPS, 'readwrite');
    for (const rec of await tx.store.getAll()) {
      if ((rec as any).deleted && ((rec as any).deletedAt || 0) < cutoff) {
        await tx.store.delete(rec.id);
        grpCount++;
      }
    }
    await tx.done;
  }
  return { canvases: canvasCount, packages: pkgCount, groups: grpCount };
}

// ---------- Package ----------

/** 列出包；默认过滤 deleted=true */
export async function listPackages(
  workspaceId?: string,
  opts?: { includeDeleted?: boolean }
): Promise<PackageRecord[]> {
  const db = await getDB();
  let arr: PackageRecord[];
  if (workspaceId) {
    arr = await db.getAllFromIndex(STORE.PACKAGES, 'by-workspace', workspaceId);
  } else {
    arr = await db.getAll(STORE.PACKAGES);
  }
  return opts?.includeDeleted ? arr : arr.filter((p) => !p.deleted);
}

export async function putPackage(p: PackageRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE.PACKAGES, { ...p, updatedAt: Date.now() });
}

export async function deletePackage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE.PACKAGES, id);
}

export async function softDeletePackage(id: string): Promise<void> {
  const db = await getDB();
  const cur = await db.get(STORE.PACKAGES, id);
  if (!cur) return;
  await db.put(STORE.PACKAGES, {
    ...cur,
    deleted: true,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * 批量替换某 workspace 下的全部活包（deleted=true 的不动，留在回收站）。
 * 兼容老 nodes.ts 的 saveAllPackages 语义。
 */
export async function replaceAllPackages(
  workspaceId: string,
  packages: PackageRecord[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE.PACKAGES, 'readwrite');
  // 删旧（仅活包；保留 deleted=true 的）
  const all = (await tx.store.index('by-workspace').getAll(workspaceId)) as PackageRecord[];
  for (const rec of all) {
    if (!rec.deleted) await tx.store.delete(rec.id);
  }
  // 写新
  const now = Date.now();
  for (const p of packages) {
    await tx.store.put({ ...p, workspaceId, updatedAt: now });
  }
  await tx.done;
}

// ---------- PackageGroup ----------

export async function listPackageGroups(
  workspaceId?: string,
  opts?: { includeDeleted?: boolean }
): Promise<PackageGroupRecord[]> {
  const db = await getDB();
  let arr: PackageGroupRecord[];
  if (workspaceId) {
    arr = await db.getAllFromIndex(STORE.PACKAGE_GROUPS, 'by-workspace', workspaceId);
  } else {
    arr = await db.getAll(STORE.PACKAGE_GROUPS);
  }
  return opts?.includeDeleted ? arr : arr.filter((g) => !g.deleted);
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
  // 仅删活的，保留 deleted=true 的留在回收站
  const all = (await tx.store.index('by-workspace').getAll(workspaceId)) as PackageGroupRecord[];
  for (const rec of all) {
    if (!rec.deleted) await tx.store.delete(rec.id);
  }
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
