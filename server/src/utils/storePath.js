/**
 * server/src/utils/storePath.js · 同步存储路径解析
 * ---------------------------------------------------------------
 * v1.5.1 跨浏览器画布同步：把"画布快照"集中存到本机一份共享 JSON，
 * 让同一台机器的多个浏览器（Chrome / Edge / Firefox）共享同一份数据。
 *
 * 路径优先级：
 *   1) 环境变量 PLOTMESH_DATA_DIR（用户可指向 iCloud / Dropbox / OneDrive 同步盘
 *      间接获得跨设备同步）
 *   2) 默认 ~/.plotmesh/
 *
 * 数据布局（v1.5.1 单用户）：
 *   <DATA_DIR>/store.json
 *
 * v2.0-α 升级（多用户）：
 *   <DATA_DIR>/users/<uid>/store.json
 *   届时检测到根目录的 store.json 存在 → 创建第一个本地账号 →
 *   把 store.json move 到 users/<uid>/store.json，零数据损失。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * 拿到数据目录的绝对路径，必要时创建。
 * @returns {string} 绝对路径
 */
export function getDataDir() {
  const fromEnv = process.env.PLOTMESH_DATA_DIR;
  const dir = fromEnv && fromEnv.trim()
    ? path.resolve(fromEnv.trim())
    : path.join(os.homedir(), '.plotmesh');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 当前用户的 store.json 绝对路径（v1.5.1 单用户）。
 */
export function getStoreFilePath() {
  return path.join(getDataDir(), 'store.json');
}

/**
 * 临时写盘文件路径，原子替换用。
 */
export function getStoreTempPath() {
  return path.join(getDataDir(), 'store.json.tmp');
}

/**
 * 损坏文件备份路径（解析失败时把原文件备份保留）。
 */
export function getBrokenBackupPath(ts = Date.now()) {
  return path.join(getDataDir(), `store.json.broken-${ts}`);
}
