/**
 * server/src/auth/middleware.js · 鉴权中间件
 * ---------------------------------------------------------------
 * v2.0-α Phase A 步 1.3：
 *
 *   - optionalAuth：解析 Authorization: Bearer <jwt>，挂 req.user（可选）。
 *     **不报错** —— 没 token 或失败都允许继续，由路由按需检查。
 *     用途：兼容 v1.x 的"无身份"调用 + 给已登录请求带上 user 上下文。
 *
 *   - requireAuth：必须带有效 JWT，否则 401。用于个人画布列表、设置页等。
 *
 * 与现有 requireApiToken 的协作：
 *   - /api/canvas/* 仍然走 requireApiToken（legacy single-token），向后兼容
 *   - /api/auth/* 走自己的逻辑（无需鉴权 + login 后颁发 JWT）
 *   - 新接口 /api/me /api/me-canvases 用 requireAuth（强 JWT）
 */
import { jwtVerify } from './jwt.js';

function extractBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function optionalAuth(req, _res, next) {
  const token = extractBearer(req);
  if (token) {
    const payload = jwtVerify(token);
    if (payload) {
      req.user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        color: payload.color,
        role: payload.role || 'member',
        provider: payload.provider,
      };
    }
  }
  return next();
}

export function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'missing_authorization', message: 'Authorization: Bearer <jwt> required' });
  }
  const payload = jwtVerify(token);
  if (!payload) {
    return res.status(401).json({ error: 'invalid_token', message: 'JWT invalid or expired' });
  }
  req.user = {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    color: payload.color,
    role: payload.role || 'member',
    provider: payload.provider,
  };
  return next();
}

/**
 * v2.0-β：要求 admin 角色。自带 JWT 解析（不依赖 requireAuth 先跑）。
 */
export function requireAdmin(req, res, next) {
  const token = extractBearer(req);
  const payload = token ? jwtVerify(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'invalid_token', message: 'JWT required' });
  }
  if ((payload.role || 'member') !== 'admin') {
    return res.status(403).json({ error: 'admin_only', message: '仅管理员可操作' });
  }
  req.user = {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    color: payload.color,
    role: payload.role,
    provider: payload.provider,
  };
  return next();
}
