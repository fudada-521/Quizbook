/**
 * 平台无关的领域逻辑（判分 / 抽题 / 错题本 / 进度）。
 * 不依赖 DOM、localStorage 或任何框架，可被 Web / 桌面 / 移动 / 测试复用。
 */
import {
  QuizData,
  Question,
  PersistedState,
  Settings,
  SessionItem,
  QuizSession,
  AnswerRecord,
  QuestionNote,
  SessionMode,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  dateKey,
  qkey,
} from './types';

/** 按章节顺序取题 */
export function questionsOfChapter(data: QuizData, c: number): Question[] {
  return data.questions.filter((q) => q.c === c).sort((a, b) => a.n - b.n);
}

/** 洗牌（不修改原数组） */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 打乱选项，生成「显示下标 → 原始下标」映射 */
export function makeMap(shuffleOpts: boolean): [number, number, number, number] {
  const base: [number, number, number, number] = [0, 1, 2, 3];
  if (!shuffleOpts) return base;
  return shuffle(base) as [number, number, number, number];
}

/** 由题目列表构建一个会话 */
export function createSession(
  list: Question[],
  title: string,
  opts: {
    shuffle?: boolean;
    reviewOnly?: boolean;
    mode?: SessionMode;
    startedAt?: number;
    durationMs?: number;
    date?: string;
    seed?: number;
    origin?: string;
  } = {},
): QuizSession {
  const items: SessionItem[] = list.map((q) => ({
    q,
    map: makeMap(!!opts.shuffle),
    done: false,
    pick: null,
    lastPick: -1,
  }));
  return {
    origin: opts.origin,
    updatedAt: Date.now(),
    title,
    idx: 0,
    reviewOnly: !!opts.reviewOnly,
    list: items,
    mode: opts.mode ?? 'practice',
    startedAt: opts.startedAt,
    durationMs: opts.durationMs,
    date: opts.date,
    seed: opts.seed,
  };
}

/** 判分：返回是否答对，并同步进度状态 */
export function gradeAnswer(
  state: PersistedState,
  item: SessionItem,
  pickIdx: number,
  now = Date.now(),
): { ok: boolean; realOpt: number } {
  const realOpt = item.map[pickIdx];
  const ok = realOpt === item.q.a;
  item.done = true;
  item.lastPick = pickIdx;
  item.fresh = true;

  const k = qkey(item.q);
  const prev = state.answers[k];
  const rec: AnswerRecord = { ok, tries: (prev ? prev.tries : 0) + 1, t: now };
  state.answers[k] = rec;
  if (ok) {
    delete state.wrong[k];
  } else {
    state.wrong[k] = (state.wrong[k] || 0) + 1;
  }

  // 按本地日期累计，作为连续打卡与成就的数据源
  const day = dateKey(now);
  const daily = (state.daily[day] ??= {
    date: day,
    answered: 0,
    correct: 0,
    completed: false,
    t: now,
  });
  daily.answered += 1;
  if (ok) daily.correct += 1;
  daily.t = now;

  return { ok, realOpt };
}

/** 标记某天完成每日一练 */
export function markDailyCompleted(state: PersistedState, date = dateKey(), now = Date.now()): void {
  const daily = (state.daily[date] ??= {
    date,
    answered: 0,
    correct: 0,
    completed: false,
    t: now,
  });
  daily.completed = true;
  daily.t = now;
}

/**
 * 是否答对后应自动跳转。
 * 答错、关闭自动跳转、错题回顾模式，以及回看此前已作答的题（fresh=false）都不跳。
 */
export function shouldAutoAdvance(
  ok: boolean,
  settings: Settings,
  reviewOnly: boolean,
  fresh = true,
): boolean {
  return ok && settings.autoNext > 0 && !reviewOnly && fresh;
}

/** 组装带默认值的持久化状态（含旧数据兼容） */
export function normalizeState(raw: unknown): PersistedState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PersistedState>;
  return {
    schemaVersion: SCHEMA_VERSION,
    answers: r.answers ?? {},
    wrong: r.wrong ?? {},
    favorites: r.favorites ?? {},
    favoriteRemovals: r.favoriteRemovals ?? {},
    notes: r.notes ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    settingsAt: typeof r.settingsAt === 'number' ? r.settingsAt : 0,
    daily: r.daily ?? {},
    challenges: Array.isArray(r.challenges) ? r.challenges : [],
    achievements: r.achievements ?? {},
    resetAt: typeof r.resetAt === 'number' ? r.resetAt : 0,
  };
}

/** 是否已收藏 */
export function isFavorite(
  state: PersistedState,
  q: Pick<Question, 'c' | 'n'>,
): boolean {
  return Object.prototype.hasOwnProperty.call(state.favorites, qkey(q));
}

/** 切换收藏，返回切换后的收藏状态 */
export function toggleFavorite(
  state: PersistedState,
  q: Pick<Question, 'c' | 'n'>,
  now = Date.now(),
): boolean {
  const k = qkey(q);
  if (isFavorite(state, q)) {
    delete state.favorites[k];
    // 墓碑：让「取消收藏」也能跨设备同步，避免合并时被另一端的旧收藏复活
    state.favoriteRemovals[k] = now;
    return false;
  }
  delete state.favoriteRemovals[k];
  state.favorites[k] = now;
  return true;
}

/** 清空答题记录，但保留收藏、心得、成就与设置；resetAt 供云端合并时丢弃旧数据 */
export function resetProgressState(state: PersistedState, now = Date.now()): PersistedState {
  return {
    ...state,
    answers: {},
    wrong: {},
    daily: {},
    challenges: [],
    resetAt: now,
  };
}

/** 收藏的题目，按收藏时间从新到旧 */
export function favoriteQuestions(
  data: QuizData,
  state: PersistedState,
): Question[] {
  const favs = state.favorites;
  return data.questions
    .filter((q) => isFavorite(state, q))
    .sort((a, b) => (favs[qkey(b)] ?? 0) - (favs[qkey(a)] ?? 0));
}

/** 某道题的心得时间线（旧→新） */
export function notesFor(
  state: PersistedState,
  q: Pick<Question, 'c' | 'n'>,
): QuestionNote[] {
  return state.notes[qkey(q)] ?? [];
}

/** 追加一条心得；空白内容不记录，返回新心得或 null */
export function addQuestionNote(
  state: PersistedState,
  q: Pick<Question, 'c' | 'n'>,
  text: string,
  at = Date.now(),
): QuestionNote | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const k = qkey(q);
  const list = (state.notes[k] ??= []);
  const note: QuestionNote = { id: `${at}-${list.length}`, text: trimmed, at };
  list.push(note);
  return note;
}

/** 错题本题目（当前仍有错误记录的题目） */
export function wrongQuestions(
  data: QuizData,
  state: PersistedState,
): Question[] {
  const set = new Set(Object.keys(state.wrong));
  return data.questions.filter((q) => set.has(qkey(q)));
}

/** 未作答过的题目 */
export function unansweredQuestions(
  data: QuizData,
  state: PersistedState,
): Question[] {
  return data.questions.filter((q) => !state.answers[qkey(q)]);
}