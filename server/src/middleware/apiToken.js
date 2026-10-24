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
 * - 已登录的 Web 用户带 JWT 时直接放行：保留 req.user，供各路由执行画布权限校验
 * - 外部 AI / MCP 继续使用 server-level API token
 * - 默认：localhost 自动豁免；remoteAccess=true 或显式环境变量时强制凭证
 * - 错误时返回 401
 */
export function requireApiToken(req, res, next) {
  // index.js 的 optionalAuth 已验证 JWT。NAS 同源反代下，浏览器不能安全保存全局 API token，
  // 因此已登录用户走 JWT；外部自动化仍走下方的 API token 分支。
  if (req.user) {
    req.apiUser = req.user;
    return next();
  }

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

function isLocalhostRequest(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip === ''
    || ip.startsWith('::ffff:127.');
}

/** 仅本机豁免：用于兼容本地开发脚本的敏感管理端点。 */
export function requireLocalhost(req, res, next) {
  if (!isLocalhostRequest(req)) {
    return res.status(403).json({ error: 'localhost_only', message: 'This endpoint is only available on localhost' });
  }
  return next();
}

/**
 * NAS / 反向代理场景下，管理员可通过已验证 JWT 管理 server-level API token；
 * 保留 localhost 通路，兼容单机开发与既有脚本。
 */
export function requireLocalhostOrAdmin(req, res, next) {
  if (isLocalhostRequest(req) || req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'admin_only', message: '仅管理员可管理 server API token' });
}
