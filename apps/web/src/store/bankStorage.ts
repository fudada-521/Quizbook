/**
 * 题库维度的本地存储键与一次性迁移。
 *
 * 进度 schema 不变，题库维度只体现在 localStorage 键上：
 *   megrez_quiz_v1:<bankId>
 *   megrez_quiz_sessions_v2:<bankId>
 *
 * 迁移只复制、不删除旧键，并用 `megrez_migrated_v7` 保证幂等。
 */
import { BUILTIN_BANK_ID } from '@megrez/core';

export const PROGRESS_PREFIX = 'megrez_quiz_v1';
export const SESSIONS_PREFIX = 'megrez_quiz_sessions_v2';
export const CURRENT_BANK_KEY = 'megrez_bank_current_v1';
export const MIGRATED_KEY = 'megrez_migrated_v7';

/** 旧版本单份进度键（新→旧），迁移时整份复制到 builtin */
const LEGACY_PROGRESS_KEYS = ['megrez_quiz_v1', 'quizbook_quiz_v1', 'gaoxiang_quiz_v1'];
/** 上一品牌时期的多会话键，格式未变 */
const LEGACY_SESSIONS_KEYS = ['megrez_quiz_sessions_v2', 'quizbook_quiz_sessions_v2'];

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function bankProgressKey(bankId: string): string {
  return `${PROGRESS_PREFIX}:${bankId}`;
}

export function bankSessionsKey(bankId: string): string {
  return `${SESSIONS_PREFIX}:${bankId}`;
}

/** 当前选中的题库；没有记录或记录损坏时回到内置题库 */
export function loadCurrentBankId(): string {
  const s = storage();
  try {
    const id = s?.getItem(CURRENT_BANK_KEY);
    return id && id.trim() ? id : BUILTIN_BANK_ID;
  } catch {
    return BUILTIN_BANK_ID;
  }
}

export function saveCurrentBankId(bankId: string): void {
  const s = storage();
  try {
    s?.setItem(CURRENT_BANK_KEY, bankId);
  } catch {
    // 存储不可用时静默失败，下次仍从内置题库开始
  }
}

/** 把一个旧键整份搬到新键；目标已存在时以目标为准 */
function copyKey(s: Storage, from: string, to: string): boolean {
  try {
    if (s.getItem(to) != null) return false;
    const raw = s.getItem(from);
    if (raw == null) return false;
    s.setItem(to, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * 首次启动把旧版单题库数据复制到 `builtin` 桶。
 * 返回是否发生了复制，方便调试；重复调用因标记存在而直接返回 false。
 */
export function migrateBankStorage(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (s.getItem(MIGRATED_KEY)) return false;

    const progressTarget = bankProgressKey(BUILTIN_BANK_ID);
    for (const key of LEGACY_PROGRESS_KEYS) {
      if (copyKey(s, key, progressTarget)) break;
    }

    const sessionsTarget = bankSessionsKey(BUILTIN_BANK_ID);
    for (const key of LEGACY_SESSIONS_KEYS) {
      if (copyKey(s, key, sessionsTarget)) break;
    }

    s.setItem(MIGRATED_KEY, String(Date.now()));
    return true;
  } catch {
    // 隐私模式等场景写不进去，保持旧逻辑可用
    return false;
  }
}

/** 删除某个题库在本机的进度与会话（题库包本身由 BankRepository 删除） */
export function clearBankLocalData(bankId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(bankProgressKey(bankId));
    s.removeItem(bankSessionsKey(bankId));
  } catch {
    // ignore
  }
}