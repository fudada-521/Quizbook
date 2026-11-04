/**
 * 成就系统：50 个成就，分为进度 / 习惯 / 收藏与心得 / 挑战 / 准确率 / 隐藏六类。
 * 规则只依赖 PersistedState 与题库（章节通关需要知道每章有哪些题），
 * 因此客户端离线也能即时解锁；服务端同步时会重新校验并合并。
 *
 * 同一目标的多级成就通过 `series` 归组，`tier` 表示级别（1 青铜 → 5 钻石）；
 * 隐藏成就解锁前只显示 `hint`，不泄露具体条件。
 */
import type {
  AchievementUnlock,
  PersistedState,
  QuizData,
} from './types';
import { dateKey, qkey } from './types';

export type AchievementCategory =
  | 'progress'
  | 'habit'
  | 'collection'
  | 'challenge'
  | 'accuracy'
  | 'hidden';

export type AchievementTier = 1 | 2 | 3 | 4 | 5;

export interface AchievementStats {
  answered: number;
  correct: number;
  totalQuestions: number;
  /** 当前正确率（0-100，按已作答题目中最近一次答对的比例） */
  accuracy: number;
  /** 累计作答次数（每日记录求和，清空记录后重新统计） */
  totalAttempts: number;
  bestStreak: number;
  currentStreak: number;
  /** 有练习记录的天数 */
  studyDays: number;
  chaptersCleared: number;
  totalChapters: number;
  favorites: number;
  notes: number;
  dailyCompleted: number;
  timedCompleted: number;
  timedBestScore: number;
  timedPerfect: boolean;
  timedFast: boolean;
  examsPassed: number;
  examPassed: boolean;
  examBestScore: number;
  examPerfect: boolean;
  challengeCount: number;
  wrongCount: number;
  /** 单日最高作答量 */
  maxDailyAnswered: number;
  nightOwl: boolean;
  earlyBird: boolean;
  weekendWarrior: boolean;
  grandSlam: boolean;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  target: number;
  /** 动态目标（如全题库题数），优先于 target */
  targetOf?: (stats: AchievementStats) => number;
  /** 当前进度值（未封顶，UI 自行夹到 target） */
  value: (stats: AchievementStats) => number;
  /** 进度单位，用于 UI 展示 */
  unit?: string;
  /** 多级成就所属系列 */
  series?: string;
  /** 系列内级别：1 青铜 / 2 白银 / 3 黄金 / 4 铂金 / 5 钻石 */
  tier?: AchievementTier;
  /** 隐藏成就：解锁前不显示名称与具体条件 */
  hidden?: boolean;
  /** 隐藏成就解锁前的提示文案 */
  hint?: string;
}

export interface AchievementStatus extends AchievementDef {
  current: number;
  unlocked: boolean;
  unlockedAt: number | null;
}

/** 多级成就的系列名称 */
export const SERIES_LABEL: Record<string, string> = {
  mastery: '答题进阶',
  volume: '累计作答',
  chapter: '章节通关',
  streak: '连续练习',
  days: '学习天数',
  favorite: '收藏',
  notes: '题目心得',
  daily: '每日一练',
  timed: '限时挑战',
  exam: '模拟考',
  accuracy: '正确率',
};

/** 级别名称 */
export const TIER_LABEL: Record<AchievementTier, string> = {
  1: '青铜',
  2: '白银',
  3: '黄金',
  4: '铂金',
  5: '钻石',
};

/** 限时挑战「疾风骤雨」的用时门槛：6 分钟 */
const FAST_TIMED_MS = 6 * 60 * 1000;

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

/** 是否存在同一个周末（周六 + 周日）都在练习 */
function hasFullWeekend(days: number[]): boolean {
  // 以周六的日期作为周末键：周日归到前一天（周六）
  const saturdays = new Set<number>();
  const sundays = new Set<number>();
  for (const day of days) {
    // 1970-01-01 是周四：+4 后 0=周日、6=周六
    const weekday = ((day + 4) % 7 + 7) % 7;
    if (weekday === 6) saturdays.add(day);
    if (weekday === 0) sundays.add(day - 1);
  }
  for (const day of saturdays) {
    if (sundays.has(day)) return true;
  }
  return false;
}

