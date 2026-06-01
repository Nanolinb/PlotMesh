/**
 * server/src/auth/usersStore.js · 用户表持久化（v2.0-α Phase A 步 1.2）
 * ---------------------------------------------------------------
 * 持久化路径：<DATA_DIR>/users.json （受 PLOTMESH_DATA_DIR 影响）
 *
 * 文件结构：
 *   {
 *     "version": 1,
 *     "users": [
 *       {
 *         "id": "user-xxx",
 *         "email": "shaun@example.com",
 *         "name": "Shaun",
 *         "passwordHash": "$2b$10$...",  // 仅 builtin 用
 *         "color": "#6366f1",
 *         "provider": "builtin",
 *         "externalId": null,
 *         "createdAt": 1700000000000,
 *         "updatedAt": 1700000000000
 *       }
 *     ]
 *   }
 *
 * 设计：
 *   - 文件级锁不必要（单进程 server，所有写入 await 串行）
 *   - 写盘走原子 rename（先写 .tmp 再 rename）
 *   - bcrypt cost = 10（约 100ms/次，安全 + 不卡）
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDataDir } from '../utils/storePath.js';

const FILE_VERSION = 1;
const PRESET_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16',
];

function getUsersFilePath() {
  return path.join(getDataDir(), 'users.json');
}

function readUsersFile() {
  const fp = getUsersFilePath();
  try {
    if (!fs.existsSync(fp)) return { version: FILE_VERSION, users: [] };
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users)) {
      return { version: FILE_VERSION, users: [] };
    }
    return parsed;
  } catch (err) {
    console.warn('⚠️  读取 users.json 失败：', err.message);
    return { version: FILE_VERSION, users: [] };
  }
}

function writeUsersFile(data) {
  const fp = getUsersFilePath();
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, fp);
  try { fs.chmodSync(fp, 0o600); } catch { /* non-POSIX */ }
}

/** 浅拷贝 user，去掉 passwordHash（向外返回时务必走这里） */
export function publicUser(u) {
  if (!u) return null;
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}

export async function listAllUsers() {
  const data = readUsersFile();
  return data.users.map(publicUser);
}

export async function getUserById(id) {
  const data = readUsersFile();
  const u = data.users.find((x) => x.id === id);
  return u || null; // 内部用，含 passwordHash
}

export async function getUserByEmail(email) {
  const data = readUsersFile();
  const lower = email.toLowerCase();
  const u = data.users.find((x) => x.email.toLowerCase() === lower);
  return u || null; // 内部用，含 passwordHash
}

/**
 * 创建 builtin 用户（邮箱密码注册）。
 * @returns 不含 passwordHash 的 publicUser
 */
