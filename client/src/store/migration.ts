/**
 * LS → IDB 一次性迁移（v1.5 数据底座）
 *
 * 行为：
 * 1. 检查 meta:migrated-from-ls 标记，已迁移则直接 return
 * 2. 读取所有老 LS key，备份原始 JSON 到 meta:ls-backup
 * 3. 创建 default workspace + default project
 * 4. 老画布草稿 → 一个 Canvas 记录
 * 5. 老最近画布列表 → 多个 Canvas 记录（按 id 复用）
 * 6. 老包 / 包分组 → packages / packageGroups（归到 default workspace）
 * 7. 写入 meta:migrated-from-ls = { at, version }
 *
 * 安全：
 * - 整个过程出任何错都不动老 LS（用户可以回退）
 * - 迁移成功后，老 LS key **暂不删**（30 天后由 cleanup 处理）
 * - 备份永久保留在 meta:ls-backup（直到用户主动清）
 *
 * 注意：本文件不做 IDB schema 升级，只做数据搬运。
 */
import {
  getMeta,
  setMeta,
  putWorkspace,
  putProject,
  putCanvas,
  replaceAllPackages,
  replaceAllPackageGroups,
} from './storage';
import {
  META_KEYS,
  type Workspace,
  type Project,
  type Canvas,
  type PackageRecord,
  type PackageGroupRecord,
} from '../types/db';

// 旧 LS key（与 nodes.ts 保持一致）
const LS_KEYS = {
  STORAGE: 'node-editor-packages',
  GROUPS: 'node-editor-package-groups',
  PRESETS_INJECTED: 'node-editor-presets-injected',
  CANVAS_DRAFT: 'plotmesh-canvas-draft',
  RECENT_CANVASES: 'plotmesh-recent-canvases',
} as const;

const DEFAULT_WORKSPACE_ID = 'workspace-default';
const DEFAULT_PROJECT_ID = 'project-default';

/** 备份原始 LS 内容（迁移失败可回滚 / 30 天可查） */
interface LSBackup {
  at: number;
  data: Record<string, string | null>;
}

/** 安全读 LS（任何异常视作 null，避免 SSR / 隐私模式炸） */
function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    // 不接受显式 null（兼容 LS 里写了 'null' 字符串的情况）
    return (v == null ? fallback : (v as T));
  } catch {
    return fallback;
  }
}

/** 强制按数组解析；非数组（含 null / 对象 / 字符串）一律降级为空数组 */
function safeParseArray<T = unknown>(raw: string | null): T[] {
  const v = safeParse<unknown>(raw, []);
  return Array.isArray(v) ? (v as T[]) : [];
}

/** 老画布草稿格式（来自 nodes.ts 的 CANVAS_KEY） */
interface OldCanvasDraft {
  id?: string;
  name?: string;
  nodes?: unknown[];
  edges?: unknown[];
  viewport?: { x: number; y: number; zoom: number };
  thumbnail?: string;
  updatedAt?: number;
}

/** 老最近画布项（来自 nodes.ts 的 RECENT_CANVASES_KEY） */
interface OldRecentCanvas extends OldCanvasDraft {
  id: string;
}

export interface MigrationReport {
  alreadyMigrated: boolean;
  workspaceCreated: boolean;
  projectCreated: boolean;
  canvasCount: number;
  packageCount: number;
  packageGroupCount: number;
  presetsInjected: boolean;
  durationMs: number;
}

/**
 * 入口：在 App 启动时调用一次（idempotent）。
 * 调用方应 await 完毕后再渲染依赖 IDB 的 UI。
 */
