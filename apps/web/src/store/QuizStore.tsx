/**
 * 应用状态：把 core 领域逻辑 + storage 适配封装成 React 可用的 hook。
 * 采用 useReducer + context，无额外状态库依赖。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  QuizData,
  PersistedState,
  QuizSession,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  createSession,
  gradeAnswer,
  shouldAutoAdvance,
  questionsOfChapter,
  wrongQuestions,
  unansweredQuestions,
  qkey,
  type Settings,
  type Question,
} from '@quiz/core';
import { ProgressStore, SyncBackend } from '@quiz/storage';

export type View = 'home' | 'quiz' | 'result';

interface AppState {
  view: View;
  session: QuizSession | null;
  /** 本轮结算快照 */
  result: { title: string; done: number; total: number; right: number; pct: number } | null;
  /** 倒计时是否激活（答对后） */
  autoPending: boolean;
  /** 触发的渲染版本，供倒计时圆环刷新 */
  tick: number;
  /** 答题卡显隐 */
  sheetOpen: boolean;
}

type Action =
  | { type: 'GOTO'; view: View }
  | { type: 'START_SESSION'; session: QuizSession; reviewOnly?: boolean }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'JUMP'; idx: number }
  | { type: 'FINISH' }
  | { type: 'SET_AUTO_PENDING'; pending: boolean }
  | { type: 'TICK' }
  | { type: 'TOGGLE_SHEET' };

const initialState: AppState = {
  view: 'home',
  session: null,
  result: null,
  autoPending: false,
  tick: 0,
  sheetOpen: false,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'GOTO':
      return { ...state, view: action.view };
    case 'START_SESSION':
      return { ...state, view: 'quiz', session: action.session, sheetOpen: false };
    case 'NEXT': {
      const s = state.session;
      if (!s) return state;
      if (s.idx + 1 >= s.list.length) {
        return { ...state, view: 'result' };
      }
      return { ...state, session: { ...s, idx: s.idx + 1 } };
    }
    case 'PREV': {
      const s = state.session;
      if (!s || s.idx <= 0) return state;
      return { ...state, session: { ...s, idx: s.idx - 1 } };
    }
    case 'JUMP': {
      const s = state.session;
      if (!s) return state;
      return { ...state, session: { ...s, idx: action.idx } };
    }
    case 'FINISH':
      return { ...state, view: 'result' };
    case 'SET_AUTO_PENDING':
      return { ...state, autoPending: action.pending };
    case 'TICK':
      return { ...state, tick: state.tick + 1 };
    case 'TOGGLE_SHEET':
      return { ...state, sheetOpen: !state.sheetOpen };
    default:
      return state;
  }
}

export interface QuizApp {
  data: QuizData;
  state: PersistedState;
  app: AppState;
  settings: Settings;
  store: ProgressStore;
  sync: SyncBackend;
  // 进度操作
  persist: () => void;
  patchSettings: (patch: Partial<Settings>) => void;
  replaceState: (s: PersistedState) => void;
  resetProgress: () => void;
  // 会话
  startChapter: (c: number) => void;
  startRandom: () => void;
  startUnanswered: () => void;
  startWrong: () => void;
  reviewWrong: () => void;
  startSessionRaw: (list: Parameters<typeof createSession>[0], title: string, opts?: { shuffle?: boolean; reviewOnly?: boolean }) => void;
  grade: (pickIdx: number) => void;
  pick: (pickIdx: number) => void;
  move: (d: number) => void;
  jump: (i: number) => void;
  next: () => void;
  prev: () => void;
  quit: () => void;
  finish: () => void;
  // 导航
  setView: (v: View) => void;
  toggleSheet: () => void;
  // 倒计时
  setAutoPending: (p: boolean) => void;
  tickNow: () => void;
}

const Ctx = createContext<QuizApp | null>(null);

export function useQuiz(): QuizApp {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQuiz must be used within QuizProvider');
  return v;
}

