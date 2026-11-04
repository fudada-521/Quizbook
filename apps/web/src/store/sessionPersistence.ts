/**
 * 未完成练习会话的本地快照。
 * 只保存题目的唯一键与作答状态，不重复存储题干，数据仍以 questions.json 为准。
 */
import {
  qkey,
  type Question,
  type QuizData,
  type QuizSession,
  type SessionItem,
  type SessionMode,
} from '@quiz/core';

const KEY = 'quizbook_quiz_session_v1';
/** 旧品牌时期的会话键，读取时自动迁移 */
const LEGACY_KEY = 'gaoxiang_quiz_session_v1';

interface StoredItem {
  k: string;
  m: [number, number, number, number];
  d: boolean;
  p: number | null;
  l: number;
}

interface StoredSession {
  v: 1 | 2;
  title: string;
  reviewOnly: boolean;
  idx: number;
  items: StoredItem[];
  updatedAt: number;
  /** v2：挑战/模拟考的会话信息 */
  mode?: SessionMode;
  startedAt?: number;
  durationMs?: number;
  date?: string;
  seed?: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isMap(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && n >= 0 && n <= 3) &&
    new Set(v).size === 4
  );
}

export function saveSession(session: QuizSession): void {
  const s = storage();
  if (!s) return;
  const payload: StoredSession = {
    v: 2,
    title: session.title,
    reviewOnly: session.reviewOnly,
    idx: session.idx,
    updatedAt: Date.now(),
    items: session.list.map((it) => ({
      k: qkey(it.q),
      m: it.map,
      d: it.done,
      p: it.pick,
      l: it.lastPick,
    })),
    mode: session.mode,
    startedAt: session.startedAt,
    durationMs: session.durationMs,
    date: session.date,
    seed: session.seed,
  };
  try {
    s.setItem(KEY, JSON.stringify(payload));
  } catch {
    // 隐私模式或存储空间不足时静默失败，不影响答题
  }
}

export function loadSession(data: QuizData): QuizSession | null {
  const s = storage();
  if (!s) return null;
  try {
    let raw = s.getItem(KEY);
    let fromLegacy = false;
    if (!raw) {
      raw = s.getItem(LEGACY_KEY);
      fromLegacy = raw != null;
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if ((parsed.v !== 1 && parsed.v !== 2) || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }

    const byKey = new Map<string, Question>(data.questions.map((q) => [qkey(q), q]));
    const list: SessionItem[] = [];
    for (const it of parsed.items) {
      if (!it || typeof it.k !== 'string' || !isMap(it.m)) return null;
      const q = byKey.get(it.k);
      if (!q) return null;
      list.push({
        q,
        map: it.m,
        done: !!it.d,
        pick: typeof it.p === 'number' && it.p >= 0 && it.p <= 3 ? it.p : null,
        lastPick: typeof it.l === 'number' ? it.l : -1,
      });
    }

    const idx = Math.min(Math.max(parsed.idx ?? 0, 0), list.length - 1);
    const session: QuizSession = {
      title: typeof parsed.title === 'string' ? parsed.title : '继续练习',
      reviewOnly: !!parsed.reviewOnly,
      idx,
      list,
      mode: parsed.mode,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : undefined,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      date: typeof parsed.date === 'string' ? parsed.date : undefined,
      seed: typeof parsed.seed === 'number' ? parsed.seed : undefined,
    };

    // 旧键迁移：确认快照可用后再写入新键，失败不影响本次继续练习
    if (fromLegacy) {
      try {
        s.setItem(KEY, raw);
        s.removeItem(LEGACY_KEY);
      } catch {
        // 隐私模式或存储空间不足时忽略
      }
    }

    return session;
  } catch {
    return null;
  }
}

export function clearSavedSession(): void {
  try {
    const s = storage();
    s?.removeItem(KEY);
    s?.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}