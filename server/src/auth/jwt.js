/**
 * server/src/auth/jwt.js · JWT 工具
 * ---------------------------------------------------------------
 * v2.0-α Phase A 步 1.3：登录后颁发 JWT，请求时由 middleware 校验。
 *
 * Secret 解析优先级（与 api-token 一致）：
 *   1) 环境变量 PLOTMESH_JWT_SECRET
 *   2) <DATA_DIR>/jwt-secret 文件（首次启动自动生成 32 字节随机）
 *
 * Token 内容（payload）：
 *   { sub: userId, name, email, color, provider, iat, exp }
 *
 * 默认有效期 7 天；前端可在到期前调 /api/auth/refresh 续期（v2.0-α 暂不做，
 * 让 token 自然过期重登）。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDataDir } from '../utils/storePath.js';

const TOKEN_TTL = '7d';
let cachedSecret = null;

function getJwtSecretPath() {
  return path.join(getDataDir(), 'jwt-secret');
}

function readSecretFile() {
  try {
    const fp = getJwtSecretPath();
    if (!fs.existsSync(fp)) return null;
    const v = fs.readFileSync(fp, 'utf8').trim();
    return v || null;
  } catch (err) {
    console.warn('⚠️  读取 jwt-secret 文件失败：', err.message);
    return null;
  }
}

function writeSecretFile(secret) {
  try {
    const fp = getJwtSecretPath();
    fs.writeFileSync(fp, secret + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(fp, 0o600); } catch { /* non-POSIX */ }
    return true;
  } catch (err) {
    console.warn('⚠️  写入 jwt-secret 失败（仍可用，但重启会丢，所有 JWT 失效）：', err.message);
    return false;
  }
}

export function getJwtSecret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = (process.env.PLOTMESH_JWT_SECRET || '').trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const fromFile = readSecretFile();
  if (fromFile) {
    cachedSecret = fromFile;
    return cachedSecret;
  }
  const newSecret = crypto.randomBytes(32).toString('hex');
  writeSecretFile(newSecret);
  cachedSecret = newSecret;
  return cachedSecret;
}

/**
 * 颁发 JWT。
 * @param {{id, email, name, color, provider}} user
 * @returns {string}
 */
export function jwtSign(user) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      color: user.color,
      role: user.role || 'member',
      provider: user.provider,
    },
    secret,
    { expiresIn: TOKEN_TTL },
  );
}

/**
 * 校验 JWT，返回 payload；失败返回 null。
 */
export function jwtVerify(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}
