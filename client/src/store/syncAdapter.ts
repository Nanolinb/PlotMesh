/**
 * client/src/store/syncAdapter.ts · 跨浏览器画布同步适配层（v1.5.1）
 * ---------------------------------------------------------------
 * 目标：让同一台机器的多个浏览器（Chrome / Edge / Firefox）共享一份画布快照。
 *
 * 工作模式：
 *   - server 端共享盘是 source of truth，IDB 是本地缓存 + 离线兜底
 *   - 启动时先调 /api/sync/meta 比对 hash：不一致 → 由 App.tsx 弹冲突对话框
 *   - 用户在对话框选择：
 *       remote_overrides_local → pull 远端 → 全量重写 IDB
 *       local_overrides_remote → 把本地全量 PUT 上去
 *       skip                   → 本次启动只用本地，不读不写
 *   - 用户确认后或主动点"☁️ 立即同步"按钮时才推送，不做自动后台轮询
 *     （避免用户编辑中突然被远端覆盖）
 *
 * 离线降级：
 *   - server 没起 / 网络不通 → /api/sync/meta 5s 超时 → 不弹窗，只走本地
 *   - 任何 server 端错误（500 / 解析失败）→ 同上降级
 *
 * v2.0 兼容：
 *   - 当前 payload 是 IDB 全部数据的 JSON 序列化（workspaces/projects/canvases/...）
 *   - v2.0-α 升多用户时，server 把 payload 路径改成 users/<uid>/store.json，
 *     payload 内容结构不变，前端零改动
 */
import { getDB } from './db';
import { STORE, type Canvas, type Workspace, type Project, type PackageRecord, type PackageGroupRecord, type MetaRecord } from '../types/db';

const SYNC_BASE = '/api/sync';
const META_TIMEOUT_MS = 5000;

/** 远端元数据（用于启动时冲突检测） */
export interface RemoteMeta {
  exists: boolean;
  version: number;
  updatedAt: string | null;
  hash: string | null;
  summary: { canvasCount: number; nodeCount: number; sizeBytes: number } | null;
}

/** 本地快照摘要（弹窗对比展示用） */
export interface LocalSummary {
  hash: string;
  updatedAt: string | null;
  canvasCount: number;
  nodeCount: number;
  sizeBytes: number;
}

/** 完整数据包 —— PUT/GET snapshot 的 payload 字段 */
export interface SnapshotPayload {
  schemaVersion: 1;
  workspaces: Workspace[];
  projects: Project[];
  canvases: Canvas[];
  packages: PackageRecord[];
  packageGroups: PackageGroupRecord[];
  meta: MetaRecord[];
}

/** fetch with timeout（避免离线场景下卡死启动） */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = META_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// -------------------- 远端 API --------------------

/**
 * 拿远端 meta（轻量探测，不传整包）。
 * server 没起 / 超时 / 解析失败 → 返 null（调用方按"server 不可用"降级）。
 */
export async function fetchRemoteMeta(): Promise<RemoteMeta | null> {
  try {
    const res = await fetchWithTimeout(`${SYNC_BASE}/meta`);
    if (!res.ok) return null;
    return (await res.json()) as RemoteMeta;
  } catch {
    return null;
  }
}

/**
 * 拉远端完整快照（用户选"远端覆盖本地"时调）。
 * 远端没数据 → 返 null。
 */
export async function pullRemoteSnapshot(): Promise<{
  version: number;
  updatedAt: string | null;
  payload: SnapshotPayload | null;
} | null> {
  try {
    const res = await fetchWithTimeout(`${SYNC_BASE}/snapshot`, {}, 30_000);
    if (!res.ok) return null;
    const json = await res.json();
    return json; // server 没数据时 returns null，外层透传
  } catch {
    return null;
  }
}

/**
 * 推本地快照到远端。
 * @returns
 *   { ok: true, version, updatedAt, hash } 成功
 *   { ok: false, conflict: true, current } 远端 version 比 lastKnownVersion 新
 *   { ok: false, conflict: false, error } 其他失败（server 没起 / 500 / ...）
 */
