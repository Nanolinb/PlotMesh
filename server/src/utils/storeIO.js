/**
 * server/src/utils/storeIO.js · store.json 读取 / 修改 / 写回工具（v1.6.x API 用）
 * ---------------------------------------------------------------
 * 与 routes/sync.js 的语义保持一致：
 *   - 读：fs.readFileSync → JSON.parse
 *   - 写：原子替换（先 .tmp 再 fs.rename）
 *   - 每次成功写盘 version+1，updatedAt 刷新
 *   - 损坏时备份到 store.json.broken-<ts>
 *
 * 主要给 /api/canvas/* 路由用：拿一把"修改函数 mutate"，框架内部完成
 * 读 → 拷贝 → 让你修改 → 校验 → 写回。
 *
 * 注意：本工具采用"乐观读 + 全量重写"，没有用 lockfile。在单 server 单进程下
 * 已经够用；如果未来多进程或并发写入要靠这条路径，需引入文件级排他锁。
 */
import fs from 'fs';
import { getStoreFilePath, getStoreTempPath, getBrokenBackupPath } from './storePath.js';

/** 默认空 payload 结构（与 client 端 schema 一致） */
function defaultEmptyPayload() {
  const now = Date.now();
  return {
    schemaVersion: 1,
    workspaces: [
      { id: 'workspace-default', name: 'My Workspace', createdAt: now, updatedAt: now },
    ],
    projects: [
      { id: 'project-default', workspaceId: 'workspace-default', name: 'Default Project',
        createdAt: now, updatedAt: now, mode: 'loose' },
    ],
    canvases: [],
    packages: [],
    packageGroups: [],
    meta: [],
  };
}

/**
 * 读取 store；不存在返回一个合法的空 store（带默认 workspace/project）。
 * 损坏：备份到 .broken-<ts>，抛错由调用方处理。
 */
export function readStoreOrEmpty() {
  const filePath = getStoreFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      version: 0,
      updatedAt: new Date().toISOString(),
      ownerHint: null,
      summary: { canvasCount: 0, nodeCount: 0, sizeBytes: 0 },
      payload: defaultEmptyPayload(),
    };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.trim()) {
    return {
      version: 0,
      updatedAt: new Date().toISOString(),
      ownerHint: null,
      summary: { canvasCount: 0, nodeCount: 0, sizeBytes: 0 },
      payload: defaultEmptyPayload(),
    };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 损坏：备份保留
    try { fs.copyFileSync(filePath, getBrokenBackupPath()); } catch { /* swallow */ }
    throw new Error(`store.json corrupt: ${e.message}`);
  }
}

/**
 * 计算 summary 字段（canvasCount / nodeCount / sizeBytes）。
 */
function computeSummary(payload) {
  const canvases = (payload.canvases || []).filter((c) => !c.deleted);
  const nodeCount = canvases.reduce((acc, c) => acc + ((c.nodes || []).length), 0);
  return {
    canvasCount: canvases.length,
    nodeCount,
    sizeBytes: 0, // 写盘时再算
  };
}

/**
 * 原子写盘：先写 .tmp 再 fs.rename。
 */
function writeStoreAtomic(store) {
  const file = getStoreFilePath();
  const tmp = getStoreTempPath();
  const json = JSON.stringify(store, null, 2);
  fs.writeFileSync(tmp, json, 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * 修改 payload：读 store → 调 mutate(payload) → version+1 → 写盘
 *
 * mutate(payload) 可以**原地**修改 payload，也可以返回新对象（会被采用）。
 * 通常我们直接原地改（与 client 端 zustand setState 风格一致）。
 *
 * 返回 { version, updatedAt }（写完后的）。
 */
export function mutateStore(mutate) {
  const store = readStoreOrEmpty();
  const payload = store.payload || defaultEmptyPayload();
  const result = mutate(payload);
  const finalPayload = result === undefined ? payload : result;
  const next = {
    ...store,
    version: (store.version || 0) + 1,
    updatedAt: new Date().toISOString(),
    summary: computeSummary(finalPayload),
    payload: finalPayload,
  };
  // sizeBytes 写盘后回填
  const json = JSON.stringify(next, null, 2);
  next.summary.sizeBytes = Buffer.byteLength(json, 'utf-8');
  writeStoreAtomic(next);
  return { version: next.version, updatedAt: next.updatedAt };
}

/** 仅读 payload；不存在返回默认空 payload。 */
export function readPayload() {
  return readStoreOrEmpty().payload || defaultEmptyPayload();
}
