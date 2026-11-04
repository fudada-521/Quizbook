/**
 * 登录态与服务器地址的本地存储。
 * Web / Tauri / Capacitor 的 WebView 都有 localStorage，先用统一实现；
 * 若后续要接系统钥匙串，只需替换这里的 AuthStore 实现。
 */
import type { StoredAuth } from './http';

const AUTH_KEY = 'quizbook_auth_v1';
const SERVER_KEY = 'quizbook_server_v1';
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

export interface AuthStore {
  load(): StoredAuth | null;
  save(auth: StoredAuth): void;
  clear(): void;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isStoredAuth(value: unknown): value is StoredAuth {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredAuth>;
  return (
    typeof v.token === 'string' &&
    typeof v.serverUrl === 'string' &&
    !!v.user &&
    typeof v.user.id === 'string'
  );
}

export function createLocalAuthStore(storage?: Storage): AuthStore {
  const s = storage ?? defaultStorage();
  return {
    load() {
      if (!s) return null;
      try {
        const raw = s.getItem(AUTH_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return isStoredAuth(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(auth) {
      try {
        s?.setItem(AUTH_KEY, JSON.stringify(auth));
      } catch {
        // 存储不可用时静默失败
      }
    },
    clear() {
      try {
        s?.removeItem(AUTH_KEY);
      } catch {
        // ignore
      }
    },
  };
}

/** 推断默认服务器地址：同域部署优先，开发端口回退到 8787，原生端需用户手动配置 */
export function defaultServerUrl(): string {
  const envUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_QUIZ_SERVER_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');

  const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean }; __TAURI_INTERNALS__?: unknown };
  if (g.Capacitor?.isNativePlatform?.() || g.__TAURI_INTERNALS__) return DEFAULT_SERVER_URL;

  if (typeof location !== 'undefined') {
    const { protocol, hostname, port, origin } = location;
    if ((protocol === 'http:' || protocol === 'https:') && hostname !== 'tauri.localhost') {
      if (port === '5173' || port === '4173') return `${protocol}//${hostname}:8787`;
      return origin;
    }
  }
  return DEFAULT_SERVER_URL;
}

export function loadServerUrl(storage?: Storage): string {
  const s = storage ?? defaultStorage();
  try {
    const saved = s?.getItem(SERVER_KEY);
    if (saved) return saved.replace(/\/+$/, '');
  } catch {
    // ignore
  }
  return defaultServerUrl();
}

export function saveServerUrl(url: string, storage?: Storage): void {
  const s = storage ?? defaultStorage();
  try {
    s?.setItem(SERVER_KEY, url.replace(/\/+$/, ''));
  } catch {
    // ignore
  }
}