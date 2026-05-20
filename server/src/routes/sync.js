/**
 * server/src/routes/sync.js · 跨浏览器同步路由（v1.5.1）
 * ---------------------------------------------------------------
 * 让同一台机器的多个浏览器共享一份画布快照。
 *
 * 路由：
 *   GET  /api/sync/meta      返回 { exists, version, updatedAt, hash, summary }
 *                            轻量探测，不传整包。前端启动时拿来比对本地 hash。
 *
 *   GET  /api/sync/snapshot  返回 { version, updatedAt, payload } 或 null（不存在）
 *                            前端冲突弹窗选"远端覆盖本地"时全量拉。
 *
 *   PUT  /api/sync/snapshot  body: { lastKnownVersion, payload, summary? }
 *                            服务端比对当前 version：
 *                              - 一致 / 文件不存在 → 原子写盘，version+1，返 200
 *                              - 不一致 → 409 + 当前 meta，让前端走冲突弹窗
 *
 * 文件格式（store.json 顶层）：
 *   {
 *     "version": 1,           # 单调递增整数，每次 PUT +1
 *     "updatedAt": <ISO>,
 *     "ownerHint": null,      # v2.0 升多用户后填实际 uid
 *     "summary": { canvasCount, nodeCount, sizeBytes },
 *     "payload": { ... }      # 由客户端定义的完整画布数据
 *   }
 *
 * 写盘策略：先写 .tmp 再 fs.rename，避免半截文件。
 *
 * 损坏处理：解析失败时把原文件备份到 store.json.broken-<ts>，再返 500，
 *           客户端按"server 没启动"逻辑降级（只用本地 IDB）。
 */
import { Router } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import {
  getStoreFilePath,
  getStoreTempPath,
  getBrokenBackupPath,
} from '../utils/storePath.js';

const router = Router();

/**
 * 同步读取并解析 store.json；不存在返 null；损坏抛错（调用方决定如何处理）。
 */
function readStoreSync() {
  const filePath = getStoreFilePath();
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

/**
 * 把损坏的 store.json 备份保留，返回备份路径，便于排查。
 */
function quarantineBroken() {
  const filePath = getStoreFilePath();
  if (!fs.existsSync(filePath)) return null;
  const backup = getBrokenBackupPath();
  try {
    fs.copyFileSync(filePath, backup);
  } catch {
    /* swallow */
  }
  return backup;
}

/**
 * 计算 payload 的稳定 hash（SHA-1 短摘要）。
 * 必须与 client 端 syncAdapter.computeLocalSummary 保持一致：
 *   - 剥掉所有实体的 updatedAt 字段
 *   - canvas.nodes 上剥掉 React Flow 渲染时写入的 measured/selected/dragging/resizing
 */
function stripVolatile(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const stripEntity = (x) => {
    if (!x || typeof x !== 'object') return x;
    const { updatedAt: _u, ...rest } = x;
    return rest;
  };
  const stripNodeRuntime = (n) => {
    if (!n || typeof n !== 'object') return n;
    const { measured: _m, selected: _s, dragging: _d, resizing: _r, ...rest } = n;
    return rest;
  };
  const stripCanvas = (c) => {
    const cleaned = stripEntity(c);
    if (cleaned && Array.isArray(cleaned.nodes)) {
      cleaned.nodes = cleaned.nodes.map(stripNodeRuntime);
    }
    return cleaned;
  };
  const stripArr = (arr, fn) => Array.isArray(arr) ? arr.map(fn) : arr;
  return {
    schemaVersion: payload.schemaVersion,
    workspaces: stripArr(payload.workspaces, stripEntity),
    projects: stripArr(payload.projects, stripEntity),
    canvases: stripArr(payload.canvases, stripCanvas),
    packages: stripArr(payload.packages, stripEntity),
    packageGroups: stripArr(payload.packageGroups, stripEntity),
    meta: stripArr(payload.meta, stripEntity),
  };
}

function hashPayload(payload) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(stripVolatile(payload) ?? null));
  return h.digest('hex').slice(0, 16);
}

/**
 * 原子写盘：先写 tmp 再 rename。
 */
function writeStoreAtomic(obj) {
  const filePath = getStoreFilePath();
  const tmpPath = getStoreTempPath();
  const json = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * GET /api/sync/meta
 * 轻量元数据。前端启动时调它判断是否需要弹冲突窗。
 */
router.get('/meta', (_req, res) => {
  let store;
  try {
    store = readStoreSync();
  } catch (err) {
    const backup = quarantineBroken();
    return res.status(500).json({
      error: 'store_corrupted',
      message: err.message,
      backup,
    });
  }
  if (!store) {
    return res.json({
      exists: false,
      version: 0,
      updatedAt: null,
      hash: null,
      summary: null,
    });
  }
  return res.json({
    exists: true,
    version: store.version || 0,
    updatedAt: store.updatedAt || null,
    hash: hashPayload(store.payload),
    summary: store.summary || null,
  });
});

/**
 * GET /api/sync/snapshot
 * 完整快照。文件不存在返 200 + null（不返 404，避免前端 fetch 误把 404 当致命错）。
 */
router.get('/snapshot', (_req, res) => {
  let store;
  try {
    store = readStoreSync();
  } catch (err) {
    const backup = quarantineBroken();
    return res.status(500).json({
      error: 'store_corrupted',
      message: err.message,
      backup,
    });
  }
  if (!store) return res.json(null);
  return res.json({
    version: store.version || 0,
    updatedAt: store.updatedAt || null,
    payload: store.payload || null,
    summary: store.summary || null,
  });
});

/**
 * PUT /api/sync/snapshot
 * body: { lastKnownVersion: number, payload: any, summary?: object }
 *
 * 行为：
 *   - 文件不存在：直接写，version=1（lastKnownVersion 应为 0，但不强制）
 *   - 文件存在 且 lastKnownVersion === store.version：写盘，version+1
 *   - 文件存在 且 lastKnownVersion !== store.version：409 + 当前 meta，让前端弹冲突
 */
router.put('/snapshot', (req, res) => {
  const { lastKnownVersion, payload, summary } = req.body || {};

  if (typeof lastKnownVersion !== 'number') {
    return res.status(400).json({
      error: 'bad_request',
      message: 'lastKnownVersion (number) is required',
    });
  }
  if (payload === undefined) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'payload is required',
    });
  }

  let current;
  try {
    current = readStoreSync();
  } catch (err) {
    const backup = quarantineBroken();
    return res.status(500).json({
      error: 'store_corrupted',
      message: err.message,
      backup,
    });
  }

  const currentVersion = current?.version || 0;
  if (current && lastKnownVersion !== currentVersion) {
    return res.status(409).json({
      error: 'version_conflict',
      message: 'Server snapshot is newer than your lastKnownVersion',
      current: {
        version: currentVersion,
        updatedAt: current.updatedAt || null,
        hash: hashPayload(current.payload),
        summary: current.summary || null,
      },
    });
  }

  const next = {
    version: currentVersion + 1,
    updatedAt: new Date().toISOString(),
    ownerHint: null, // v2.0 升级填 uid
    summary: summary || null,
    payload,
  };

  try {
    writeStoreAtomic(next);
  } catch (err) {
    return res.status(500).json({
      error: 'write_failed',
      message: err.message,
    });
  }

  return res.json({
    ok: true,
    version: next.version,
    updatedAt: next.updatedAt,
    hash: hashPayload(next.payload),
  });
});

export default router;
