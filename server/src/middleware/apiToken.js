/**
 * server/src/middleware/apiToken.js · API token 鉴权中间件
 * ---------------------------------------------------------------
 * 用于 /api/canvas/* 路由（外部 AI 操作画布的入口）。
 *
 * 行为：
 *   1) 启动时检查 process.env.PLOTMESH_API_TOKEN：
 *      - 存在 → 用该值
 *      - 不存在 → 自动生成 32 字符随机 token，并打印到 server 控制台
 *        （不会写回 .env，重启会换；用户想固定就自己写到 server/.env）
 *   2) localhost (127.0.0.1 / ::1) 默认豁免鉴权（方便 dev 用 curl）
 *      可设环境变量 PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST=true 强制鉴权
 *   3) 非 localhost：必须携带 `Authorization: Bearer <token>`
 *
 * 设计权衡：
 *   - 单 token 简单实用，符合用户拍板（C2）
 *   - 启动自动生成而不是 require .env，让用户即开即用，但生产环境
 *     强烈建议在 .env 写死（重启不丢 token）
 */
import crypto from 'crypto';

let cachedToken = null;
let tokenSource = null; // 'env' | 'generated'

/** 拿当前生效的 token；首次调用时生成（如果 .env 没设） */
export function getApiToken() {
  if (cachedToken) return cachedToken;
  const fromEnv = (process.env.PLOTMESH_API_TOKEN || '').trim();
  if (fromEnv) {
    cachedToken = fromEnv;
    tokenSource = 'env';
  } else {
    // 生成 32 字符随机 token（base32 风格，URL-safe）
    cachedToken = crypto.randomBytes(20).toString('hex'); // 40 字符 hex（>32）
    cachedToken = cachedToken.slice(0, 32);
    tokenSource = 'generated';
  }
  return cachedToken;
}

export function getTokenSource() {
  return tokenSource;
}

/**
 * 启动时打印 token 状态（在 index.js listen 后调用）
 */
export function printApiTokenBanner() {
  const token = getApiToken();
  const isGenerated = tokenSource === 'generated';
  // eslint-disable-next-line no-console
  console.log('');
  console.log('🔑 PlotMesh API Token (canvas operations):');
  console.log(`   ${token}`);
  if (isGenerated) {
    console.log('   ↑ Auto-generated this session. Add to server/.env to keep stable:');
    console.log(`   PLOTMESH_API_TOKEN=${token}`);
  } else {
    console.log('   ↑ Loaded from PLOTMESH_API_TOKEN env var.');
  }
  console.log('');
}

/**
 * Express 中间件：校验 Authorization: Bearer <token>
 * - localhost 默认豁免，除非 PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST=true
 * - 错误时返回 401
 */
export function requireApiToken(req, res, next) {
  const token = getApiToken();
  const requireLocalhost = process.env.PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST === 'true';

  // 判定是否本机请求
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocalhost =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === '' ||
    ip.startsWith('::ffff:127.');

  if (isLocalhost && !requireLocalhost) {
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
  return next();
}
