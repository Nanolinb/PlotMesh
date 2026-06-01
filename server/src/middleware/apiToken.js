/**
 * server/src/middleware/apiToken.js · API token 鉴权中间件（v1.6.1：持久化 + 重置）
 * ---------------------------------------------------------------
 * 用于 /api/canvas/* 路由（外部 AI 操作画布的入口）。
 *
 * Token 解析优先级（高 → 低）：
 *   1) 环境变量 PLOTMESH_API_TOKEN    永远赢；写在 server/.env 里最稳
 *   2) ~/.plotmesh/api-token         首次启动自动生成并写到这里，重启不丢
 *   3) 自动生成 32 字符 + 写盘到 (2)
 *
 * 受 PLOTMESH_DATA_DIR 影响：token 文件跟 store.json 同目录，方便用户把
 * 整个目录指向 iCloud / Dropbox 实现跨设备共享。
 *
 * 行为：
 *   - localhost (127.0.0.1 / ::1) 默认豁免鉴权（方便 dev 用 curl 与前端 polling）
 *     可设环境变量 PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST=true 强制鉴权
 *   - 非 localhost：必须携带 `Authorization: Bearer <token>`
 *
 * 重置入口（让用户能"换一把锁"）：
 *   - 启动参数：`PLOTMESH_RESET_TOKEN=true npm start` —— 启动时强制重置
 *   - REST：POST /api/canvas/auth/reset-token （由 routes/canvas.js 暴露，本机豁免）
 *   - Node API：resetApiToken() 直接调用
 *
 * 设计权衡：
 *   - 单 token 简单实用（用户拍板 C2）
 *   - env > file 让用户随时能用 .env 覆盖文件
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/storePath.js';
import { getServerConfig } from '../utils/serverConfig.js';

let cachedToken = null;
let tokenSource = null; // 'env' | 'file' | 'generated'

/** token 文件路径：~/.plotmesh/api-token（受 PLOTMESH_DATA_DIR 影响） */
function getTokenFilePath() {
  return path.join(getDataDir(), 'api-token');
}

function generateToken() {
  // 32 字符 hex
  return crypto.randomBytes(16).toString('hex');
}

function readTokenFile() {
  try {
    const fp = getTokenFilePath();
    if (!fs.existsSync(fp)) return null;
    const v = fs.readFileSync(fp, 'utf8').trim();
    if (!v) return null;
    return v;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  读取 token 文件失败：', err.message);
    return null;
  }
}

function writeTokenFile(token) {
  try {
    const fp = getTokenFilePath();
    // 写入并尽量收紧权限（POSIX 上设 0600，Windows 忽略）
    fs.writeFileSync(fp, token + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(fp, 0o600); } catch { /* 非 POSIX 系统会失败，无所谓 */ }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  写入 token 文件失败（token 仍生效，但重启会丢）：', err.message);
    return false;
  }
}

/**
 * 拿当前生效的 token；首次调用时按上述优先级解析；自动生成时会写盘。
 * 启动参数 PLOTMESH_RESET_TOKEN=true 会强制重置（仅在启动首次解析时生效）。
 */
export function getApiToken() {
  if (cachedToken) return cachedToken;

  // 启动参数强制重置：忽略 file，用 env 或重新生成
  const forceReset = process.env.PLOTMESH_RESET_TOKEN === 'true';

  // 优先级 1：环境变量
  const fromEnv = (process.env.PLOTMESH_API_TOKEN || '').trim();
  if (fromEnv) {
    cachedToken = fromEnv;
    tokenSource = 'env';
    return cachedToken;
  }

  // 优先级 2：持久化文件（启动重置则跳过）
  if (!forceReset) {
    const fromFile = readTokenFile();
    if (fromFile) {
      cachedToken = fromFile;
      tokenSource = 'file';
      return cachedToken;
    }
  }

  // 优先级 3：生成并写盘
  const newTok = generateToken();
  const ok = writeTokenFile(newTok);
  cachedToken = newTok;
  tokenSource = ok ? 'file' : 'generated';
  return cachedToken;
}

export function getTokenSource() {
  // 确保 cachedToken 已初始化
  if (!cachedToken) getApiToken();
  return tokenSource;
}

/**
 * 重置 token：生成新 token、写盘、清缓存。
 * 注意：如果 PLOTMESH_API_TOKEN env 存在，重置无效（env 永远赢）—— 返回错误对象。
 *
 * @returns {{ok: true, token: string} | {ok: false, error: string}}
 */
export function resetApiToken() {
  const fromEnv = (process.env.PLOTMESH_API_TOKEN || '').trim();
  if (fromEnv) {
    return {
      ok: false,
      error: 'env_token_locked',
      message: 'PLOTMESH_API_TOKEN env 已设置，重置无效。请改 server/.env 或取消该变量后重试。',
    };
  }
  const newTok = generateToken();
  writeTokenFile(newTok);
  cachedToken = newTok;
  tokenSource = 'file';
  return { ok: true, token: newTok };
}