export function achievementStats(state: PersistedState, data: QuizData): AchievementStats {
  const answers = Object.values(state.answers);
  const correct = answers.filter((answer) => answer.ok).length;
  const totalQuestions = data.questions.length;
  const accuracy = answers.length ? Math.round((correct / answers.length) * 100) : 0;

  const byChapter = new Map<number, boolean>();
  for (const question of data.questions) {
    const cleared = Boolean(state.answers[qkey(question)]?.ok);
    byChapter.set(question.c, (byChapter.get(question.c) ?? true) && cleared);
  }
  const chaptersCleared = [...byChapter.values()].filter(Boolean).length;

  const days = activeDays(state);
  const { best, current } = streaks(days);

  const dailyRecords = Object.values(state.daily);
  const totalAttempts = dailyRecords.reduce((sum, record) => sum + record.answered, 0);
  const maxDailyAnswered = dailyRecords.reduce(
    (max, record) => Math.max(max, record.answered),
    0,
  );
  const dailyCompleted = dailyRecords.filter((record) => record.completed).length;

  const timed = state.challenges.filter((record) => record.kind === 'timed');
  const timedBestScore = timed.reduce((max, record) => Math.max(max, record.score), 0);
  const timedPerfect = timed.some((record) => record.total > 0 && record.score >= record.total);
  const timedFast = timed.some(
    (record) =>
      record.total >= 20 &&
      record.score >= record.total &&
      record.durationMs > 0 &&
      record.durationMs <= FAST_TIMED_MS,
  );

  const exams = state.challenges.filter((record) => record.kind === 'exam');
  const examsPassed = exams.filter((record) => record.passed).length;
  const examBestScore = exams.reduce((max, record) => Math.max(max, record.score), 0);
  const examPerfect = exams.some((record) => record.total > 0 && record.score >= record.total);

  // 隐藏成就的时间线索：作答记录只保留每题最近一次的时间戳
  const hours = answers.map((answer) => new Date(answer.t).getHours());
  const nightOwl = hours.some((hour) => hour >= 0 && hour < 5);
  const earlyBird = hours.some((hour) => hour >= 5 && hour < 7);

  const completedDates = new Set(
    dailyRecords.filter((record) => record.completed).map((record) => record.date),
  );
  const timedDates = new Set(timed.map((record) => record.date));
  const examDates = new Set(exams.map((record) => record.date));
  const grandSlam = [...completedDates].some(
    (date) => timedDates.has(date) && examDates.has(date),
  );

  return {
    answered: answers.length,
    correct,
    totalQuestions,
    accuracy,
    totalAttempts,
    bestStreak: best,
    currentStreak: current,
    studyDays: days.length,
    chaptersCleared,
    totalChapters: byChapter.size,
    favorites: Object.keys(state.favorites).length,
    notes: Object.values(state.notes).reduce((sum, list) => sum + list.length, 0),
    dailyCompleted,
    timedCompleted: timed.length,
    timedBestScore,
    timedPerfect,
    timedFast,
    examsPassed,
    examPassed: examsPassed > 0,
    examBestScore,
    examPerfect,
    challengeCount: state.challenges.length,
    wrongCount: Object.keys(state.wrong).length,
    maxDailyAnswered,
    nightOwl,
    earlyBird,
    weekendWarrior: hasFullWeekend(days),
    grandSlam,
  };
}

type TierSpec = Omit<AchievementDef, 'category' | 'series' | 'tier'>;

function tiered(
  category: AchievementCategory,
  series: string,
  tiers: TierSpec[],
): AchievementDef[] {
  return tiers.map((spec, index) => ({
    ...spec,
    category,
    series,
    tier: Math.min(index + 1, 5) as AchievementTier,
  }));
}

