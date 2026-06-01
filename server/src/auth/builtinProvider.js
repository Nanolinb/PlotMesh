/**
 * server/src/auth/builtinProvider.js · 邮箱密码 Provider
 * ---------------------------------------------------------------
 * v2.0-α Phase A 步 1.1：内置认证后端，仅靠 server 自己的 users.json。
 * 后续 Google/SSO/LDAP 是同样接口的另一个实现。
 */
import { AuthProvider, AuthError } from './AuthProvider.js';
import {
  createBuiltinUser,
  verifyBuiltinPassword,
  hasAnyUser,
} from './usersStore.js';

export class BuiltinProvider extends AuthProvider {
  // eslint-disable-next-line class-methods-use-this
  id() { return 'builtin'; }
  // eslint-disable-next-line class-methods-use-this
  name() { return '邮箱密码'; }
  // eslint-disable-next-line class-methods-use-this
  canRegister() { return true; }

  /**
   * @param {{email: string, password: string}} creds
   * @returns publicUser
   */
  // eslint-disable-next-line class-methods-use-this
  async authenticate(creds) {
    const email = (creds?.email || '').trim();
    const password = creds?.password || '';
    if (!email || !password) {
      throw new AuthError('missing_credentials', '邮箱和密码不能为空');
    }
    const user = await verifyBuiltinPassword(email, password);
    if (!user) {
      throw new AuthError('invalid_credentials', '邮箱或密码错误');
    }
    return user;
  }

  /**
   * 注册新用户（builtin 专属，AuthProvider 接口未定义但 builtin 暴露）。
   * @returns publicUser
   */
  // eslint-disable-next-line class-methods-use-this
  async register({ email, password, name }) {
    const _email = (email || '').trim();
    const _password = password || '';
    if (!_email || !_password) {
      throw new AuthError('missing_credentials', '邮箱和密码不能为空');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_email)) {
      throw new AuthError('invalid_email', '邮箱格式不正确');
    }
    if (_password.length < 6) {
      throw new AuthError('weak_password', '密码至少 6 位');
    }
    try {
      return await createBuiltinUser({ email: _email, password: _password, name });
    } catch (err) {
      if (err.code === 'email_taken') {
        throw new AuthError('email_taken', '该邮箱已注册');
      }
      throw err;
    }
  }

  /** 当前是否还没有任何用户（首位注册者无需登录即可创建） */
  // eslint-disable-next-line class-methods-use-this
  async hasAnyUser() {
    return hasAnyUser();
  }
}

// 默认单例
export const builtinProvider = new BuiltinProvider();
