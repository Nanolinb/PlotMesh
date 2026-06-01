/**
 * server/src/auth/AuthProvider.js · 认证提供方接口
 * ---------------------------------------------------------------
 * v2.0-α Phase A 步 1.1：抽象认证后端，让登录方式可插拔。
 *
 * 内置实现：
 *   - BuiltinProvider（邮箱+密码）            在 builtinProvider.js
 *
 * 后续可加（v2.0-α 之后）：
 *   - GoogleOAuthProvider                    Google 一键登录
 *   - TencentSSOProvider                     企业微信/腾讯云 SSO
 *   - LdapProvider                           企业内网 LDAP
 *
 * 接口契约：
 *   每个 Provider 必须实现 4 个方法：
 *     - id(): string                         provider 唯一标识（builtin/google/sso/ldap）
 *     - name(): string                       UI 显示名（"邮箱密码"/"Google"/"企业微信" ...）
 *     - canRegister(): boolean               是否支持自助注册（builtin 是；SSO 通常不是）
 *     - authenticate(creds): Promise<User>   验证凭据，成功返回 User，失败 throw AuthError
 *
 * 调用层（routes/auth.js）拿到 User 后用 jwtSign(user) 颁发 JWT。
 */

/**
 * 抽象基类（JS 不强制接口，但留做文档 + instanceof 检查）。
 * @typedef {{
 *   id: string;
 *   email: string;
 *   name: string;
 *   color: string;
 *   provider: string;
 *   externalId: string | null;
 *   createdAt: number;
 * }} User
 */
export class AuthProvider {
  // eslint-disable-next-line class-methods-use-this
  id() { throw new Error('AuthProvider.id() must be implemented'); }
  // eslint-disable-next-line class-methods-use-this
  name() { throw new Error('AuthProvider.name() must be implemented'); }
  // eslint-disable-next-line class-methods-use-this
  canRegister() { return false; }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async authenticate(creds) {
    throw new Error('AuthProvider.authenticate() must be implemented');
  }
}

/**
 * 认证错误：UI 可读。
 */
export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AuthError';
    this.code = code; // e.g. 'invalid_credentials' | 'user_not_found' | 'email_taken'
  }
}

// ── Provider 注册中心 ─────────────────────────────────────
const _providers = new Map(); // id -> AuthProvider 实例

export function registerProvider(provider) {
  if (!(provider instanceof AuthProvider)) {
    throw new Error('registerProvider: arg must be AuthProvider instance');
  }
  _providers.set(provider.id(), provider);
}

export function getProvider(id) {
  return _providers.get(id) || null;
}

export function listProviders() {
  return Array.from(_providers.values()).map((p) => ({
    id: p.id(),
    name: p.name(),
    canRegister: p.canRegister(),
  }));
}
