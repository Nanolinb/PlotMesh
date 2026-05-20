/**
 * client/src/store/syncMerge.ts · 三向合并核心（v1.5.2）
 * ---------------------------------------------------------------
 * 目标：让"双浏览器在同账户下分别编辑不同画布"的场景自动并集合并，
 *       只有"同 ID 实体两边都改了"才算真冲突，弹窗让用户选。
 *
 * 三向 diff 输入：
 *   base   —— 上次成功同步时的实体快照（meta:last-synced-base 里存 id→updatedAt 映射）
 *   local  —— 本地 IDB 当前内容（含已软删 deleted=true）
 *   remote —— 远端 server.json.payload 当前内容（含已软删 deleted=true）
 *
 * 实体级 diff 规则：
 *   - 一方动了一方没动 → 自动选动了的一方
 *   - 两方都动了：
 *     • canvas → 真冲突（push 进 conflicts[]，由 UI 让用户决策每条画布）
 *     • package / packageGroup / workspace / project → 取 updatedAt 较新一方
 *   - 不同 ID 实体直接并集（这是用户场景的 80%）
 *   - "动了"的判定：updatedAt 大于 base.updatedAt；base 不存在则视为"新增"
 *
 * 边界 case：
 *   - 首次同步无 base → 全部并集 + 同 ID 真冲突弹窗
 *   - base 严重过期（任意一侧 updatedAt 跨度极大）→ 当前简化为"按规则跑"，
 *     真冲突自然进 conflicts[] 让用户决策，不做特殊降级
 *
 * 软删除参与合并：
 *   - softDeleteCanvas 后 deleted=true 也是一次 update（updatedAt 更新）
 *   - 一方删了一方没动 → 自动以"删了"那一方为准（删除 propagate）
 *   - 一方删了一方编辑了 → canvas 真冲突（按规则进 conflicts[]）
 *   - 两方都删了 → 取 deletedAt 较新一方（实际效果一致）
 */
import type { Canvas, Workspace, Project, PackageRecord, PackageGroupRecord, MetaRecord } from '../types/db';

/** Base 快照里每条实体的最小记录（仅 id + updatedAt 用于 diff） */
export interface BaseEntityRef {
  id: string;
  updatedAt: number;
}

/** Last-synced base 元数据（写入 meta:last-synced-base） */
export interface SyncBase {
  /** 上次成功同步时拿到的远端 version */
  version: number;
  /** 上次成功同步时刻 */
  syncedAt: string;
  /** 各 store 的实体 id → updatedAt 映射 */
  canvases: Record<string, number>;
  packages: Record<string, number>;
  packageGroups: Record<string, number>;
  workspaces: Record<string, number>;
  projects: Record<string, number>;
}

/** 单个实体的 diff 决策 */
export type EntityVerdict<T> =
  | { kind: 'unchanged'; value: T }
  | { kind: 'use_local'; value: T }
  | { kind: 'use_remote'; value: T }
  | { kind: 'conflict'; local: T; remote: T };

/** 真冲突清单（仅 canvas，UI 弹窗让用户逐条决策） */
export interface CanvasConflict {
  id: string;
  local: Canvas;
  remote: Canvas;
}

/** 自动合并清单（用于"合并报告"展示，无需用户决策） */
export interface AutoMergeChange {
  kind: 'added_local' | 'added_remote' | 'updated_local' | 'updated_remote' | 'deleted_local' | 'deleted_remote';
  entity: 'canvas' | 'package' | 'packageGroup' | 'workspace' | 'project';
  id: string;
  name?: string;
}

/** 合并结果 */
export interface MergeResult {
  /** 合并后的最终实体集合（用户决策完冲突后才写入 IDB + 推 server） */
  canvases: Canvas[];
  packages: PackageRecord[];
  packageGroups: PackageGroupRecord[];
  workspaces: Workspace[];
  projects: Project[];
  meta: MetaRecord[];
  /** 真冲突的画布列表（必须由用户逐条决策） */
  conflicts: CanvasConflict[];
  /** 自动合并的清单（用于报告 UI） */
  autoChanges: AutoMergeChange[];
  /** 是否需要弹窗（conflicts.length > 0 || autoChanges.length > 0） */
  needsUserAttention: boolean;
}

/**
 * 实体级三向 diff 通用骨架。返回每个 id 的决策 + 自动合并变更清单。
 *
 * @param base 上次同步基线
 * @param locals 当前本地实体数组（含 deleted）
 * @param remotes 远端实体数组（含 deleted）
 * @param entityKind 用于 autoChanges 标签
 */
