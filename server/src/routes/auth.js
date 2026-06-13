/**
 * server/src/routes/auth.js · 认证 API
 * ---------------------------------------------------------------
 * v2.0-α Phase A 步 1.4：暴露 5 个端点，配合前端登录页。
 *
 *   POST /api/auth/register       注册（builtin 专属）
 *   POST /api/auth/login          登录 → 返回 JWT
 *   POST /api/auth/logout         无服务端状态，前端清 token 即可（这里仅 200）
 *   GET  /api/auth/me             读当前用户（带 JWT）
 *   GET  /api/auth/providers      列出可用 provider + 是否需要登录 + 是否首位用户
 *
 * 双模架构：
 *   - server-config.json 的 auth.required = false 时，前端可不登录直接用画布
 *   - true 时，前端检测到必须登录才放行
 *   - 此路由本身始终可用，由前端按 providers.required 决定是否强制
 */
import express from 'express';
import { builtinProvider } from '../auth/builtinProvider.js';
import { registerProvider, listProviders, getProvider } from '../auth/AuthProvider.js';
import { jwtSign } from '../auth/jwt.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { getServerConfig, updateServerConfig } from '../utils/serverConfig.js';
import {
  changePassword, verifyBuiltinPassword,
  listAllUsersWithRoles, deleteUser, adminResetPassword, setUserRole,
} from '../auth/usersStore.js';
import { readPayload } from '../utils/storeIO.js';

// 启动时注册 builtin provider（v2.0-α 唯一）
registerProvider(builtinProvider);

const router = express.Router();

// ── 注册 ───────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    const cfg = getServerConfig();
    // 安全策略：只有"还没有任何用户"或"server-config 显式 allowSelfRegister"才允许注册
    const allowSelf = cfg.auth?.allowSelfRegister === true;
    const noOne = await builtinProvider.hasAnyUser() === false;
    if (!allowSelf && !noOne) {
      return res.status(403).json({
        error: 'registration_disabled',
        message: '该 server 禁止自助注册，请联系管理员。',
      });
    }
    const user = await builtinProvider.register({ email, password, name });
    const token = jwtSign(user);
    return res.json({ user, token });
  } catch (err) {
    if (err.code) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    console.error('[auth] register failed:', err);
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// ── 登录 ───────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { provider: providerId = 'builtin', ...creds } = req.body || {};
    const provider = getProvider(providerId);
    if (!provider) {
      return res.status(400).json({ error: 'unknown_provider', message: `Provider "${providerId}" not found` });
    }
    const user = await provider.authenticate(creds);
    const token = jwtSign(user);
    return res.json({ user, token });
  } catch (err) {
    if (err.code) {
      return res.status(401).json({ error: err.code, message: err.message });
    }
    console.error('[auth] login failed:', err);
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// ── 注销（服务端无状态，纯客户端清 token） ───────────────
router.post('/logout', (_req, res) => {
  return res.json({ ok: true });
});

// ── 修改密码 ────────────────────────────────────────────
router.patch('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'missing_fields', message: '请提供当前密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'weak_password', message: '新密码至少 6 位' });
    }
    // 校验旧密码
    const verified = await verifyBuiltinPassword(req.user.email, currentPassword);
    if (!verified) {
      return res.status(401).json({ error: 'wrong_password', message: '当前密码不正确' });
    }
    await changePassword(req.user.id, newPassword);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth] change-password failed:', err);
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// ── 登录页改密（无需 JWT，凭 邮箱 + 当前密码 校验）─────────
//   场景：用户在登录页就想改密码（忘了想换、或被告知临时密码后首次更换）。
//   安全级别等同登录：必须先用 邮箱 + 当前密码 通过 verifyBuiltinPassword，
//   才允许设新密码。失败信息保持模糊（不区分"邮箱不存在"与"密码错"），防枚举。
router.post('/change-password-with-credentials', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body || {};
    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'missing_fields', message: '请填写邮箱、当前密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'weak_password', message: '新密码至少 6 位' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'same_password', message: '新密码不能与当前密码相同' });
    }
    const verified = await verifyBuiltinPassword(email, currentPassword);
    if (!verified) {
      // 模糊提示，防账号枚举
      return res.status(401).json({ error: 'invalid_credentials', message: '邮箱或当前密码不正确' });
    }
    await changePassword(verified.id, newPassword);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth] change-password-with-credentials failed:', err);
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// ── 当前用户 ───────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

// ── Providers + 是否要求登录 + 首位用户判断 ─────────────
router.get('/providers', async (_req, res) => {
  const cfg = getServerConfig();
  const required = cfg.auth?.required === true;
  const allowSelfRegister = cfg.auth?.allowSelfRegister === true;
  const hasUser = await builtinProvider.hasAnyUser();
  return res.json({
    providers: listProviders(),
    required,
    allowSelfRegister,
    hasAnyUser: hasUser,
    /** 是否处于"首位用户引导期"：required=true 但还没人，前端应展示"创建第一个账号" */
    bootstrapMode: required && !hasUser,
  });
});

