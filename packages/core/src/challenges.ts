/**
 * 挑战模式：每日一练、限时挑战、模拟考。
 * 抽题与成绩计算都是纯函数，客户端与服务端可复用。
 */
import type {
  ChallengeKind,
  ChallengeRecord,
  PersistedState,
  Question,
  QuizData,
  QuizSession,
} from './types';
import { dateKey } from './types';
import { shuffle } from './logic';

export const DAILY_COUNT = 10;
export const TIMED_COUNT = 20;
export const TIMED_DURATION_MS = 10 * 60 * 1000;
export const EXAM_COUNT = 75;
export const EXAM_DURATION_MS = 150 * 60 * 1000;
export const EXAM_PASS_SCORE = 45;

/** 32 位字符串哈希（FNV-1a 变体），用于按日期生成稳定种子 */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 可复现的伪随机数生成器 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 每日一练：同一天在任何设备上抽到的题一致 */
export function dailyQuestions(
  data: QuizData,
  date = dateKey(),
  count = DAILY_COUNT,
): Question[] {
  if (!data.questions.length) return [];
  const seed = hashString(`daily:${date}`);
  return seededShuffle(data.questions, seed).slice(0, Math.min(count, data.questions.length));
}

/** 限时挑战 / 模拟考抽题（真随机） */
export function randomQuestions(data: QuizData, count: number): Question[] {
  if (!data.questions.length) return [];
  return shuffle(data.questions).slice(0, Math.min(count, data.questions.length));
}

/** 某次会话的得分 */
export function scoreSession(session: QuizSession): { score: number; total: number } {
  let score = 0;
  for (const item of session.list) {
    if (item.done && item.lastPick >= 0 && item.map[item.lastPick] === item.q.a) score += 1;
  }
  return { score, total: session.list.length };
}

export function challengeKindOf(session: QuizSession): ChallengeKind | null {
  if (session.mode === 'daily' || session.mode === 'timed' || session.mode === 'exam') {
    return session.mode;
  }
  return null;
}

/** 由会话生成成绩记录；非挑战模式返回 null */
export function makeChallengeRecord(
  session: QuizSession,
  finishedAt = Date.now(),
): ChallengeRecord | null {
  const kind = challengeKindOf(session);
  if (!kind) return null;
  const { score, total } = scoreSession(session);
  const startedAt = session.startedAt ?? finishedAt;
  const elapsed = Math.max(0, finishedAt - startedAt);
  const duration = session.durationMs ? Math.min(elapsed, session.durationMs) : elapsed;
  return {
    id: `${kind}-${session.date ?? dateKey(startedAt)}-${startedAt}`,
    kind,
    date: session.date ?? dateKey(startedAt),
    score,
    total,
    durationMs: duration,
    finishedAt,
    ...(kind === 'exam' ? { passed: score >= EXAM_PASS_SCORE } : {}),
  };
}

/** 追加一次成绩（同 id 不重复记录），原地修改 */
export function recordChallenge(state: PersistedState, record: ChallengeRecord): boolean {
  if (state.challenges.some((item) => item.id === record.id)) return false;
  state.challenges.push(record);
  state.challenges.sort((a, b) => a.finishedAt - b.finishedAt);
  return true;
}

/** 当天是否已经完成过每日一练 */
export function dailyCompletedOn(state: PersistedState, date = dateKey()): boolean {
  return Boolean(state.daily[date]?.completed);
}