export async function migrateFromLocalStorageIfNeeded(): Promise<MigrationReport> {
  const t0 = performance.now();
  const flag = await getMeta<{ at: number; version: number }>(META_KEYS.MIGRATED_FROM_LS);
  if (flag) {
    return {
      alreadyMigrated: true,
      workspaceCreated: false,
      projectCreated: false,
      canvasCount: 0,
      packageCount: 0,
      packageGroupCount: 0,
      presetsInjected: false,
      durationMs: performance.now() - t0,
    };
  }

  // 1. 备份
  const backup: LSBackup = {
    at: Date.now(),
    data: {
      [LS_KEYS.STORAGE]: safeRead(LS_KEYS.STORAGE),
      [LS_KEYS.GROUPS]: safeRead(LS_KEYS.GROUPS),
      [LS_KEYS.PRESETS_INJECTED]: safeRead(LS_KEYS.PRESETS_INJECTED),
      [LS_KEYS.CANVAS_DRAFT]: safeRead(LS_KEYS.CANVAS_DRAFT),
      [LS_KEYS.RECENT_CANVASES]: safeRead(LS_KEYS.RECENT_CANVASES),
    },
  };
  await setMeta(META_KEYS.LS_BACKUP, backup);

  // 2. 默认 workspace + project
  const now = Date.now();
  const ws: Workspace = {
    id: DEFAULT_WORKSPACE_ID,
    name: 'My Workspace',
    createdAt: now,
    updatedAt: now,
  };
  const proj: Project = {
    id: DEFAULT_PROJECT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    name: 'Default Project',
    createdAt: now,
    updatedAt: now,
    mode: 'loose',
  };
  await putWorkspace(ws);
  await putProject(proj);
  await setMeta(META_KEYS.DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID);
  await setMeta(META_KEYS.DEFAULT_PROJECT_ID, DEFAULT_PROJECT_ID);

  // 3. 画布草稿（如果存在，作为一个独立 Canvas）
  let canvasCount = 0;
  let activeCanvasId: string | null = null;
  const draft = safeParse<OldCanvasDraft | null>(backup.data[LS_KEYS.CANVAS_DRAFT], null);
  if (draft && Array.isArray(draft.nodes)) {
    const id = draft.id ?? `canvas-${now}-draft`;
    const c: Canvas = {
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: DEFAULT_PROJECT_ID,
      name: draft.name?.trim() || '未命名画布',
      nodes: draft.nodes ?? [],
      edges: Array.isArray(draft.edges) ? draft.edges : [],
      viewport: draft.viewport,
      thumbnail: draft.thumbnail,
      lastOpenedAt: draft.updatedAt ?? now,
      createdAt: draft.updatedAt ?? now,
      updatedAt: draft.updatedAt ?? now,
    };
    await putCanvas(c);
    canvasCount += 1;
    activeCanvasId = id;
  }

  // 4. 最近画布（去重：草稿 id 已写过的就跳过）
  const recent = safeParseArray<OldRecentCanvas>(backup.data[LS_KEYS.RECENT_CANVASES]);
  const seen = new Set<string>(activeCanvasId ? [activeCanvasId] : []);
  for (const r of recent) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const c: Canvas = {
      id: r.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: DEFAULT_PROJECT_ID,
      name: r.name?.trim() || '未命名画布',
      nodes: Array.isArray(r.nodes) ? r.nodes : [],
      edges: Array.isArray(r.edges) ? r.edges : [],
      viewport: r.viewport,
      thumbnail: r.thumbnail,
      lastOpenedAt: r.updatedAt ?? now,
      createdAt: r.updatedAt ?? now,
      updatedAt: r.updatedAt ?? now,
    };
    await putCanvas(c);
    canvasCount += 1;
  }

  if (activeCanvasId) {
    await setMeta(META_KEYS.ACTIVE_CANVAS_ID, activeCanvasId);
  }

  // 5. 包分组 → packageGroups
  const oldGroups = safeParseArray<unknown>(backup.data[LS_KEYS.GROUPS]);
  const groupRecords: PackageGroupRecord[] = [];
  for (const g of oldGroups) {
    if (!g || typeof g !== 'object') continue;
    const obj = g as { id?: string; name?: string; order?: number };
    if (!obj.id) continue;
    groupRecords.push({
      id: obj.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: obj.name ?? '未命名分组',
      order: typeof obj.order === 'number' ? obj.order : 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  await replaceAllPackageGroups(DEFAULT_WORKSPACE_ID, groupRecords);

  // 6. 包 → packages
  const oldPackages = safeParseArray<unknown>(backup.data[LS_KEYS.STORAGE]);
  const pkgRecords: PackageRecord[] = [];
  for (const p of oldPackages) {
    if (!p || typeof p !== 'object') continue;
    const obj = p as {
      id?: string;
      name?: string;
      groupId?: string | null;
      [k: string]: unknown;
    };
    if (!obj.id) continue;
    pkgRecords.push({
      id: obj.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      groupId: obj.groupId ?? null,
      name: obj.name ?? '未命名包',
      payload: obj, // 整体保留，nodes.ts 后续可继续按老 schema 用
      createdAt: now,
      updatedAt: now,
    });
  }
  await replaceAllPackages(DEFAULT_WORKSPACE_ID, pkgRecords);

  // 7. 预置注入标记
  const presetsInjected = backup.data[LS_KEYS.PRESETS_INJECTED] === '1';
  if (presetsInjected) {
    await setMeta(META_KEYS.PRESETS_INJECTED, true);
  }

  // 8. 完成
  await setMeta(META_KEYS.MIGRATED_FROM_LS, { at: Date.now(), version: 1 });

  return {
    alreadyMigrated: false,
    workspaceCreated: true,
    projectCreated: true,
    canvasCount,
    packageCount: pkgRecords.length,
    packageGroupCount: groupRecords.length,
    presetsInjected,
    durationMs: performance.now() - t0,
  };
}

/**
 * 30 天后清理老 LS 数据（保留 meta:ls-backup）。
 * 由调用方决定时机；本期 v1.5 不自动调。
 */
export function cleanupLegacyLocalStorage(): void {
  for (const k of Object.values(LS_KEYS)) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 忽略 */
    }
  }
}
