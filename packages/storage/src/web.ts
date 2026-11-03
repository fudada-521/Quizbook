/**
 * 平台实现：Web 端 localStorage 存储 + noop 同步后端。
 */
import { PersistedState, normalizeState } from '@quiz/core';
import { ProgressStore, NoopSyncBackend } from './index';

const KEY = 'gaoxiang_quiz_v1';

export const createLocalStorageStore = (storage?: Storage): ProgressStore => {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  return {
    kind: 'localStorage',
    async load() {
      if (!s) return null;
      try {
        const raw = s.getItem(KEY);
        return raw ? normalizeState(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    async save(state: PersistedState) {
      s?.setItem(KEY, JSON.stringify(state));
    },
    subscribe(cb) {
      const h = (e: StorageEvent) => {
        if (e.key === KEY) {
          try {
            cb(e.newValue ? normalizeState(JSON.parse(e.newValue)) : null);
          } catch {
            cb(null);
          }
        }
      };
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  };
};

/** 默认同步后端（云同步就绪占位） */
export const DEFAULT_SYNC_BACKEND = new NoopSyncBackend();