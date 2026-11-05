/**
 * 平台实现：Web 端 localStorage 存储 + noop 同步后端。
 */
import { PersistedState, normalizeState } from '@megrez/core';
import { ProgressStore, NoopSyncBackend } from './index';

const KEY = 'megrez_quiz_v1';
/** 历史品牌键（新→旧），首次加载时自动迁移到新键 */
const LEGACY_KEYS = ['quizbook_quiz_v1', 'gaoxiang_quiz_v1'];

export const createLocalStorageStore = (storage?: Storage): ProgressStore => {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  return {
    kind: 'localStorage',
    async load() {
      if (!s) return null;
      try {
        const raw = s.getItem(KEY);
        if (raw) return normalizeState(JSON.parse(raw));

        // 旧键迁移：解析成功后再写入新键并删除旧键，避免数据损坏时丢失原数据
        for (const legacyKey of LEGACY_KEYS) {
          const legacy = s.getItem(legacyKey);
          if (!legacy) continue;
          const state = normalizeState(JSON.parse(legacy));
          s.setItem(KEY, JSON.stringify(state));
          s.removeItem(legacyKey);
          return state;
        }
        return null;
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