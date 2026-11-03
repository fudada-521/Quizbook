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
}

/** 持久化进度 */
export interface PersistedState {
  schemaVersion: number;
  answers: Record<string, AnswerRecord>;
  wrong: Record<string, number>; // 键 → 错误次数
  favorites: Record<string, number>; // 键 → 收藏时间戳
  settings: Settings;
}

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
}

export interface QuizSession {
  title: string;
  idx: number;
  reviewOnly: boolean;
  list: SessionItem[];
}

export const DEFAULT_SETTINGS: Settings = {
  count: 20,
  shuffle: 0,
  instant: 1,
  autoNext: 1600,
};

/** 进度存储当前 schema 版本；跨设备同步时据此做迁移（v2 增加 favorites） */
export const SCHEMA_VERSION = 2;

export function qkey(q: Pick<Question, 'c' | 'n'> | Question): string {
  return `${q.c}-${q.n}`;
}

export function chapterTitle(data: QuizData, c: number): string {
  return data.chapters[String(c)] ?? `第${String(c).padStart(2, '0')}章`;
}