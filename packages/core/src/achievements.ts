/**
 * 成就系统：10 个核心成就 + 进度计算。
 * 规则只依赖 PersistedState 与题库（章节通关需要知道每章有哪些题），
 * 因此客户端离线也能即时解锁；服务端同步时会重新校验并合并。
 */
import type {
  AchievementUnlock,
  PersistedState,
  QuizData,
} from './types';
import { dateKey, qkey } from './types';

export type AchievementCategory = 'progress' | 'habit' | 'collection' | 'challenge';

export interface AchievementStats {
  answered: number;
  correct: number;
  bestStreak: number;
  currentStreak: number;
  chaptersCleared: number;
  totalChapters: number;
  favorites: number;
  notes: number;
  dailyCompleted: number;
  timedCompleted: number;
  examPassed: boolean;
  examBestScore: number;
  challengeCount: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  target: number;
  /** 当前进度值（未封顶，UI 自行夹到 target） */
  value: (stats: AchievementStats) => number;
  /** 进度单位，用于 UI 展示 */
  unit?: string;
}

export interface AchievementStatus extends AchievementDef {
  current: number;
  unlocked: boolean;
  unlockedAt: number | null;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

function activeDays(state: PersistedState): number[] {
  const days = new Set<number>();
  for (const record of Object.values(state.daily)) {
    if (record.answered > 0 || record.completed) days.add(dayNumber(record.date));
  }
  return [...days].sort((a, b) => a - b);
}

function streaks(days: number[]): { best: number; current: number } {
  if (!days.length) return { best: 0, current: 0 };
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const today = dayNumber(dateKey());
  const set = new Set(days);
  let cursor = set.has(today) ? today : set.has(today - 1) ? today - 1 : null;
  let current = 0;
  while (cursor !== null && set.has(cursor)) {
    current += 1;
    cursor -= 1;
  }
  return { best, current };
}

export function achievementStats(state: PersistedState, data: QuizData): AchievementStats {
  const answers = Object.values(state.answers);
  const correct = answers.filter((answer) => answer.ok).length;

  const byChapter = new Map<number, boolean>();
  for (const question of data.questions) {
    const cleared = Boolean(state.answers[qkey(question)]?.ok);
    byChapter.set(question.c, (byChapter.get(question.c) ?? true) && cleared);
  }
  const chaptersCleared = [...byChapter.values()].filter(Boolean).length;

  const { best, current } = streaks(activeDays(state));

  const exams = state.challenges.filter((record) => record.kind === 'exam');
  const dailyCompleted = Object.values(state.daily).filter((record) => record.completed).length;

  return {
    answered: answers.length,
    correct,
    bestStreak: best,
    currentStreak: current,
    chaptersCleared,
    totalChapters: byChapter.size,
    favorites: Object.keys(state.favorites).length,
    notes: Object.values(state.notes).reduce((sum, list) => sum + list.length, 0),
    dailyCompleted,
    timedCompleted: state.challenges.filter((record) => record.kind === 'timed').length,
    examPassed: exams.some((record) => record.passed),
    examBestScore: exams.reduce((max, record) => Math.max(max, record.score), 0),
    challengeCount: state.challenges.length,
  };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_steps',
    title: '迈出第一步',
    description: '完成第一次作答',
    category: 'progress',
    target: 1,
    value: (s) => s.answered,
    unit: '题',
  },
  {
    id: 'correct_50',
    title: '小有心得',
    description: '累计答对 50 题',
    category: 'progress',
    target: 50,
    value: (s) => s.correct,
    unit: '题',
  },
  {
    id: 'correct_200',
    title: '渐入佳境',
    description: '累计答对 200 题',
    category: 'progress',
    target: 200,
    value: (s) => s.correct,
    unit: '题',
  },
  {
    id: 'chapter_clear',
    title: '章节通关',
    description: '任意一个章节的题目全部答对',
    category: 'progress',
    target: 1,
    value: (s) => s.chaptersCleared,
    unit: '章',
  },
  {
    id: 'streak_3',
    title: '三日不辍',
    description: '连续 3 天保持练习',
    category: 'habit',
    target: 3,
    value: (s) => s.bestStreak,
    unit: '天',
  },
  {
    id: 'streak_7',
    title: '一周坚持',
    description: '连续 7 天保持练习',
    category: 'habit',
    target: 7,
    value: (s) => s.bestStreak,
    unit: '天',
  },
  {
    id: 'note_first',
    title: '温故知新',
    description: '写下第一条题目心得',
    category: 'collection',
    target: 1,
    value: (s) => s.notes,
    unit: '条',
  },
  {
    id: 'favorite_10',
    title: '收藏成癖',
    description: '收藏 10 道题',
    category: 'collection',
    target: 10,
    value: (s) => s.favorites,
    unit: '题',
  },
  {
    id: 'daily_first',
    title: '今日份完成',
    description: '完成一次每日一练',
    category: 'challenge',
    target: 1,
    value: (s) => s.dailyCompleted,
    unit: '次',
  },
  {
    id: 'exam_pass',
    title: '金榜题名',
    description: '模拟考达到 45 分及格线',
    category: 'challenge',
    target: 1,
    value: (s) => (s.examPassed ? 1 : 0),
    unit: '次',
  },
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((item) => item.id === id);
}

export function achievementProgress(state: PersistedState, data: QuizData): AchievementStatus[] {
  const stats = achievementStats(state, data);
  return ACHIEVEMENTS.map((def) => {
    const current = def.value(stats);
    const unlockedAt = state.achievements[def.id]?.unlockedAt ?? null;
    return {
      ...def,
      current,
      unlocked: unlockedAt !== null || current >= def.target,
      unlockedAt,
    };
  });
}

/** 计算本次新达成的成就（不修改 state） */
export function evaluateAchievements(
  state: PersistedState,
  data: QuizData,
  now = Date.now(),
): Record<string, AchievementUnlock> {
  const stats = achievementStats(state, data);
  const unlocked: Record<string, AchievementUnlock> = {};
  for (const def of ACHIEVEMENTS) {
    if (state.achievements[def.id]) continue;
    if (def.value(stats) >= def.target) unlocked[def.id] = { unlockedAt: now };
  }
  return unlocked;
}

/** 把新解锁的成就写入 state（原地修改），返回新解锁 id 列表 */
export function applyAchievements(
  state: PersistedState,
  data: QuizData,
  now = Date.now(),
): string[] {
  const unlocked = evaluateAchievements(state, data, now);
  const ids = Object.keys(unlocked);
  for (const id of ids) state.achievements[id] = unlocked[id];
  return ids;
}