function hidden(
  id: string,
  title: string,
  description: string,
  hint: string,
  value: (stats: AchievementStats) => boolean,
): AchievementDef {
  return {
    id,
    title,
    description,
    hint,
    category: 'hidden',
    hidden: true,
    target: 1,
    value: (stats) => (value(stats) ? 1 : 0),
    unit: '次',
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

  // ---------- 进度：答对题数 ----------
  ...tiered('progress', 'mastery', [
    {
      id: 'correct_50',
      title: '小有心得',
      description: '累计答对 50 道题',
      target: 50,
      value: (s) => s.correct,
      unit: '题',
    },
    {
      id: 'correct_200',
      title: '渐入佳境',
      description: '累计答对 200 道题',
      target: 200,
      value: (s) => s.correct,
      unit: '题',
    },
    {
      id: 'correct_500',
      title: '百炼成钢',
      description: '累计答对 500 道题',
      target: 500,
      value: (s) => s.correct,
      unit: '题',
    },
    {
      id: 'correct_1000',
      title: '千题斩',
      description: '累计答对 1000 道题',
      target: 1000,
      value: (s) => s.correct,
      unit: '题',
    },
    {
      id: 'correct_all',
      title: '全书制霸',
      description: '题库中的每一道题都至少答对一次',
      target: 0,
      targetOf: (s) => s.totalQuestions,
      value: (s) => s.correct,
      unit: '题',
    },
  ]),

  // ---------- 进度：累计作答次数 ----------
  ...tiered('progress', 'volume', [
    {
      id: 'answer_100',
      title: '勤学初试',
      description: '累计作答 100 次',
      target: 100,
      value: (s) => s.totalAttempts,
      unit: '次',
    },
    {
      id: 'answer_500',
      title: '笔耕不辍',
      description: '累计作答 500 次',
      target: 500,
      value: (s) => s.totalAttempts,
      unit: '次',
    },
    {
      id: 'answer_2000',
      title: '熟能生巧',
      description: '累计作答 2000 次',
      target: 2000,
      value: (s) => s.totalAttempts,
      unit: '次',
    },
    {
      id: 'answer_5000',
      title: '手不释卷',
      description: '累计作答 5000 次',
      target: 5000,
      value: (s) => s.totalAttempts,
      unit: '次',
    },
  ]),

  // ---------- 进度：章节通关 ----------
  ...tiered('progress', 'chapter', [
    {
      id: 'chapter_clear',
      title: '单章通关',
      description: '任意一个章节的题目全部答对',
      target: 1,
      value: (s) => s.chaptersCleared,
      unit: '章',
    },
    {
      id: 'chapter_3',
      title: '三章连捷',
      description: '3 个章节的题目全部答对',
      target: 3,
      value: (s) => s.chaptersCleared,
      unit: '章',
    },
    {
      id: 'chapter_10',
      title: '十章通达',
      description: '10 个章节的题目全部答对',
      target: 10,
      value: (s) => s.chaptersCleared,
      unit: '章',
    },
    {
      id: 'chapter_20',
      title: '过半江山',
      description: '20 个章节的题目全部答对',
      target: 20,
      value: (s) => s.chaptersCleared,
      unit: '章',
    },
    {
      id: 'chapter_all',
      title: '学贯全书',
      description: '全部章节都已通关',
      target: 0,
      targetOf: (s) => s.totalChapters,
      value: (s) => s.chaptersCleared,
      unit: '章',
    },
  ]),

  // ---------- 习惯：连续练习 ----------
  ...tiered('habit', 'streak', [
    {
      id: 'streak_3',
      title: '三日不辍',
      description: '连续 3 天保持练习',
      target: 3,
      value: (s) => s.bestStreak,
      unit: '天',
    },
    {
      id: 'streak_7',
      title: '一周坚持',
      description: '连续 7 天保持练习',
      target: 7,
      value: (s) => s.bestStreak,
      unit: '天',
    },
    {
      id: 'streak_14',
      title: '半月不怠',
      description: '连续 14 天保持练习',
      target: 14,
      value: (s) => s.bestStreak,
      unit: '天',
    },
    {
      id: 'streak_30',
      title: '月度全勤',
      description: '连续 30 天保持练习',
      target: 30,
      value: (s) => s.bestStreak,
      unit: '天',
    },
    {
      id: 'streak_100',
      title: '百日铸剑',
      description: '连续 100 天保持练习',
      target: 100,
      value: (s) => s.bestStreak,
      unit: '天',
    },
  ]),

  // ---------- 习惯：累计学习天数 ----------
  ...tiered('habit', 'days', [
    {
      id: 'days_10',
      title: '初成习惯',
      description: '累计学习 10 天',
      target: 10,
      value: (s) => s.studyDays,
      unit: '天',
    },
    {
      id: 'days_50',
      title: '五十日功',
      description: '累计学习 50 天',
      target: 50,
      value: (s) => s.studyDays,
      unit: '天',
    },
    {
      id: 'days_100',
      title: '百日筑基',
      description: '累计学习 100 天',
      target: 100,
      value: (s) => s.studyDays,
      unit: '天',
    },
  ]),

  // ---------- 收藏与心得：收藏 ----------
  ...tiered('collection', 'favorite', [
    {
      id: 'favorite_10',
      title: '收藏成癖',
      description: '收藏 10 道题',
      target: 10,
      value: (s) => s.favorites,
      unit: '题',
    },
    {
      id: 'favorite_50',
      title: '集腋成裘',
      description: '收藏 50 道题',
      target: 50,
      value: (s) => s.favorites,
      unit: '题',
    },
    {
      id: 'favorite_100',
      title: '藏书满架',
      description: '收藏 100 道题',
      target: 100,
      value: (s) => s.favorites,
      unit: '题',
    },
  ]),

  // ---------- 收藏与心得：题目心得 ----------
  ...tiered('collection', 'notes', [
    {
      id: 'note_first',
      title: '温故知新',
      description: '写下第一条题目心得',
      target: 1,
      value: (s) => s.notes,
      unit: '条',
    },
    {
      id: 'note_10',
      title: '随想成册',
      description: '累计写下 10 条题目心得',
      target: 10,
      value: (s) => s.notes,
      unit: '条',
    },
    {
      id: 'note_50',
      title: '心得等身',
      description: '累计写下 50 条题目心得',
      target: 50,
      value: (s) => s.notes,
      unit: '条',
    },
  ]),

  // ---------- 挑战：每日一练 ----------
  ...tiered('challenge', 'daily', [
    {
      id: 'daily_first',
      title: '今日份完成',
      description: '完成一次每日一练',
      target: 1,
      value: (s) => s.dailyCompleted,
      unit: '次',
    },
    {
      id: 'daily_7',
      title: '七日之约',
      description: '完成 7 次每日一练',
      target: 7,
      value: (s) => s.dailyCompleted,
      unit: '次',
    },
    {
      id: 'daily_30',
      title: '月度打卡',
      description: '完成 30 次每日一练',
      target: 30,
      value: (s) => s.dailyCompleted,
      unit: '次',
    },
    {
      id: 'daily_100',
      title: '百日一练',
      description: '完成 100 次每日一练',
      target: 100,
      value: (s) => s.dailyCompleted,
      unit: '次',
    },
  ]),

  // ---------- 挑战：限时挑战 ----------
  ...tiered('challenge', 'timed', [
    {
      id: 'timed_first',
      title: '初试锋芒',
      description: '完成一次限时挑战',
      target: 1,
      value: (s) => s.timedCompleted,
      unit: '次',
    },
    {
      id: 'timed_10',
      title: '限时老手',
      description: '完成 10 次限时挑战',
      target: 10,
      value: (s) => s.timedCompleted,
      unit: '次',
    },
    {
      id: 'timed_perfect',
      title: '满分收场',
      description: '限时挑战单次全部答对',
      target: 1,
      value: (s) => (s.timedPerfect ? 1 : 0),
      unit: '次',
    },
    {
      id: 'timed_fast',
      title: '疾风骤雨',
      description: '限时挑战全对且用时不超过 6 分钟',
      target: 1,
      value: (s) => (s.timedFast ? 1 : 0),
      unit: '次',
    },
  ]),

  // ---------- 挑战：模拟考 ----------
  ...tiered('challenge', 'exam', [
    {
      id: 'exam_pass',
      title: '金榜题名',
      description: '模拟考达到 45 分及格线',
      target: 1,
      value: (s) => (s.examPassed ? 1 : 0),
      unit: '次',
    },
    {
      id: 'exam_60',
      title: '名列前茅',
      description: '模拟考单次得分达到 60 分',
      target: 60,
      value: (s) => s.examBestScore,
      unit: '分',
    },
    {
      id: 'exam_3',
      title: '三战三捷',
      description: '模拟考累计及格 3 次',
      target: 3,
      value: (s) => s.examsPassed,
      unit: '次',
    },
    {
      id: 'exam_perfect',
      title: '状元及第',
      description: '模拟考全部答对',
      target: 1,
      value: (s) => (s.examPerfect ? 1 : 0),
      unit: '次',
    },
  ]),

  // ---------- 准确率 ----------
  ...tiered('accuracy', 'accuracy', [
    {
      id: 'accuracy_80_100',
      title: '百题八成',
      description: '答满 100 题，正确率达到 80%',
      target: 1,
      value: (s) => (s.answered >= 100 && s.accuracy >= 80 ? 1 : 0),
      unit: '次',
    },
    {
      id: 'accuracy_85_200',
      title: '两百题稳',
      description: '答满 200 题，正确率达到 85%',
      target: 1,
      value: (s) => (s.answered >= 200 && s.accuracy >= 85 ? 1 : 0),
      unit: '次',
    },
    {
      id: 'accuracy_90_300',
      title: '三百题精',
      description: '答满 300 题，正确率达到 90%',
      target: 1,
      value: (s) => (s.answered >= 300 && s.accuracy >= 90 ? 1 : 0),
      unit: '次',
    },
    {
      id: 'no_wrong_100',
      title: '滴水不漏',
      description: '答满 100 题且当前没有错题',
      target: 1,
      value: (s) => (s.answered >= 100 && s.wrongCount === 0 ? 1 : 0),
      unit: '次',
    },
  ]),

  // ---------- 隐藏成就 ----------
  hidden(
    'night_owl',
    '夜猫子',
    '在 00:00–05:00 之间完成一次作答',
    '在某个深夜翻开题本',
    (s) => s.nightOwl,
  ),
  hidden(
    'early_bird',
    '闻鸡起舞',
    '在 05:00–07:00 之间完成一次作答',
    '赶在太阳升起前开始',
    (s) => s.earlyBird,
  ),
  hidden(
    'marathon_day',
    '一日千里',
    '单日累计作答达到 100 题',
    '有一天你停不下来',
    (s) => s.maxDailyAnswered >= 100,
  ),
  hidden(
    'weekend_warrior',
    '周末战士',
    '同一个周末的周六与周日都在练习',
    '连续占满一个周末',
    (s) => s.weekendWarrior,
  ),
  hidden(
    'grand_slam',
    '完美一天',
    '同一天完成每日一练、限时挑战和模拟考',
    '一天之内尝遍所有玩法',
    (s) => s.grandSlam,
  ),
];

function targetOf(def: AchievementDef, stats: AchievementStats): number {
  return def.targetOf ? def.targetOf(stats) : def.target;
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((item) => item.id === id);
}

export function achievementProgress(state: PersistedState, data: QuizData): AchievementStatus[] {
  const stats = achievementStats(state, data);
  return ACHIEVEMENTS.map((def) => {
    const target = targetOf(def, stats);
    const current = def.value(stats);
    const unlockedAt = state.achievements[def.id]?.unlockedAt ?? null;
    return {
      ...def,
      target,
      current,
      unlocked: unlockedAt !== null || current >= target,
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
    if (def.value(stats) >= targetOf(def, stats)) unlocked[def.id] = { unlockedAt: now };
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