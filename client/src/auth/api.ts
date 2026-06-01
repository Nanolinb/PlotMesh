/**
 * client/src/auth/api.ts · v2.0-α Phase A 步 1.5
 * ---------------------------------------------------------------
 * 带 JWT 自动注入的 fetch 封装。
 *
 * 用法：
 *   import { authFetch } from './auth/api';
 *   const res = await authFetch('/api/some/new/route');
 *
 * 与现有 fetch 的区别：
 *   - 旧 fetch（syncAdapter / storage 等）继续走 legacy token 鉴权，不改
 *   - authFetch 专门给 v2.0 新接口用（/api/auth/*、未来 /api/me 等）
 */
import { getCurrentToken } from './authContext';

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = getCurrentToken();
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}
