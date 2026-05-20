/**
 * PlotMesh IndexedDB Schema 定义（v1.5 数据底座）
 *
 * 设计原则：
 * - 一个 DB（plotmesh），多个 Object Store
 * - Workspace → Project → Canvas 三层
 * - 包（package）+ 包分组（packageGroup）按 workspace 隔离
 * - meta store 存版本/迁移状态/全局开关
 *
 * 兼容老数据：
 * - 老版本只有"画布草稿 + 最近画布 + 包/分组"，没有 workspace/project 概念
 * - 迁移时全部归到 default workspace + default project 下
 */

/** 公共字段 */
export interface BaseEntity {
  id: string;
  createdAt: number; // Unix ms
  updatedAt: number;
  /** 软删除标志（v1.5.2 起）：true = 进了回收站；启动时统一清理 deletedAt < 30 天前的实体 */
  deleted?: boolean;
  /** 软删除时间（Unix ms）；只有 deleted=true 才有意义 */
  deletedAt?: number;
}

/** 顶层工作区（v1.5 暂时只有 default 一个） */
export interface Workspace extends BaseEntity {
  name: string;
  /** 工作区级 UI 偏好快照（占位，v1.5 不读写） */
  prefs?: Record<string, unknown>;
}

/** 项目（v1.5 暂时只有 default 一个，v1.7 才完整启用） */
export interface Project extends BaseEntity {
  workspaceId: string;
  name: string;
  /** 项目宪章（v1.7 启用） */
  constitution?: string;
  /** loose / strict 模式（v1.7 启用） */
  mode?: 'loose' | 'strict';
}

/** 画布（核心实体，nodes/edges 在这里序列化） */
export interface Canvas extends BaseEntity {
  workspaceId: string;
  projectId: string;
  name: string;
  /** React Flow 节点序列化（直接 JSON.stringify 节点数组） */
  nodes: unknown[];
  /** React Flow 边序列化 */
  edges: unknown[];
  /** 视口 viewport（{x, y, zoom}） */
  viewport?: { x: number; y: number; zoom: number };
  /** 缩略图 dataURL（jpeg base64，约 20KB） */
  thumbnail?: string;
  /** 上次打开时间（用于"最近画布"排序） */
  lastOpenedAt?: number;
}

/** 包（自定义节点 / 常用功能） */
export interface PackageRecord extends BaseEntity {
  workspaceId: string;
  /** 所属包分组 id；null/undefined = 未分组 */
  groupId?: string | null;
  name: string;
  /** 节点 payload（保持原有 schema，迁移时整体塞入） */
  payload: unknown;
}

/** 包分组 */
export interface PackageGroupRecord extends BaseEntity {
  workspaceId: string;
  name: string;
  /** 排序权重 */
  order?: number;
  /** 侧边栏中是否折叠 */
  collapsed?: boolean;
}

/** Meta（KV 杂项） */
export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** 已知 meta key 枚举（防拼写错） */
export const META_KEYS = {
  /** Schema 版本号（升级时使用） */
  SCHEMA_VERSION: 'schema-version',
  /** 是否已注入预置包（替代旧 PRESETS_INJECTED_KEY） */
  PRESETS_INJECTED: 'presets-injected',
  /** LS→IDB 迁移完成标记 */
  MIGRATED_FROM_LS: 'migrated-from-ls',
  /** LS 备份 dump（迁移完成后保留 30 天） */
  LS_BACKUP: 'ls-backup',
  /** 当前激活的画布 id（替代旧 CANVAS_KEY 的"草稿"语义） */
  ACTIVE_CANVAS_ID: 'active-canvas-id',
  /** 默认 workspace / project id（v1.5 期间只有这一组） */
  DEFAULT_WORKSPACE_ID: 'default-workspace-id',
  DEFAULT_PROJECT_ID: 'default-project-id',
  /**
   * v1.5.2 三向合并基线快照（实体 id → updatedAt 映射 + 当时的 server version）
   * 启动时拉远端最新快照后，与本地 IDB + base 三方对比生成 merge plan
   */
  LAST_SYNCED_BASE: 'last-synced-base',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

/** Object Store 名（统一来源，避免拼写错） */
export const STORE = {
  WORKSPACES: 'workspaces',
  PROJECTS: 'projects',
  CANVASES: 'canvases',
  PACKAGES: 'packages',
  PACKAGE_GROUPS: 'packageGroups',
  META: 'meta',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/** 数据库基础信息 */
export const DB_NAME = 'plotmesh';
export const DB_VERSION = 1;