export async function pushSnapshot(
  lastKnownVersion: number,
  payload: SnapshotPayload,
  summary: { canvasCount: number; nodeCount: number; sizeBytes: number }
): Promise<
  | { ok: true; version: number; updatedAt: string; hash: string }
  | { ok: false; conflict: true; current: RemoteMeta }
  | { ok: false; conflict: false; error: string }
> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${SYNC_BASE}/snapshot`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastKnownVersion, payload, summary }),
      },
      30_000
    );
  } catch (e: any) {
    return { ok: false, conflict: false, error: e?.message || 'network_error' };
  }
  if (res.status === 409) {
    const body = await res.json().catch(() => null);
    return {
      ok: false,
      conflict: true,
      current: {
        exists: true,
        version: body?.current?.version ?? 0,
        updatedAt: body?.current?.updatedAt ?? null,
        hash: body?.current?.hash ?? null,
        summary: body?.current?.summary ?? null,
      },
    };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return { ok: false, conflict: false, error: body?.message || `http_${res.status}` };
  }
  const body = await res.json();
  return {
    ok: true,
    version: body.version,
    updatedAt: body.updatedAt,
    hash: body.hash,
  };
}

// -------------------- 本地快照 --------------------

/** 把 IDB 全部内容打包成 SnapshotPayload（剔除浏览器本地状态字段；包含已软删实体） */
export async function dumpLocalSnapshot(): Promise<SnapshotPayload> {
  const db = await getDB();
  // v1.5.2：直接全量读取（含 deleted=true 的实体），让删除通过同步 propagate
  const [workspaces, projects, canvases, packages, packageGroups, metaRecs] = await Promise.all([
    db.getAll(STORE.WORKSPACES),
    db.getAll(STORE.PROJECTS),
    db.getAll(STORE.CANVASES),
    db.getAll(STORE.PACKAGES),
    db.getAll(STORE.PACKAGE_GROUPS),
    db.getAll(STORE.META),
  ]);
  // 浏览器本地状态字段不参与共享（避免 hash 抖动 + 这些字段本就是每个浏览器各自的）：
  //   canvas.lastOpenedAt - 每浏览器各自的"最近打开"
  //   canvas.thumbnail    - 缩略图体积大，每浏览器各自渲染
  //   canvas.viewport     - 视口（缩放/平移），每浏览器有自己舒服的视角
  const sharedCanvases = (canvases as Canvas[]).map((c) => {
    const { lastOpenedAt: _l, thumbnail: _t, viewport: _v, ...rest } = c as any;
    return rest as Canvas;
  });
  // meta 只保留"全局"语义的 key，浏览器本地状态过滤掉
  const localOnlyKeys = new Set([
    'active-canvas-id',
    'presets-injected',
    'migrated-from-ls',
    'ls-backup',
    'last-sync-decision',
    'last-synced-hash',
    'last-synced-base', // v1.5.2 三向合并基线（每浏览器独立）
  ]);
  const meta = (metaRecs as MetaRecord[]).filter((m) => !localOnlyKeys.has(String(m.key)));
  return {
    schemaVersion: 1,
    workspaces: workspaces as Workspace[],
    projects: projects as Project[],
    canvases: sharedCanvases,
    packages: packages as PackageRecord[],
    packageGroups: packageGroups as PackageGroupRecord[],
    meta,
  };
}

/** SHA-1 短摘要（与 server 保持一致的算法） */
async function sha1Hex16(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  // crypto.subtle 在 http://localhost 下可用；https/http 都 OK（除非很老的浏览器）
  const digest = await crypto.subtle.digest('SHA-1', buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 16);
}

/** 计算 payload 的稳定 hash（SHA-1 hex 前 16 位）+ 摘要 */
export async function computeLocalSummary(): Promise<{
  payload: SnapshotPayload;
  summary: LocalSummary;
}> {
  const payload = await dumpLocalSnapshot();
  // hash 仅基于"内容"字段，不含 updatedAt（避免每次 putCanvas 自动刷新 updatedAt 导致 hash 抖动）
  const hashSubject = JSON.stringify(stripVolatileFields(payload));
  const hash = await sha1Hex16(hashSubject);
  // updatedAt 取所有实体里最大的 updatedAt（用于弹窗"上次保存时间"展示和"较新"判定）
  let maxUpdated = 0;
  const visit = (arr: any[]) => arr.forEach((x) => {
    if (x?.updatedAt && x.updatedAt > maxUpdated) maxUpdated = x.updatedAt;
  });
  visit(payload.canvases);
  visit(payload.packages);
  visit(payload.packageGroups);
  visit(payload.workspaces);
  visit(payload.projects);
  visit(payload.meta as any[]);
  const updatedAt = maxUpdated > 0 ? new Date(maxUpdated).toISOString() : null;
  const canvasCount = payload.canvases.length;
  const nodeCount = payload.canvases.reduce(
    (sum, c) => sum + (Array.isArray(c.nodes) ? c.nodes.length : 0),
    0
  );
  const sizeBytes = JSON.stringify(payload).length;
  return { payload, summary: { hash, updatedAt, canvasCount, nodeCount, sizeBytes } };
}

/** 剥离仅与"写入时刻 / 浏览器渲染结果"相关的字段，让 hash 只反映真实内容变更 */
function stripVolatileFields(payload: SnapshotPayload): SnapshotPayload {
  const stripFromEntity = <T extends Record<string, any>>(x: T): T => {
    const { updatedAt: _u, ...rest } = x as any;
    return rest as T;
  };
  /** 节点上的 measured / selected / dragging 等是 React Flow 渲染时写入的本地状态，
   *  不应参与跨浏览器同步。 */
  const stripNodeRuntime = (n: any) => {
    if (!n || typeof n !== 'object') return n;
    const { measured: _m, selected: _s, dragging: _d, resizing: _r, ...rest } = n;
    return rest;
  };
  const stripCanvas = (c: any) => {
    const cleaned = stripFromEntity(c);
    if (Array.isArray((cleaned as any).nodes)) {
      (cleaned as any).nodes = (cleaned as any).nodes.map(stripNodeRuntime);
    }
    return cleaned;
  };
  return {
    schemaVersion: payload.schemaVersion,
    workspaces: (payload.workspaces || []).map(stripFromEntity),
    projects: (payload.projects || []).map(stripFromEntity),
    canvases: (payload.canvases || []).map(stripCanvas),
    packages: (payload.packages || []).map(stripFromEntity),
    packageGroups: (payload.packageGroups || []).map(stripFromEntity),
    meta: (payload.meta || []).map(stripFromEntity),
  };
}

/**
 * 用远端快照全量重写本地 IDB。
 * 用在用户选"远端覆盖本地"时。
 *
 * 注意：这是破坏性操作，调用前应清空当前 store 状态，调用后 hydrate 重新跑一遍。
 * 浏览器本地特有的 meta（active-canvas-id / presets-injected / 等）必须保留——
 * 否则 hydrate 会因找不到 active-canvas-id 而新建一条空白画布污染下次同步。
 */
export async function applyRemoteSnapshot(payload: SnapshotPayload): Promise<void> {
  const db = await getDB();
  const browserLocalKeys = new Set([
    'active-canvas-id',
    'presets-injected',
    'migrated-from-ls',
    'ls-backup',
    'last-sync-decision',
    'last-synced-hash',
  ]);
  // 先把本地需要保留的 meta 拿出来
  const oldMeta = (await db.getAll(STORE.META)) as MetaRecord[];
  const preservedMeta = oldMeta.filter((m) => browserLocalKeys.has(String(m.key)));
  // 从 remote payload 的 meta 里也剔除 browserLocalKeys（如果远端意外带了，旧 server 数据可能有）
  const remoteMeta = (payload.meta || []).filter((m) => !browserLocalKeys.has(String(m.key)));

  const stores = [
    STORE.WORKSPACES,
    STORE.PROJECTS,
    STORE.CANVASES,
    STORE.PACKAGES,
    STORE.PACKAGE_GROUPS,
    STORE.META,
  ];
  // 一个 readwrite 事务把所有 store 一起清空 + 写入
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  for (const w of payload.workspaces || []) await tx.objectStore(STORE.WORKSPACES).put(w);
  for (const p of payload.projects || []) await tx.objectStore(STORE.PROJECTS).put(p);
  for (const c of payload.canvases || []) await tx.objectStore(STORE.CANVASES).put(c);
  for (const p of payload.packages || []) await tx.objectStore(STORE.PACKAGES).put(p);
  for (const g of payload.packageGroups || []) await tx.objectStore(STORE.PACKAGE_GROUPS).put(g);
  for (const m of remoteMeta) await tx.objectStore(STORE.META).put(m);
  // 回写浏览器本地 meta
  for (const m of preservedMeta) await tx.objectStore(STORE.META).put(m);
  await tx.done;

  // 修正 active-canvas-id：如果保留的 active-canvas-id 在新数据里不存在，
  // 改成远端 payload 第一条 canvas 的 id（按 createdAt 排序后第一条），避免 hydrate 时凭空新建空白画布
  const activeMeta = preservedMeta.find((m) => String(m.key) === 'active-canvas-id');
  const remoteCanvases = payload.canvases || [];
  if (activeMeta && !remoteCanvases.some((c) => c.id === activeMeta.value)) {
    if (remoteCanvases.length > 0) {
      const sorted = [...remoteCanvases].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      await setMeta('active-canvas-id', sorted[0].id);
    }
  }
}

// -------------------- 决策记录 --------------------

import { setMeta } from './storage';

export type SyncDecision =
  | 'remote_overrides_local'
  | 'local_overrides_remote'
  | 'skip_this_session'
  | 'no_remote_data'
  | 'in_sync'
  | 'server_unavailable';

/** 记录最后一次同步决策（meta key：last-sync-decision），便于排查 */
export async function recordSyncDecision(
  decision: SyncDecision,
  detail?: { localHash?: string; remoteHash?: string; remoteVersion?: number }
) {
  await setMeta('last-sync-decision', {
    decision,
    at: new Date().toISOString(),
    ...(detail || {}),
  });
}

// -------------------- 内存 session 状态 --------------------

/** 当前已知的远端 version，PUT 时作为 lastKnownVersion 使用 */
let knownRemoteVersion = 0;
/** 当前会话是否被用户标记为"本次不同步" */
let skipThisSession = false;

export function getKnownRemoteVersion() {
  return knownRemoteVersion;
}
export function setKnownRemoteVersion(v: number) {
  knownRemoteVersion = v;
}

export function isSkipThisSession() {
  return skipThisSession;
}
export function setSkipThisSession(v: boolean) {
  skipThisSession = v;
}

// -------------------- v1.5.2 三向合并支持 --------------------

import type { SyncBase } from './syncMerge';
import { getMeta as getMetaKV } from './storage';
import { mergeSnapshots, buildBaseFromMerged } from './syncMerge';
import { getDB as getDB2 } from './db';
import { STORE as STORE2 } from '../types/db';

/** 读取上次同步基线（meta:last-synced-base） */
export async function getSyncBase(): Promise<SyncBase | null> {
  const v = await getMetaKV<SyncBase>('last-synced-base');
  return v ?? null;
}

export async function setSyncBase(base: SyncBase) {
  await setMeta('last-synced-base', base);
}

/**
 * 启动时跑：拉远端、读本地、跑合并；
 * 返回 MergeResult + 远端 meta（用于推送时的 lastKnownVersion）。
 *
 * - 远端不存在 → 返 null（调用方按"无需弹窗"处理）
 * - 远端存在但 hash 与本地一致 → 跑合并仍可能产生 autoChanges（少见），
 *   conflicts 一般为空；调用方可按"无需用户决策"流程
 */
export async function planSync(): Promise<{
  remoteMeta: RemoteMeta;
  remoteFullVersion: number;
  result: ReturnType<typeof mergeSnapshots>;
  base: SyncBase | null;
} | null> {
  const meta = await fetchRemoteMeta();
  if (!meta || !meta.exists) return null;
  const remoteFull = await pullRemoteSnapshot();
  if (!remoteFull?.payload) return null;

  const localPayload = await dumpLocalSnapshot();
  const base = await getSyncBase();

  const result = mergeSnapshots(
    base,
    {
      canvases: localPayload.canvases,
      packages: localPayload.packages,
      packageGroups: localPayload.packageGroups,
      workspaces: localPayload.workspaces,
      projects: localPayload.projects,
      meta: localPayload.meta,
    },
    {
      canvases: remoteFull.payload.canvases || [],
      packages: remoteFull.payload.packages || [],
      packageGroups: remoteFull.payload.packageGroups || [],
      workspaces: remoteFull.payload.workspaces || [],
      projects: remoteFull.payload.projects || [],
      meta: remoteFull.payload.meta || [],
    }
  );

  return { remoteMeta: meta, remoteFullVersion: remoteFull.version, result, base };
}

/**
 * 把合并后的实体集合写入 IDB。
 * 保留浏览器本地 meta（active-canvas-id 等）；远端 active-canvas-id 不存在对应 canvas 时
 * 自动指向第一条活画布。
 */
export async function applyMerged(merged: {
  canvases: Canvas[];
  packages: PackageRecord[];
  packageGroups: PackageGroupRecord[];
  workspaces: Workspace[];
  projects: Project[];
  meta: MetaRecord[];
}): Promise<void> {
  const db = await getDB2();
  const browserLocalKeys = new Set([
    'active-canvas-id',
    'presets-injected',
    'migrated-from-ls',
    'ls-backup',
    'last-sync-decision',
    'last-synced-hash',
    'last-synced-base',
  ]);
  // 先把本地需要保留的 meta 拿出来
  const oldMeta = (await db.getAll(STORE2.META)) as MetaRecord[];
  const preservedMeta = oldMeta.filter((m) => browserLocalKeys.has(String(m.key)));
  const sharedMeta = (merged.meta || []).filter((m) => !browserLocalKeys.has(String(m.key)));

  const stores = [
    STORE2.WORKSPACES,
    STORE2.PROJECTS,
    STORE2.CANVASES,
    STORE2.PACKAGES,
    STORE2.PACKAGE_GROUPS,
    STORE2.META,
  ];
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  for (const w of merged.workspaces || []) await tx.objectStore(STORE2.WORKSPACES).put(w);
  for (const p of merged.projects || []) await tx.objectStore(STORE2.PROJECTS).put(p);
  for (const c of merged.canvases || []) await tx.objectStore(STORE2.CANVASES).put(c);
  for (const p of merged.packages || []) await tx.objectStore(STORE2.PACKAGES).put(p);
  for (const g of merged.packageGroups || []) await tx.objectStore(STORE2.PACKAGE_GROUPS).put(g);
  for (const m of sharedMeta) await tx.objectStore(STORE2.META).put(m);
  for (const m of preservedMeta) await tx.objectStore(STORE2.META).put(m);
  await tx.done;

  // active-canvas-id 兜底：指向不存在/已软删的画布时改指向第一张活画布
  const activeMeta = preservedMeta.find((m) => String(m.key) === 'active-canvas-id');
  const liveCanvases = (merged.canvases || []).filter((c) => !(c as any).deleted);
  if (activeMeta) {
    const stillThere = liveCanvases.some((c) => c.id === activeMeta.value);
    if (!stillThere && liveCanvases.length > 0) {
      const sorted = [...liveCanvases].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      await setMeta('active-canvas-id', sorted[0].id);
    }
  }
}

export { buildBaseFromMerged };
