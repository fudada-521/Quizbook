/**
 * 多设备进度合并（纯函数，客户端与服务端共用）。
 *
 * 设计取舍：
 * - 作答记录按时间取较新者，tries 取较大值（避免重复合并导致膨胀）；
 * - 收藏用「收藏时间 vs 取消收藏时间」判定，删除通过墓碑同步；
 * - 心得按题键 + id 求并集；
 * - 设置按 settingsAt 后写胜；
 * - resetAt 更晚的一方为基准，早于重置时间的数据在合并时丢弃。
 */
import type { AnswerRecord, DailyRecord, PersistedState, QuestionNote } from './types';
import { SCHEMA_VERSION, dateKey } from './types';
import { normalizeState } from './logic';

function cloneState(state: PersistedState): PersistedState {
  return JSON.parse(JSON.stringify(state)) as PersistedState;
}

function unionKeys(...records: Array<Record<string, unknown> | undefined>): string[] {
  const set = new Set<string>();
  for (const record of records) {
    if (!record) continue;
    for (const key of Object.keys(record)) set.add(key);
  }
  return [...set];
}

function mergeAnswers(a: PersistedState, b: PersistedState, resetAt: number) {
  const answers: Record<string, AnswerRecord> = {};
  for (const key of unionKeys(a.answers, b.answers)) {
    const left = a.answers[key];
    const right = b.answers[key];
    const record = !left ? right : !right ? left : left.t >= right.t ? left : right;
    if (!record) continue;
    // resetAt 之后的记录才有效；重置前的老记录不复活
    if (record.t <= resetAt) continue;
    answers[key] = {
      ok: record.ok,
      tries: Math.max(left?.tries ?? 0, right?.tries ?? 0),
      t: record.t,
    };
  }
  return answers;
}

function mergeWrong(a: PersistedState, b: PersistedState, answers: Record<string, AnswerRecord>, resetAt: number) {
  const wrong: Record<string, number> = {};
  // 只相信「重置时间最近」的那一端；两端都未重置/重置时间相同则取较大次数
  const sides = [a, b].filter((s) => s.resetAt === resetAt).map((s) => s.wrong);
  for (const side of sides) {
    for (const [key, count] of Object.entries(side)) {
      if (answers[key]?.ok) continue;
      wrong[key] = Math.max(wrong[key] ?? 0, count);
    }
  }
  return wrong;
}

function mergeFavorites(a: PersistedState, b: PersistedState) {
  const favorites: Record<string, number> = {};
  const favoriteRemovals: Record<string, number> = {};
  for (const key of unionKeys(a.favorites, b.favorites, a.favoriteRemovals, b.favoriteRemovals)) {
    const added = Math.max(a.favorites[key] ?? 0, b.favorites[key] ?? 0);
    const removed = Math.max(a.favoriteRemovals[key] ?? 0, b.favoriteRemovals[key] ?? 0);
    if (added > 0 && added > removed) {
      favorites[key] = added;
    } else if (removed > 0) {
      // 保留墓碑，让删除继续传播到其他设备
      favoriteRemovals[key] = removed;
    }
  }
  return { favorites, favoriteRemovals };
}

function mergeNotes(a: PersistedState, b: PersistedState) {
  const notes: Record<string, QuestionNote[]> = {};
  for (const key of unionKeys(a.notes, b.notes)) {
    const byId = new Map<string, QuestionNote>();
    for (const note of [...(a.notes[key] ?? []), ...(b.notes[key] ?? [])]) {
      if (!byId.has(note.id)) byId.set(note.id, note);
    }
    if (byId.size) {
      notes[key] = [...byId.values()].sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
    }
  }
  return notes;
}

function mergeDaily(a: PersistedState, b: PersistedState, resetAt: number) {
  const daily: Record<string, DailyRecord> = {};
  const resetDate = resetAt > 0 ? dateKey(resetAt) : '';
  for (const date of unionKeys(a.daily, b.daily)) {
    if (resetDate && date < resetDate) continue;
    const left = a.daily[date];
    const right = b.daily[date];
    daily[date] = {
      date,
      answered: Math.max(left?.answered ?? 0, right?.answered ?? 0),
      correct: Math.max(left?.correct ?? 0, right?.correct ?? 0),
      completed: Boolean(left?.completed || right?.completed),
      t: Math.max(left?.t ?? 0, right?.t ?? 0),
    };
  }
  return daily;
}

/** 合并两端进度；任意一端为 null 时返回另一端的副本 */
export function mergeStates(
  a: PersistedState | null,
  b: PersistedState | null,
): PersistedState {
  if (!a && !b) return normalizeState({});
  if (!a) return cloneState(normalizeState(b));
  if (!b) return cloneState(normalizeState(a));

  const local = normalizeState(a);
  const remote = normalizeState(b);
  const resetAt = Math.max(local.resetAt, remote.resetAt);

  const answers = mergeAnswers(local, remote, resetAt);
  const wrong = mergeWrong(local, remote, answers, resetAt);
  const { favorites, favoriteRemovals } = mergeFavorites(local, remote);
  const notes = mergeNotes(local, remote);
  const daily = mergeDaily(local, remote, resetAt);

  const settingsWinsLocal = local.settingsAt >= remote.settingsAt;
  const settings = settingsWinsLocal ? local.settings : remote.settings;

  const challengeMap = new Map<string, (typeof local.challenges)[number]>();
  for (const record of [...local.challenges, ...remote.challenges]) {
    if (record.finishedAt <= resetAt) continue;
    const existing = challengeMap.get(record.id);
    if (!existing || record.finishedAt >= existing.finishedAt) challengeMap.set(record.id, record);
  }
  const challenges = [...challengeMap.values()].sort((x, y) => x.finishedAt - y.finishedAt);

  const achievements: PersistedState['achievements'] = {};
  for (const id of unionKeys(local.achievements, remote.achievements)) {
    const left = local.achievements[id]?.unlockedAt ?? 0;
    const right = remote.achievements[id]?.unlockedAt ?? 0;
    const unlockedAt = Math.min(left || right, right || left);
    if (unlockedAt > 0) achievements[id] = { unlockedAt };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    answers,
    wrong,
    favorites,
    favoriteRemovals,
    notes,
    settings,
    settingsAt: Math.max(local.settingsAt, remote.settingsAt),
    daily,
    challenges,
    achievements,
    resetAt,
  };
}