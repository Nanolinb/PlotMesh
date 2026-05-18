/**
 * IndexedDB 初始化与版本升级（v1.5 数据底座）
 *
 * 调用方式：
 *   const db = await getDB();
 *   await db.put('canvases', canvasObj);
 *
 * 设计要点：
 * - 单例：getDB() 缓存 Promise，避免并发打开多次
 * - 升级钩子：onUpgradeNeeded 集中创建所有 store + index
 * - 不在这里做业务读写，只做"开门"
 */
import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import {
  DB_NAME,
  DB_VERSION,
  STORE,
  type Canvas,
  type Workspace,
  type Project,
  type PackageRecord,
  type PackageGroupRecord,
  type MetaRecord,
} from '../types/db';

/** idb 用的 schema 描述 */
interface PlotMeshSchema extends DBSchema {
  workspaces: {
    key: string;
    value: Workspace;
    indexes: { 'by-updatedAt': number };
  };
  projects: {
    key: string;
    value: Project;
    indexes: { 'by-workspace': string; 'by-updatedAt': number };
  };
  canvases: {
    key: string;
    value: Canvas;
    indexes: {
      'by-project': string;
      'by-workspace': string;
      'by-lastOpenedAt': number;
      'by-updatedAt': number;
    };
  };
  packages: {
    key: string;
    value: PackageRecord;
    indexes: { 'by-workspace': string; 'by-group': string };
  };
  packageGroups: {
    key: string;
    value: PackageGroupRecord;
    indexes: { 'by-workspace': string };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<PlotMeshSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<PlotMeshSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PlotMeshSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v0 -> v1：建全部 store
        if (oldVersion < 1) {
          const ws = db.createObjectStore(STORE.WORKSPACES, { keyPath: 'id' });
          ws.createIndex('by-updatedAt', 'updatedAt');

          const proj = db.createObjectStore(STORE.PROJECTS, { keyPath: 'id' });
          proj.createIndex('by-workspace', 'workspaceId');
          proj.createIndex('by-updatedAt', 'updatedAt');

          const canvas = db.createObjectStore(STORE.CANVASES, { keyPath: 'id' });
          canvas.createIndex('by-project', 'projectId');
          canvas.createIndex('by-workspace', 'workspaceId');
          canvas.createIndex('by-lastOpenedAt', 'lastOpenedAt');
          canvas.createIndex('by-updatedAt', 'updatedAt');

          const pkg = db.createObjectStore(STORE.PACKAGES, { keyPath: 'id' });
          pkg.createIndex('by-workspace', 'workspaceId');
          pkg.createIndex('by-group', 'groupId');

          const pkgGroup = db.createObjectStore(STORE.PACKAGE_GROUPS, { keyPath: 'id' });
          pkgGroup.createIndex('by-workspace', 'workspaceId');

          db.createObjectStore(STORE.META, { keyPath: 'key' });
        }
        // 未来 v1 -> v2 在此追加
      },
      blocked() {
        // 多个 tab 并发升级会触发，这里只做日志，不阻断
        console.warn('[plotmesh-db] upgrade blocked: 其他 tab 仍持有旧版本连接');
      },
      blocking() {
        // 当前连接阻塞了别的 tab 升级
        console.warn('[plotmesh-db] upgrade blocking: 关闭当前连接以让别处升级');
      },
      terminated() {
        console.warn('[plotmesh-db] connection terminated');
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** 关闭并清理（仅测试 / 重置场景使用） */
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

/** 危险操作：彻底删库（测试用，UI 永远不要直接调） */
export async function destroyDB(): Promise<void> {
  await closeDB();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
}
