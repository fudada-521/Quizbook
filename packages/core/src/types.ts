/**
 * 题库与进度核心数据模型 —— packages/core 共用。
 * 数据源为 data/questions.json，语义与原单页版 questions.js 完全一致：
 *   - a 为 0 基下标（a:3 表示 D）
 *   - 题目唯一键 `${c}-${n}`
 *   - o 固定 4 项
 */

export interface Question {
  /** 章节号 */
  c: number;
  /** 原书题号 */
  n: number;
  /** 题干 */
  s: string;
  /** 四个选项 A/B/C/D */
  o: [string, string, string, string];
  /** 正确选项下标（0 基） */
  a: number;
  /** 解析（可能缺失） */
  e: string;
}

export interface QuizData {
  generatedFrom: string;
  /** 章节号 → 标题（JSON 反序列化后键为字符串，用 Number 读取） */
  chapters: Record<string, string>;
  questions: Question[];
}

/** 单题作答记录 */
export interface AnswerRecord {
  ok: boolean;
  tries: number;
  t: number; // 最近一次作答时间戳
}

/** 持久化设置 */
export interface Settings {
  /** 随机练习抽题数 */
  count: number;
  /** 是否开启选项乱序 0/1 */
  shuffle: 0 | 1;
  /** 1=点选即判分，0=选中后点确认 */
  instant: 0 | 1;
  /** 答对后自动跳转毫秒数，0=不自动 */
  autoNext: number;
  /** 答题音效 0=关 1=开 */
  sound: 0 | 1;
  /** 答错触觉反馈 0=关 1=开（移动端生效） */
  haptics: 0 | 1;
}

/** 单条题目心得（只追加，不修改） */
export interface QuestionNote {
  /** 题内唯一 id，仅用于渲染与排序 */
  id: string;
  text: string;
  at: number; // 记录时间戳
}

/** 某一天的学习记录（本地时区日期，YYYY-MM-DD） */
export interface DailyRecord {
  date: string;
  /** 当天作答次数 */
  answered: number;
  /** 当天答对次数 */
  correct: number;
  /** 当天是否完成了每日一练 */
  completed: boolean;
  /** 最近一次更新时间 */
  t: number;
}

export type ChallengeKind = 'daily' | 'timed' | 'exam';

/** 一次挑战/模拟考的成绩记录 */
export interface ChallengeRecord {
  /** 客户端生成的唯一 id */
  id: string;
  kind: ChallengeKind;
  /** 开始日期 YYYY-MM-DD */
  date: string;
  /** 答对题数 */
  score: number;
  /** 总题数 */
  total: number;
  /** 实际用时（毫秒） */
  durationMs: number;
  /** 完成时间 */
  finishedAt: number;
  /** 模拟考是否及格 */
  passed?: boolean;
}

/** 成就解锁记录 */
export interface AchievementUnlock {
  unlockedAt: number;
}

/** 持久化进度 */
export interface PersistedState {
  schemaVersion: number;
  answers: Record<string, AnswerRecord>;
  wrong: Record<string, number>; // 键 → 错误次数
  favorites: Record<string, number>; // 键 → 收藏时间戳
  /** 取消收藏的时间戳（墓碑，保证删除能跨设备同步） */
  favoriteRemovals: Record<string, number>;
  notes: Record<string, QuestionNote[]>; // 键 → 心得时间线（旧→新）
  settings: Settings;
  /** 设置最近修改时间，用于多设备合并 */
  settingsAt: number;
  /** 按日期的学习记录 */
  daily: Record<string, DailyRecord>;
  /** 挑战与模拟考成绩 */
  challenges: ChallengeRecord[];
  /** 成就 id → 解锁时间 */
  achievements: Record<string, AchievementUnlock>;
  /** 最近一次「清空答题记录」的时间戳；早于它的作答/错题/挑战记录在合并时被丢弃 */
  resetAt: number;
  /** 最近一次「清空全部学习数据」的时间戳；早于它的收藏/心得/成就也会被丢弃 */
  dataResetAt: number;
}

/** 练习模式 */
export type SessionMode = 'practice' | 'daily' | 'timed' | 'exam';

/** 会话中的一题（含乱序映射） */
export interface SessionItem {
  q: Question;
  /** 显示下标 → 原始选项下标 */
  map: [number, number, number, number];
  /** 是否已作答 */
  done: boolean;
  /** 本轮选中显示下标 */
  pick: number | null;
  /** 最近一次作答的显示下标 */
  lastPick: number;
  /**
   * 本次停留内刚判分：只有它为真时才允许答对后自动跳转。
   * 翻题离开即清除，且不写入会话快照，回看已答题时不会再次倒计时。
   */
  fresh?: boolean;
}

export interface QuizSession {
  /**
   * 练习来源标识（如 `chapter:3` / `random` / `daily:2026-11-04`）。
   * 同一来源的未完成会话会被记住，下次从同一入口进入时续做。
   */
  origin?: string;
  /** 最近一次保存时间，用于首页「继续练习」选取最近活动的一份 */
  updatedAt?: number;
  title: string;
  idx: number;
  reviewOnly: boolean;
  list: SessionItem[];
  /** 练习模式（旧会话快照没有该字段，按 practice 处理） */
  mode?: SessionMode;
  /** 开始时间（挑战/模拟考计时用） */
  startedAt?: number;
  /** 限时毫秒数，0/缺省表示不限时 */
  durationMs?: number;
  /** 每日一练对应日期 */
  date?: string;
  /** 随机抽题种子（可用于复盘） */
  seed?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  count: 20,
  shuffle: 0,
  instant: 1,
  autoNext: 1600,
  sound: 1,
  haptics: 1,
};

/** 进度存储当前 schema 版本；v6 增加「清空全部学习数据」的 dataResetAt 纪元 */
export const SCHEMA_VERSION = 6;

export function qkey(q: Pick<Question, 'c' | 'n'> | Question): string {
  return `${q.c}-${q.n}`;
}

export function chapterTitle(data: QuizData, c: number): string {
  return data.chapters[String(c)] ?? `第${String(c).padStart(2, '0')}章`;
}

/** 本地时区的日期键 YYYY-MM-DD */
export function dateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}