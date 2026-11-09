/**
 * 进度存储适配层。
 * 定义统一的同步接口，供不同平台实现并在运行时注入：
 *   - Web / PWA：localStorage + (可选) IndexedDB 缓存
 *   - 桌面(Tauri)：本地文件（tauri-plugin-fs / store）
 *   - 移动(Capacitor)：原生 Preferences / Filesystem
 *   - 云同步：实现本接口即可接入任意后端（预留）
 */
import { PersistedState } from '@megrez/core';

export * from './banks';

export interface ProgressStore {
  readonly kind: string;
  /** 读取进度；不存在时返回 null */
  load(): Promise<PersistedState | null>;
  /** 保存进度 */
  save(state: PersistedState): Promise<void>;
  /** 可选：订阅外部变化（用于多窗口/云同步后的刷新） */
  subscribe?(cb: (state: PersistedState | null) => void): () => void;
}

export interface SyncBackend {
  readonly kind: string;
  /** 拉取远端进度；无远端数据返回 null */
  pull(): Promise<PersistedState | null>;
  /** 推送本地进度到远端 */
  push(state: PersistedState): Promise<void>;
}

/**
 * 同步协调器：简单「本地优先、远端可选」策略。
 * 预留字段 lastSyncAt 等在此不做合并算法，仅提供基础 pull/push 编排。
 */
export interface SyncManager {
  pullIfNewer(local: PersistedState | null): Promise<PersistedState | null>;
  push(state: PersistedState): Promise<void>;
}

/** 一个不做任何事的占位同步后端（云同步就绪，但默认未接入） */
export class NoopSyncBackend implements SyncBackend {
  readonly kind = 'noop';
  async pull(): Promise<PersistedState | null> {
    return null;
  }
  async push(_state: PersistedState): Promise<void> {}
}

export function createSyncManager(backend: SyncBackend): SyncManager {
  return {
    async pullIfNewer(local) {
      const remote = await backend.pull();
      if (!remote) return local;
      if (!local) return remote;
      // 简化：以更新内容（作答数）更大者为准，真实云同步可替换为时间戳/脏标记合并
      const newer = Object.keys(remote.answers).length >= Object.keys(local.answers).length;
      return newer ? remote : local;
    },
    async push(state) {
      await backend.push(state);
    },
  };
}