function diffById<T extends { id: string; updatedAt: number; deleted?: boolean; name?: string }>(
  base: Record<string, number>,
  locals: T[],
  remotes: T[],
  entityKind: AutoMergeChange['entity']
): {
  resolved: Map<string, EntityVerdict<T>>;
  autoChanges: AutoMergeChange[];
} {
  const localMap = new Map(locals.map((x) => [x.id, x]));
  const remoteMap = new Map(remotes.map((x) => [x.id, x]));
  const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys(), ...Object.keys(base)]);

  const resolved = new Map<string, EntityVerdict<T>>();
  const autoChanges: AutoMergeChange[] = [];

  for (const id of allIds) {
    const baseUpdated = base[id]; // undefined if never synced
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    const localChanged = local && (baseUpdated === undefined || local.updatedAt > baseUpdated);
    const remoteChanged = remote && (baseUpdated === undefined || remote.updatedAt > baseUpdated);

    if (!local && !remote) continue; // 双方都不存在（怎么会进 base？理论上 purged）
    if (!local && remote) {
      // 本地没有，远端有 —— 远端新增（或 base 没记）
      resolved.set(id, { kind: 'use_remote', value: remote });
      if (baseUpdated === undefined) {
        autoChanges.push({ kind: 'added_remote', entity: entityKind, id, name: remote.name });
      } else {
        // base 里有，本地却没了 —— 本地"硬删"了。但软删模型下不该出现这种情况，
        // 仍按 use_remote 处理（远端那条复活）
        autoChanges.push({ kind: 'updated_remote', entity: entityKind, id, name: remote.name });
      }
      continue;
    }
    if (local && !remote) {
      resolved.set(id, { kind: 'use_local', value: local });
      if (baseUpdated === undefined) {
        autoChanges.push({ kind: 'added_local', entity: entityKind, id, name: local.name });
      } else {
        autoChanges.push({ kind: 'updated_local', entity: entityKind, id, name: local.name });
      }
      continue;
    }
    // 两侧都有
    if (!localChanged && !remoteChanged) {
      // 都没动 —— 一致；任取一方
      resolved.set(id, { kind: 'unchanged', value: local! });
      continue;
    }
    if (localChanged && !remoteChanged) {
      resolved.set(id, { kind: 'use_local', value: local! });
      const ch: AutoMergeChange['kind'] = local!.deleted ? 'deleted_local' : 'updated_local';
      autoChanges.push({ kind: ch, entity: entityKind, id, name: local!.name });
      continue;
    }
    if (!localChanged && remoteChanged) {
      resolved.set(id, { kind: 'use_remote', value: remote! });
      const ch: AutoMergeChange['kind'] = remote!.deleted ? 'deleted_remote' : 'updated_remote';
      autoChanges.push({ kind: ch, entity: entityKind, id, name: remote!.name });
      continue;
    }
    // 两侧都"changed"（按 base 判定）
    if (baseUpdated === undefined) {
      // 但 base 里压根没这条 id —— 不算"两边都从同一基线分叉出去"，
      // 退化为按 updatedAt 较新一方处理（不算冲突）。
      // 边界情形：双方刚好同一时刻新增了同 id 实体（极罕见，updatedAt 完全相同）→ 任取一方
      const winner = local!.updatedAt >= remote!.updatedAt ? local! : remote!;
      const isLocal = winner === local;
      resolved.set(id, isLocal ? { kind: 'use_local', value: winner } : { kind: 'use_remote', value: winner });
      autoChanges.push({
        kind: isLocal ? 'updated_local' : 'updated_remote',
        entity: entityKind,
        id,
        name: winner.name,
      });
      continue;
    }
    // base 里有这条且双方都改了 —— 真冲突，由调用者决定（canvas 进 conflicts；其他取较新）
    resolved.set(id, { kind: 'conflict', local: local!, remote: remote! });
  }
  return { resolved, autoChanges };
}

/**
 * 主合并函数。base 为 null 时按"首次同步"处理（不做删除推断 + 全部并集）。
 */