// ═══════════════════════════════════════════════════════
// v2.0-β：管理员后台（仅 admin 可访问，requireAdmin 校验 JWT.role）
// ═══════════════════════════════════════════════════════

// GET /api/auth/admin/users  → 列出所有用户（含 role）
router.get('/admin/users', requireAdmin, async (_req, res) => {
  try {
    const users = await listAllUsersWithRoles();
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// DELETE /api/auth/admin/users/:id  → 删除用户（禁删自己 / 最后一个 admin）
router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'cannot_delete_self', message: '不能删除自己' });
    }
    const r = await deleteUser(targetId);
    if (!r.ok) {
      const msg = r.error === 'cannot_delete_last_admin' ? '不能删除最后一个管理员'
        : r.error === 'user_not_found' ? '用户不存在' : r.error;
      return res.status(400).json({ error: r.error, message: msg });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// PATCH /api/auth/admin/users/:id/reset-password  → 管理员重置某用户密码
router.patch('/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'weak_password', message: '新密码至少 6 位' });
    }
    const u = await adminResetPassword(req.params.id, newPassword);
    if (!u) return res.status(404).json({ error: 'user_not_found', message: '用户不存在' });
    return res.json({ ok: true, user: u });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// PATCH /api/auth/admin/users/:id/role  → 改用户角色（admin/member）
router.patch('/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body || {};
    const r = await setUserRole(req.params.id, role);
    if (!r.ok) {
      const msg = r.error === 'cannot_demote_last_admin' ? '不能降级最后一个管理员'
        : r.error === 'invalid_role' ? '角色非法'
        : r.error === 'user_not_found' ? '用户不存在' : r.error;
      return res.status(400).json({ error: r.error, message: msg });
    }
    return res.json({ ok: true, user: r.user });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

// ─── v2.0 管理面板增强：server 设置开关（admin 通道，区别于 requireLocalhost 的本机通道）───
// GET /api/auth/admin/server-config → 读当前 server 行为开关
router.get('/admin/server-config', requireAdmin, (_req, res) => {
  const cfg = getServerConfig();
  return res.json({
    remoteAccess: cfg.remoteAccess === true,
    auth: {
      required: cfg.auth?.required === true,
      allowSelfRegister: cfg.auth?.allowSelfRegister === true,
    },
  });
});

// PATCH /api/auth/admin/server-config → 改 server 行为开关
//   可改字段：remoteAccess、auth.required、auth.allowSelfRegister
//   remoteAccess / auth.required 改动需重启 server 才生效（监听地址 / 中间件挂载在启动期定型）
router.patch('/admin/server-config', requireAdmin, (req, res) => {
  const body = req.body || {};
  const patch = {};
  let restartRequired = false;
  if (typeof body.remoteAccess === 'boolean') {
    patch.remoteAccess = body.remoteAccess;
    restartRequired = true;
  }
  const authPatch = {};
  if (body.auth && typeof body.auth === 'object') {
    if (typeof body.auth.required === 'boolean') {
      authPatch.required = body.auth.required;
      restartRequired = true; // 登录门是否强制，前端 gate 在启动检测，重启更稳
    }
    if (typeof body.auth.allowSelfRegister === 'boolean') {
      // 自助注册开关是运行期实时读取的，不需要重启
      authPatch.allowSelfRegister = body.auth.allowSelfRegister;
    }
  }
  if (Object.keys(authPatch).length > 0) patch.auth = authPatch;
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_changes', message: '至少传一个可更新字段' });
  }
  const cfg = updateServerConfig(patch);
  return res.json({
    ok: true,
    config: {
      remoteAccess: cfg.remoteAccess === true,
      auth: {
        required: cfg.auth?.required === true,
        allowSelfRegister: cfg.auth?.allowSelfRegister === true,
      },
    },
    restartRequired,
  });
});

// GET /api/auth/admin/audit → 引用合约审计流水（rejected/cancelled 永久归档）
router.get('/admin/audit', requireAdmin, (_req, res) => {
  try {
    const payload = readPayload();
    const archive = Array.isArray(payload.connectionsArchive) ? payload.connectionsArchive : [];
    // 画布 id → name 映射，便于展示
    const nameOf = {};
    for (const c of payload.canvases || []) nameOf[c.id] = c.name;
    // 倒序（最近的在前），裁剪展示字段
    const records = [...archive].reverse().map((c) => ({
      id: c.id,
      status: c.status,
      srcCanvasId: c.srcCanvasId,
      srcCanvasName: nameOf[c.srcCanvasId] || c.srcCanvasId,
      dstCanvasId: c.dstCanvasId,
      dstCanvasName: nameOf[c.dstCanvasId] || c.dstCanvasId,
      requestedBy: c.requestedBy || null,
      srcOwnerId: c.srcOwnerId || null,
      dstOwnerId: c.dstOwnerId || null,
      decidedAt: c.decidedAt || null,
      cancelledAt: c.cancelledAt || null,
      history: c.history || [],
    }));
    return res.json({ records, total: records.length });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

export default router;
