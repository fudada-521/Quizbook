/**
 * 后台 API 客户端：只依赖 fetch。
 * 开发时 Vite 代理 /api 到 127.0.0.1:8787；生产同域部署，BASE 留空即可。
 */
const BASE = (import.meta.env.VITE_MEGREZ_SERVER ?? '').replace(/\/+$/, '');

export interface Membership {
  active: boolean;
  expiresAt: number;
}

export interface AdminUser {
  id: string;
  username: string;
  name: string | null;
  role: 'user' | 'admin';
  membership: Membership;
}

export interface BankSummary {
  id: string;
  name: string;
  subtitle: string;
  version: number;
  questionCount: number;
  chapterCount: number;
  updatedAt: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : '网络不可用');
  }

  const text = await res.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败 (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return payload as T;
}

export function login(username: string, password: string): Promise<{ token: string; user: AdminUser }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function me(token: string): Promise<{ user: AdminUser }> {
  return request('/api/me', {}, token);
}

export function listBanks(): Promise<BankSummary[]> {
  return request('/api/banks');
}