export function mergeSnapshots(
  base: SyncBase | null,
  local: {
    canvases: Canvas[];
    packages: PackageRecord[];
    packageGroups: PackageGroupRecord[];
    workspaces: Workspace[];
    projects: Project[];
    meta: MetaRecord[];
  },
  remote: {
    canvases: Canvas[];
    packages: PackageRecord[];
    packageGroups: PackageGroupRecord[];
    workspaces: Workspace[];
    projects: Project[];
    meta: MetaRecord[];
  }
): MergeResult {
  const baseSafe: SyncBase = base ?? {
    version: 0,
    syncedAt: new Date(0).toISOString(),
    canvases: {},
    packages: {},
    packageGroups: {},
    workspaces: {},
    projects: {},
  };

  // 1) canvases —— 真冲突会进 conflicts[]
  const canvasDiff = diffById<Canvas>(baseSafe.canvases, local.canvases, remote.canvases, 'canvas');
  const canvases: Canvas[] = [];
  const conflicts: CanvasConflict[] = [];
  for (const [id, verdict] of canvasDiff.resolved) {
    if (verdict.kind === 'conflict') {
      // 特例：双方都软删 → 自动选较新（结果一致，无需用户决策）
      if (verdict.local.deleted && verdict.remote.deleted) {
        const winner =
          (verdict.local.deletedAt ?? 0) >= (verdict.remote.deletedAt ?? 0)
            ? verdict.local
            : verdict.remote;
        canvases.push(winner);
        canvasDiff.autoChanges.push({
          kind: winner === verdict.local ? 'deleted_local' : 'deleted_remote',
          entity: 'canvas',
          id: winner.id,
          name: winner.name,
        });
      } else {
        conflicts.push({ id, local: verdict.local, remote: verdict.remote });
      }
    } else {
      canvases.push(verdict.value);
    }
  }

  // 2) packages —— 真冲突取较新一方
  const pkgDiff = diffById<PackageRecord>(baseSafe.packages, local.packages, remote.packages, 'package');
  const packages: PackageRecord[] = [];
  for (const [, verdict] of pkgDiff.resolved) {
    if (verdict.kind === 'conflict') {
      const winner =
        verdict.local.updatedAt >= verdict.remote.updatedAt ? verdict.local : verdict.remote;
      packages.push(winner);
      pkgDiff.autoChanges.push({
        kind: winner === verdict.local ? 'updated_local' : 'updated_remote',
        entity: 'package',
        id: winner.id,
        name: winner.name,
      });
    } else {
      packages.push(verdict.value);
    }
  }

  // 3) packageGroups —— 同上
  const grpDiff = diffById<PackageGroupRecord>(
    baseSafe.packageGroups,
    local.packageGroups,
    remote.packageGroups,
    'packageGroup'
  );
  const packageGroups: PackageGroupRecord[] = [];
  for (const [, verdict] of grpDiff.resolved) {
    if (verdict.kind === 'conflict') {
      const winner =
        verdict.local.updatedAt >= verdict.remote.updatedAt ? verdict.local : verdict.remote;
      packageGroups.push(winner);
      grpDiff.autoChanges.push({
        kind: winner === verdict.local ? 'updated_local' : 'updated_remote',
        entity: 'packageGroup',
        id: winner.id,
        name: winner.name,
      });
    } else {
      packageGroups.push(verdict.value);
    }
  }

  // 4) workspaces / projects —— v1.5 阶段都是 default 单条，简单按 updatedAt 较新
  const wsDiff = diffById<Workspace>(baseSafe.workspaces, local.workspaces, remote.workspaces, 'workspace');
  const workspaces: Workspace[] = [];
  for (const [, verdict] of wsDiff.resolved) {
    if (verdict.kind === 'conflict') {
      const winner =
        verdict.local.updatedAt >= verdict.remote.updatedAt ? verdict.local : verdict.remote;
      workspaces.push(winner);
    } else {
      workspaces.push(verdict.value);
    }
  }
  const prjDiff = diffById<Project>(baseSafe.projects, local.projects, remote.projects, 'project');
  const projects: Project[] = [];
  for (const [, verdict] of prjDiff.resolved) {
    if (verdict.kind === 'conflict') {
      const winner =
        verdict.local.updatedAt >= verdict.remote.updatedAt ? verdict.local : verdict.remote;
      projects.push(winner);
    } else {
      projects.push(verdict.value);
    }
  }

  // 5) meta —— 浏览器本地状态 key 在 syncAdapter 那层已剔除；这里只处理共享的 meta
  //    简单按 key 取较新一方（meta 本就是 KV，没什么"冲突"概念）
  const metaMap = new Map<string, MetaRecord>();
  for (const m of remote.meta || []) metaMap.set(m.key, m);
  for (const m of local.meta || []) {
    const exist = metaMap.get(m.key);
    if (!exist || m.updatedAt > exist.updatedAt) metaMap.set(m.key, m);
  }
  const meta = Array.from(metaMap.values());

  const autoChanges = [
    ...canvasDiff.autoChanges,
    ...pkgDiff.autoChanges,
    ...grpDiff.autoChanges,
    ...wsDiff.autoChanges,
    ...prjDiff.autoChanges,
  ];

  return {
    canvases,
    packages,
    packageGroups,
    workspaces,
    projects,
    meta,
    conflicts,
    autoChanges,
    needsUserAttention: conflicts.length > 0,
  };
}

/**
 * 把当前合并结果转成新的 SyncBase（用户决策完冲突 + 落盘后调用）。
 */
export function buildBaseFromMerged(
  version: number,
  merged: {
    canvases: Canvas[];
    packages: PackageRecord[];
    packageGroups: PackageGroupRecord[];
    workspaces: Workspace[];
    projects: Project[];
  }
): SyncBase {
  const toMap = <T extends { id: string; updatedAt: number }>(arr: T[]) => {
    const m: Record<string, number> = {};
    for (const x of arr) m[x.id] = x.updatedAt;
    return m;
  };
  return {
    version,
    syncedAt: new Date().toISOString(),
    canvases: toMap(merged.canvases),
    packages: toMap(merged.packages),
    packageGroups: toMap(merged.packageGroups),
    workspaces: toMap(merged.workspaces),
    projects: toMap(merged.projects),
  };
}