export async function createBuiltinUser({ email, password, name }) {
  const data = readUsersFile();
  const existing = data.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    const e = new Error('email_taken');
    e.code = 'email_taken';
    throw e;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const id = `user-${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const color = PRESET_COLORS[data.users.length % PRESET_COLORS.length];
  // v2.0-β：角色分配。第一个注册者 = admin；或 env PLOTMESH_ADMIN_EMAIL 指定的邮箱
  const adminEmail = (process.env.PLOTMESH_ADMIN_EMAIL || '').trim().toLowerCase();
  const isFirstUser = data.users.length === 0;
  const matchesAdminEmail = adminEmail && email.trim().toLowerCase() === adminEmail;
  const role = (isFirstUser || matchesAdminEmail) ? 'admin' : 'member';
  const user = {
    id,
    email: email.trim(),
    name: (name || email.split('@')[0]).trim(),
    passwordHash,
    color,
    role,
    provider: 'builtin',
    externalId: null,
    createdAt: now,
    updatedAt: now,
  };
  data.users.push(user);
  writeUsersFile(data);
  return publicUser(user);
}

/**
 * 校验 builtin 用户的密码。
 * @returns publicUser（不含 passwordHash）；密码错则 null。
 */
export async function verifyBuiltinPassword(email, password) {
  const u = await getUserByEmail(email);
  if (!u || u.provider !== 'builtin') return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;
  return publicUser(u);
}

/**
 * 更新用户的可变字段（name / color / passwordHash）。
 * 注意：email 不允许改（牵扯太多映射），未来要改的话单开 changeEmail 接口。
 */
export async function updateUser(id, patch) {
  const data = readUsersFile();
  const idx = data.users.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const cur = data.users[idx];
  const allowed = {};
  if (typeof patch.name === 'string') allowed.name = patch.name.trim();
  if (typeof patch.color === 'string') allowed.color = patch.color;
  if (typeof patch.passwordHash === 'string') allowed.passwordHash = patch.passwordHash;
  data.users[idx] = { ...cur, ...allowed, updatedAt: Date.now() };
  writeUsersFile(data);
  return publicUser(data.users[idx]);
}

/** 改密码的便利函数 */
export async function changePassword(id, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return updateUser(id, { passwordHash });
}

/**
 * 用户数 = 0 时返回 true。前端登录页用：
 *   - 0 用户 → 显示"创建第一个账号"，不要求登录
 *   - >0 用户 → 显示登录表单
 */
export async function hasAnyUser() {
  const data = readUsersFile();
  return data.users.length > 0;
}

// ─── v2.0-β：admin 角色管理 ──────────────────────────────────────

/**
 * 角色归一化：老数据（无 role 字段）兼容处理。
 * 规则：若所有用户都没有 role 字段，则把 createdAt 最早的那位设为 admin，其余 member。
 * 这样升级前注册的用户不会全无管理员。返回是否发生了写盘。
 */
function normalizeRoles(data) {
  const anyHasRole = data.users.some((u) => u.role);
  if (anyHasRole || data.users.length === 0) return false;
  const sorted = [...data.users].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const adminId = sorted[0].id;
  for (const u of data.users) {
    u.role = u.id === adminId ? 'admin' : 'member';
  }
  return true;
}

/** 列出所有用户（publicUser），并确保 role 已归一化 */
export async function listAllUsersWithRoles() {
  const data = readUsersFile();
  if (normalizeRoles(data)) writeUsersFile(data);
  return data.users
    .map(publicUser)
    .map((u) => ({ ...u, role: u.role || 'member' }));
}

/** 当前 admin 数量 */
export async function countAdmins() {
  const data = readUsersFile();
  normalizeRoles(data);
  return data.users.filter((u) => (u.role || 'member') === 'admin').length;
}

/**
 * 删除用户。禁止删除最后一个 admin（防自锁）。
 * @returns {{ok:true} | {ok:false,error:string}}
 */
export async function deleteUser(id) {
  const data = readUsersFile();
  normalizeRoles(data);
  const idx = data.users.findIndex((x) => x.id === id);
  if (idx < 0) return { ok: false, error: 'user_not_found' };
  const target = data.users[idx];
  if ((target.role || 'member') === 'admin') {
    const adminCount = data.users.filter((u) => (u.role || 'member') === 'admin').length;
    if (adminCount <= 1) return { ok: false, error: 'cannot_delete_last_admin' };
  }
  data.users.splice(idx, 1);
  writeUsersFile(data);
  return { ok: true };
}

/**
 * 管理员重置某用户密码（不校验旧密码）。
 * @returns publicUser | null
 */
export async function adminResetPassword(id, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return updateUser(id, { passwordHash });
}

/**
 * 改用户角色。禁止把最后一个 admin 降级（防自锁）。
 * @returns {{ok:true,user} | {ok:false,error:string}}
 */
export async function setUserRole(id, role) {
  if (role !== 'admin' && role !== 'member') return { ok: false, error: 'invalid_role' };
  const data = readUsersFile();
  normalizeRoles(data);
  const idx = data.users.findIndex((x) => x.id === id);
  if (idx < 0) return { ok: false, error: 'user_not_found' };
  const cur = data.users[idx];
  if ((cur.role || 'member') === 'admin' && role === 'member') {
    const adminCount = data.users.filter((u) => (u.role || 'member') === 'admin').length;
    if (adminCount <= 1) return { ok: false, error: 'cannot_demote_last_admin' };
  }
  data.users[idx] = { ...cur, role, updatedAt: Date.now() };
  writeUsersFile(data);
  return { ok: true, user: publicUser(data.users[idx]) };
}
