/**
 * 云端 API 客户端：账号密码登录 + 题库目录/下载 + 按题库同步 + 会员。
 * 只依赖 fetch，浏览器 / Tauri / Capacitor 通用。
 */
import type { PersistedState, QuizData } from '@megrez/core';

export type UserRole = 'user' | 'admin';

export interface MembershipState {
  active: boolean;
  expiresAt: number | null;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string | null;
  role?: UserRole;
  membership?: MembershipState;
}

export interface StoredAuth {
  token: string;
  user: AuthUser;
  serverUrl: string;
  savedAt: number;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

/** 服务端已发布题库的元数据 */
export interface RemoteBankMeta {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  version: number;
  questionCount: number;
  chapterCount: number;
  updatedAt: number;
}

export interface RemoteState {
  state: PersistedState | null;
  version: number;
  updatedAt: number | null;
}

export interface PushResult {
  state: PersistedState;
  version: number;
  updatedAt: number;
  unlockedAchievements: string[];
}

export interface DownloadResult {
  data: QuizData;
  etag: string | null;
}

export interface RedeemResult extends MembershipState {
  days: number;
}

export interface ServerConfig {
  authEnabled: boolean;
  registerEnabled: boolean;
  publicUrl: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestWithMeta<T>(
  url: string,
  init: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : '网络不可用');
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    // 优先展示服务端给人类看的 message；没有时退回错误码
    let message = `请求失败 (${res.status})`;
    if (payload && typeof payload === 'object') {
      const body = payload as { message?: unknown; error?: unknown };
      if (typeof body.message === 'string' && body.message) message = body.message;
      else if ('error' in body) message = String(body.error);
    }
    throw new ApiError(res.status, message, payload);
  }
  return { data: payload as T, headers: res.headers };
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  return (await requestWithMeta<T>(url, init)).data;
}

export class CloudClient {
  readonly serverUrl: string;
  readonly token: string | null;

  constructor(serverUrl: string, token: string | null = null) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private url(path: string): string {
    return `${this.serverUrl}${path}`;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  getConfig(): Promise<ServerConfig> {
    return request<ServerConfig>(this.url('/api/config'));
  }

  login(username: string, password: string): Promise<AuthResult> {
    return request<AuthResult>(this.url('/api/auth/login'), {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  register(username: string, password: string): Promise<AuthResult> {
    return request<AuthResult>(this.url('/api/auth/register'), {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  me(): Promise<{ user: AuthUser }> {
    return request(this.url('/api/me'), { headers: this.authHeaders() });
  }

  // ---------- 题库目录与下载 ----------

  /** 已发布题库列表（公开接口，不需要登录） */
  listBanks(): Promise<RemoteBankMeta[]> {
    return request<RemoteBankMeta[]>(this.url('/api/banks'));
  }

  /** 下载完整题库包；内置题库公开，其他题库需要会员 */
  async downloadBank(bankId: string): Promise<DownloadResult> {
    const { data, headers } = await requestWithMeta<QuizData>(
      this.url(`/api/banks/${encodeURIComponent(bankId)}/bundle`),
      { headers: this.authHeaders() },
    );
    return { data, etag: headers.get('ETag') };
  }

  // ---------- 按题库同步 ----------

  pullBankState(bankId: string): Promise<RemoteState> {
    return request<RemoteState>(this.url(`/api/banks/${encodeURIComponent(bankId)}/sync`), {
      headers: this.authHeaders(),
    });
  }

  pushBankState(
    bankId: string,
    state: PersistedState,
    baseVersion = 0,
  ): Promise<PushResult> {
    return request<PushResult>(this.url(`/api/banks/${encodeURIComponent(bankId)}/sync`), {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ state, baseVersion }),
    });
  }

  async deleteBankState(bankId: string): Promise<void> {
    await request(this.url(`/api/banks/${encodeURIComponent(bankId)}/sync`), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  // ---------- 会员 ----------

  getMembership(): Promise<MembershipState> {
    return request<MembershipState>(this.url('/api/membership'), {
      headers: this.authHeaders(),
    });
  }

  redeem(code: string): Promise<RedeemResult> {
    return request<RedeemResult>(this.url('/api/membership/redeem'), {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ code }),
    });
  }

  achievements(): Promise<unknown> {
    return request(this.url('/api/achievements'), { headers: this.authHeaders() });
  }

  async logout(): Promise<void> {
    try {
      await request(this.url('/api/auth/logout'), {
        method: 'POST',
        headers: this.authHeaders(),
        body: '{}',
      });
    } catch {
      // token 已在本地删除，服务端吊销失败不影响退出
    }
  }
}