/** 启动时打印 token 状态（在 index.js listen 后调用） */
export function printApiTokenBanner() {
  const token = getApiToken();
  // eslint-disable-next-line no-console
  console.log('');
  console.log('🔑 PlotMesh API Token (canvas operations):');
  console.log(`   ${token}`);
  switch (tokenSource) {
    case 'env':
      console.log('   ↑ Loaded from PLOTMESH_API_TOKEN env var (highest priority).');
      break;
    case 'file':
      console.log(`   ↑ Loaded from ${getTokenFilePath()} (persisted across restarts).`);
      console.log('   To reset: POST /api/canvas/auth/reset-token  or  PLOTMESH_RESET_TOKEN=true npm start');
      break;
    case 'generated':
    default:
      console.log('   ↑ Auto-generated (could not persist to disk). Add to server/.env to keep stable:');
      console.log(`   PLOTMESH_API_TOKEN=${token}`);
      break;
  }
  console.log('');
}

/**
 * Express 中间件：校验 Authorization: Bearer <token>
 * - 默认：localhost 自动豁免，外网请求需要 Bearer token
 * - 当 server-config.json 的 remoteAccess=true 时：所有请求（含 localhost）都强制 token
 *   此时 server 通常已绑定 0.0.0.0，对 LAN 暴露
 * - 兼容老 env：PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST=true 也强制
 * - 错误时返回 401
 */
export function requireApiToken(req, res, next) {
  const token = getApiToken();
  const cfg = getServerConfig();
  const requireLocalhost =
    cfg.remoteAccess === true ||
    process.env.PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST === 'true';

  // 判定是否本机请求
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocalhost =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === '' ||
    ip.startsWith('::ffff:127.');

  if (isLocalhost && !requireLocalhost) {
    // ⚓ Phase B 扩展点：localhost 豁免下也尝试解析 token → user（带了 Bearer 才有）
    const lauth = req.headers.authorization || '';
    const lm = lauth.match(/^Bearer\s+(.+)$/i);
    if (lm) req.apiUser = resolveApiTokenUser(lm[1].trim());
    return next();
  }

  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'missing_authorization', message: 'Authorization: Bearer <token> required' });
  }
  if (m[1].trim() !== token) {
    return res.status(401).json({ error: 'invalid_token', message: 'Token does not match server token' });
  }
  // ⚓ Phase B 扩展点：解析 token → user，挂 req.apiUser（当前恒为 null = server-level 全权限）
  req.apiUser = resolveApiTokenUser(m[1].trim());
  return next();
}

/**
 * ⚓ Phase B 扩展点：API token → 用户绑定（多用户隔离）
 * ---------------------------------------------------------------
 * 现状（v2.0-α Phase A）：单 server token，不绑定用户 → 全权限（server-level）。
 * 这对单机/localhost 自用没问题，但多用户联网下，外部 AI（Codex/Kimi via MCP）
 * 通过 token 连进来时，server 无法知道"以谁的身份"操作 → 无法按 ownerId 隔离画布。
 *
 * Phase B 落地方案（届时把本函数替换为真实实现）：
 *   1) token 存储从单文件 ~/.plotmesh/api-token 升级为 api-tokens.json：
 *        [{ id, token, label, userId, createdAt, lastUsedAt }, ...]
 *   2) 本函数按 token 反查 userId（命中则返回 user 对象，否则 null）
 *   3) requireApiToken 调用本函数 → 命中则 req.apiUser = user
 *        → 下游画布路由按 req.apiUser.id 过滤 ownerId / 校验 sharedWith
 *   4) userId=null 的旧 token（迁移自单文件）走 server-level 全权限，向后兼容
 *   5) 前端"API 配置 → 外部 AI 接入"tab 改为：当前用户的 token 列表 +
 *        生成/吊销，每个 token label（如 "Codex MCP"）+ lastUsedAt
 *
 * 现在返回 null：表示"未绑定用户"，requireApiToken 维持现有全权限语义不变。
 * 这样接口形状（req.apiUser 字段）提前固定，Phase B 只需填实现，不改调用方。
 *
 * @param {string} _token 当前请求携带的 Bearer token
 * @returns {{id:string,email?:string,name?:string,color?:string}|null}
 */
export function resolveApiTokenUser(_token) {
  // Phase B：在此查 api-tokens.json 反查 userId 并返回 user 对象
  return null;
}

/** 仅本机豁免：用于"前端 UI 查询/重置 token"等敏感操作 */
export function requireLocalhost(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocalhost =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === '' ||
    ip.startsWith('::ffff:127.');
  if (!isLocalhost) {
    return res.status(403).json({ error: 'localhost_only', message: 'This endpoint is only available on localhost' });
  }
  return next();
}
