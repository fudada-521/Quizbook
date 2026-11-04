/**
 * 云端 API 客户端：设备码登录 + 进度同步 + 成就查询。
 * 只依赖 fetch，浏览器 / Tauri / Capacitor 通用。
 */
import type { PersistedState } from '@quiz/core';

export interface AuthUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface StoredAuth {
  token: string;
  user: AuthUser;
  serverUrl: string;
  savedAt: number;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export type DevicePoll =
  | { status: 'pending'; interval?: number }
  | { status: 'expired' }
  | { status: 'authorized'; token: string; user: AuthUser };

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

export interface ServerConfig {
  authEnabled: boolean;
  githubEnabled: boolean;
  devLogin: boolean;
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

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
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
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败 (${res.status})`;
    throw new ApiError(res.status, message, payload);
  }
  return payload as T;
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

  startDevice(): Promise<DeviceStart> {
    return request<DeviceStart>(this.url('/api/auth/device/start'), { method: 'POST', body: '{}' });
  }

  pollDevice(deviceCode: string): Promise<DevicePoll> {
    return request<DevicePoll>(this.url('/api/auth/device/poll'), {
      method: 'POST',
      body: JSON.stringify({ deviceCode }),
    });
  }

  me(): Promise<{ user: AuthUser }> {
    return request(this.url('/api/me'), { headers: this.authHeaders() });
  }

  pull(): Promise<RemoteState> {
    return request<RemoteState>(this.url('/api/sync'), { headers: this.authHeaders() });
  }

  push(state: PersistedState, baseVersion = 0): Promise<PushResult> {
    return request<PushResult>(this.url('/api/sync'), {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ state, baseVersion }),
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