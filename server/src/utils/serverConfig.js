/**
 * server/src/utils/serverConfig.js · server 设置持久化（v1.6.2）
 * ---------------------------------------------------------------
 * 把"用户在前端勾选过"的 server 行为开关存到 ~/.plotmesh/server-config.json，
 * server 启动时读取、运行期可改写（例如前端切换"远端访问"开关）。
 *
 * 受 PLOTMESH_DATA_DIR 影响，跟 store.json / api-token 同目录。
 *
 * 当前管理的字段：
 *   - remoteAccess: boolean
 *       false（默认）= localhost 豁免鉴权（开发体验最好）
 *       true        = 全员强制 token（包括 localhost），server 监听 0.0.0.0
 *       受 env PLOTMESH_REMOTE_ACCESS=true/false 强制覆盖（仅启动期生效）
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from './storePath.js';

function getConfigPath() {
  return path.join(getDataDir(), 'server-config.json');
}

function defaultConfig() {
  return {
    remoteAccess: false,
  };
}

let cached = null;

function load() {
  if (cached) return cached;
  try {
    const fp = getConfigPath();
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8');
      const json = JSON.parse(raw);
      cached = { ...defaultConfig(), ...json };
    } else {
      cached = defaultConfig();
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  读取 server-config 失败：', e.message);
    cached = defaultConfig();
  }
  // env override（仅启动期，不持久化）
  const envRA = process.env.PLOTMESH_REMOTE_ACCESS;
  if (envRA === 'true') cached.remoteAccess = true;
  if (envRA === 'false') cached.remoteAccess = false;
  return cached;
}

function save() {
  try {
    const fp = getConfigPath();
    fs.writeFileSync(fp, JSON.stringify(cached, null, 2), 'utf8');
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  写入 server-config 失败：', e.message);
    return false;
  }
}

export function getServerConfig() {
  return { ...load() };
}

/**
 * 更新部分字段并写盘。返回新的完整 config。
 */
export function updateServerConfig(patch) {
  load();
  cached = { ...cached, ...patch };
  save();
  return { ...cached };
}