export function QuizProvider(props: {
  data: QuizData;
  store: ProgressStore;
  sync: SyncBackend;
  children: ReactNode;
}) {
  const { data, store, sync } = props;
  const [persisted, setPersistedRaw] = useState<PersistedState>({
    schemaVersion: SCHEMA_VERSION,
    answers: {},
    wrong: {},
    settings: DEFAULT_SETTINGS,
  });
  const setPersisted = useCallback((next: PersistedState | ((prev: PersistedState) => PersistedState)) => {
    setPersistedRaw((prev) => {
      const v = typeof next === 'function' ? (next as (p: PersistedState) => PersistedState)(prev) : next;
      return { ...v, answers: { ...v.answers }, wrong: { ...v.wrong } };
    });
  }, []);
  const [app, dispatch] = useReducer(reducer, initialState);

  // 初始加载进度
  const loadedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await store.load();
      const merged = s ? { ...s } : null;
      // 预留云同步：pull 后合并（当前 noop）
      if (alive && merged) setPersisted(merged);
      if (alive) loadedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(() => {
    // 通过一个 ref 保存最新 persisted，避免闭包过期
    void store.save(persistRef.current);
  }, [store]);

  // persisted 最新值的 ref（供 persist 与 timer 使用）
  const persistRef = useRef(persisted);
  useEffect(() => {
    persistRef.current = persisted;
  }, [persisted]);
  useEffect(() => {
    persist();
  }, [persisted, persist]);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setPersisted((s: PersistedState) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const replaceState = useCallback((s: PersistedState) => setPersisted(s), []);
  const resetProgress = useCallback(() => {
    setPersisted((s: PersistedState) => ({ schemaVersion: SCHEMA_VERSION, answers: {}, wrong: {}, settings: s.settings }));
  }, []);

  const setView = useCallback((v: View) => dispatch({ type: 'GOTO', view: v }), []);

  const startSessionRaw = useCallback(
    (list: Question[], title: string, opts: { shuffle?: boolean; reviewOnly?: boolean } = {}) => {
      const session = createSession(list, title, opts);
      dispatch({ type: 'START_SESSION', session });
    },
    [],
  );

  const startChapter = useCallback(
    (c: number) => startSessionRaw(questionsOfChapter(data, c), chapterTitleOf(data, c), {}),
    [data, startSessionRaw],
  );
  const startRandom = useCallback(() => {
    const shuffleQs = [...data.questions];
    for (let i = shuffleQs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffleQs[i], shuffleQs[j]] = [shuffleQs[j], shuffleQs[i]];
    }
    const n = Math.min(persistRef.current.settings.count || 20, shuffleQs.length);
    startSessionRaw(shuffleQs.slice(0, n), '随机练习', { shuffle: persistRef.current.settings.shuffle === 1 });
  }, [data, startSessionRaw]);
  const startUnanswered = useCallback(() => {
    const un = unansweredQuestions(data, persistRef.current);
    const pool = (un.length ? un : [...data.questions]).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const n = Math.min(persistRef.current.settings.count || 20, pool.length);
    startSessionRaw(pool.slice(0, n), un.length ? '智能推进 · 新题' : '随机练习', { shuffle: persistRef.current.settings.shuffle === 1 });
  }, [data, startSessionRaw]);
  const startWrong = useCallback(() => {
    const w = wrongQuestions(data, persistRef.current);
    if (!w.length) {
      // 无错题
      alert('暂无错题，先去做题吧 🎉');
      return;
    }
    startSessionRaw(w, '错题重练', {});
  }, [data, startSessionRaw]);
  const reviewWrong = useCallback(() => {
    const s = app.session;
    if (!s) return;
    const wrong = s.list
      .filter((it) => {
        const r = persistRef.current.answers[qkey(it.q)];
        return r && !r.ok;
      })
      .map((it) => it.q);
    if (!wrong.length) {
      alert('本轮全部答对，太棒了 🎉');
      dispatch({ type: 'GOTO', view: 'home' });
      return;
    }
    startSessionRaw(wrong, '本轮错题回顾', { reviewOnly: true });
  }, [app.session, startSessionRaw]);

  const appSessionRef = useRef(app.session);
  useEffect(() => {
    appSessionRef.current = app.session;
  }, [app.session]);

  const grade = useCallback(
    (pickIdx: number) => {
      const sess = appSessionRef.current;
      if (!sess) return;
      const item = sess.list[sess.idx];
      if (item.done) return;
      const { ok } = gradeAnswer(persistRef.current, item, pickIdx);
      setPersisted({ ...persistRef.current });
      // 触发会话内视图刷新
      dispatch({ type: 'TICK' });
      if (shouldAutoAdvance(ok, persistRef.current.settings, sess.reviewOnly)) {
        dispatch({ type: 'SET_AUTO_PENDING', pending: true });
      }
    },
    [],
  );

  const pick = useCallback((pickIdx: number) => {
    const sess = appSessionRef.current;
    if (!sess) return;
    const item = sess.list[sess.idx];
    if (item.done) return;
    if (persistRef.current.settings.instant === 1) {
      grade(pickIdx);
    } else {
      item.pick = pickIdx;
      dispatch({ type: 'TICK' });
    }
  }, [grade]);

  const next = useCallback(() => {
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'NEXT' });
  }, []);
  const prev = useCallback(() => {
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'PREV' });
  }, []);
  const move = useCallback((d: number) => (d > 0 ? next() : prev()), [next, prev]);
  const jump = useCallback((i: number) => {
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'JUMP', idx: i });
  }, []);
  const quit = useCallback(() => {
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    setView('home');
  }, [setView]);
  const finish = useCallback(() => dispatch({ type: 'FINISH' }), []);
  const toggleSheet = useCallback(() => dispatch({ type: 'TOGGLE_SHEET' }), []);
  const setAutoPending = useCallback((p: boolean) => dispatch({ type: 'SET_AUTO_PENDING', pending: p }), []);
  const tickNow = useCallback(() => dispatch({ type: 'TICK' }), []);

  const value = useMemo<QuizApp>(
    () => ({
      data,
      state: persisted,
      app,
      settings: persisted.settings,
      store,
      sync,
      persist,
      patchSettings,
      replaceState,
      resetProgress,
      startChapter,
      startRandom,
      startUnanswered,
      startWrong,
      reviewWrong,
      startSessionRaw,
      grade,
      pick,
      move,
      jump,
      next,
      prev,
      quit,
      finish,
      setView,
      toggleSheet,
      setAutoPending,
      tickNow,
    }),
    [
      data, persisted, app, store, sync, persist, patchSettings, replaceState, resetProgress,
      startChapter, startRandom, startUnanswered, startWrong, reviewWrong, startSessionRaw,
      grade, pick, move, jump, next, prev, quit, finish, setView, toggleSheet, setAutoPending, tickNow,
    ],
  );

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

function chapterTitleOf(data: QuizData, c: number): string {
  return data.chapters[String(c)] ?? `第${String(c).padStart(2, '0')}章`;
}