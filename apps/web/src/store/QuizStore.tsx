/**
 * 应用状态：把 core 领域逻辑 + storage 适配封装成 React 可用的 hook。
 * 采用 useReducer + context，无额外状态库依赖。
 *
 * 同步策略：本地优先。所有修改先写本地并立即生效；登录后由后台在防抖窗口内
 * 把本地快照推给服务端，服务端合并后返回权威快照，客户端再落盘。
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
  SessionMode,
  DEFAULT_SETTINGS,
  DAILY_COUNT,
  TIMED_COUNT,
  TIMED_DURATION_MS,
  EXAM_COUNT,
  EXAM_DURATION_MS,
  normalizeState,
  resetProgressState,
  mergeStates,
  applyAchievements,
  dailyQuestions,
  randomQuestions,
  makeChallengeRecord,
  recordChallenge,
  markDailyCompleted,
  createSession,
  gradeAnswer,
  shouldAutoAdvance,
  questionsOfChapter,
  wrongQuestions,
  unansweredQuestions,
  favoriteQuestions,
  toggleFavorite as toggleFavoriteInState,
  addQuestionNote,
  qkey,
  dateKey,
  type Settings,
  type Question,
} from '@quiz/core';
import { ProgressStore, SyncBackend } from '@quiz/storage';
import {
  ApiError,
  CloudClient,
  type AuthUser,
  type StoredAuth,
} from '@quiz/storage/http';
import {
  createLocalAuthStore,
  loadServerUrl,
  saveServerUrl,
} from '@quiz/storage/auth';
import { clearSavedSession, loadSession, saveSession } from './sessionPersistence';
import { emitAnswerFeedback } from '../feedback';

export type View = 'home' | 'quiz' | 'result' | 'favorites' | 'achievements' | 'settings';

/** 翻题离开时清掉“刚判分”标记，回看已答题不再触发自动跳转 */
function clearFresh(session: QuizSession | null | undefined): void {
  if (!session) return;
  for (const it of session.list) it.fresh = false;
}

export interface ResumeSummary {
  title: string;
  idx: number;
  total: number;
  done: number;
}

export type CloudPhase = 'signed-out' | 'signing-in' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudState {
  phase: CloudPhase;
  user: AuthUser | null;
  serverUrl: string;
  lastSyncAt: number | null;
  error: string | null;
}

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
  | { type: 'RESTORE_SESSION'; session: QuizSession }
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
    case 'RESTORE_SESSION':
      return { ...state, view: 'quiz', session: action.session, result: null, sheetOpen: false };
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
  /** 云端登录与同步状态 */
  cloud: CloudState;
  /** 刚解锁的成就（用于弹提示） */
  newAchievements: string[];
  /** 未完成的练习会话（用于首页「继续练习」） */
  resume: ResumeSummary | null;
  resumeSession: () => void;
  discardResume: () => void;
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
  startFavorites: () => void;
  startDaily: () => void;
  startTimed: () => void;
  startExam: () => void;
  reviewWrong: () => void;
  toggleFavorite: (q: Question) => void;
  addNote: (q: Question, text: string) => void;
  startSessionRaw: (
    list: Question[],
    title: string,
    opts?: {
      shuffle?: boolean;
      reviewOnly?: boolean;
      mode?: SessionMode;
      startedAt?: number;
      durationMs?: number;
      date?: string;
      seed?: number;
    },
  ) => void;
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
  // 云端
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  syncNow: () => Promise<void>;
  setServerUrl: (url: string) => void;
  dismissAchievements: () => void;
}

const Ctx = createContext<QuizApp | null>(null);

export function useQuiz(): QuizApp {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQuiz must be used within QuizProvider');
  return v;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return '无法连接服务器，数据仍保存在本机';
    if (err.status === 401) return '登录已失效，请重新登录';
    return err.message;
  }
  return err instanceof Error ? err.message : '同步失败';
}

/** 登录/注册错误：服务端已返回可直接展示的中文提示 */
function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return '无法连接服务器，请检查地址与网络';
    return err.message;
  }
  return err instanceof Error ? err.message : '登录失败';
}

export function QuizProvider(props: {
  data: QuizData;
  store: ProgressStore;
  sync: SyncBackend;
  children: ReactNode;
}) {
  const { data, store, sync } = props;
  const authStore = useMemo(() => createLocalAuthStore(), []);

  const [persisted, setPersistedRaw] = useState<PersistedState>(() => normalizeState({}));
  const setPersisted = useCallback(
    (next: PersistedState | ((prev: PersistedState) => PersistedState)) => {
      setPersistedRaw((prev) => {
        const v = typeof next === 'function' ? (next as (p: PersistedState) => PersistedState)(prev) : next;
        return {
          ...v,
          answers: { ...v.answers },
          wrong: { ...v.wrong },
          favorites: { ...v.favorites },
          favoriteRemovals: { ...v.favoriteRemovals },
          notes: { ...v.notes },
          daily: { ...v.daily },
          challenges: [...v.challenges],
          achievements: { ...v.achievements },
        };
      });
    },
    [],
  );
  const [app, dispatch] = useReducer(reducer, initialState);
  const [savedSession, setSavedSession] = useState<QuizSession | null>(() => loadSession(data));
  const [newAchievements, setNewAchievements] = useState<string[]>([]);

  const [cloud, setCloud] = useState<CloudState>(() => ({
    phase: 'signed-out',
    user: null,
    serverUrl: loadServerUrl(),
    lastSyncAt: null,
    error: null,
  }));

  const loadedRef = useRef(false);
  const sessionRef = useRef<StoredAuth | null>(null);
  const syncVersionRef = useRef(0);
  const lastPushedRef = useRef('');
  const syncRunningRef = useRef(false);

  // 答题过程中持续保存会话快照；本轮结束（结算页）即清除，答题中退出则保留供下次继续
  useEffect(() => {
    if (app.view === 'quiz' && app.session) {
      saveSession(app.session);
      setSavedSession(app.session);
    } else if (app.view === 'result') {
      clearSavedSession();
      setSavedSession(null);
    }
  }, [app.session, app.tick, app.view]);

  // 初始加载：本地快照 →（已登录时）拉取远端并合并 → 回推
  useEffect(() => {
    let alive = true;
    (async () => {
      const auth = authStore.load();
      sessionRef.current = auth;
      let next: PersistedState | null = await store.load();

      if (auth) {
        setCloud((c) => ({ ...c, phase: 'syncing', user: auth.user, serverUrl: auth.serverUrl }));
        try {
          const client = new CloudClient(auth.serverUrl, auth.token);
          const remote = await client.pull();
          const merged = mergeStates(next, remote.state);
          applyAchievements(merged, data);
          const pushed = await client.push(merged, remote.version);
          next = pushed.state;
          syncVersionRef.current = pushed.version;
          lastPushedRef.current = JSON.stringify(pushed.state);
          if (alive) {
            setCloud((c) => ({
              ...c,
              phase: 'synced',
              user: auth.user,
              lastSyncAt: Date.now(),
              error: null,
            }));
          }
        } catch (err) {
          if (alive) {
            setCloud((c) => ({ ...c, phase: 'offline', error: errorMessage(err) }));
          }
        }
      }

      if (!alive) return;
      setPersisted(next ?? normalizeState({}));
      loadedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 本地持久化
  const persistRef = useRef(persisted);
  useEffect(() => {
    persistRef.current = persisted;
  }, [persisted]);

  useEffect(() => {
    if (!loadedRef.current) return;
    void store.save(persisted);
  }, [persisted, store]);

  const persist = useCallback(() => {
    void store.save(persistRef.current);
  }, [store]);

  // 本地实时评估成就：离线也能解锁，云端同步时会再做一次权威校验
  useEffect(() => {
    if (!loadedRef.current) return;
    const ids = applyAchievements(persistRef.current, data);
    if (!ids.length) return;
    setPersisted({ ...persistRef.current });
    setNewAchievements((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
  }, [persisted, data, setPersisted]);

  const dismissAchievements = useCallback(() => setNewAchievements([]), []);

  // ---------- 云端同步 ----------

  const syncWithAuth = useCallback(
    async (auth: StoredAuth) => {
      if (syncRunningRef.current) return;
      syncRunningRef.current = true;
      setCloud((c) => ({ ...c, phase: 'syncing', error: null }));
      try {
        const client = new CloudClient(auth.serverUrl, auth.token);
        const remote = await client.pull();
        const merged = mergeStates(persistRef.current, remote.state);
        applyAchievements(merged, data);
        const pushed = await client.push(merged, remote.version);
        syncVersionRef.current = pushed.version;
        lastPushedRef.current = JSON.stringify(pushed.state);
        setPersisted(pushed.state);
        setCloud((c) => ({
          ...c,
          phase: 'synced',
          user: auth.user,
          lastSyncAt: Date.now(),
          error: null,
        }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          authStore.clear();
          sessionRef.current = null;
          setCloud((c) => ({ ...c, phase: 'signed-out', user: null, error: '登录已失效，请重新登录' }));
        } else {
          setCloud((c) => ({ ...c, phase: 'offline', error: errorMessage(err) }));
        }
      } finally {
        syncRunningRef.current = false;
      }
    },
    [authStore, data, setPersisted],
  );

  const pushSnapshot = useCallback(
    async (snapshot: PersistedState) => {
      const auth = sessionRef.current;
      if (!auth) return;
      if (JSON.stringify(snapshot) === lastPushedRef.current) return;
      setCloud((c) => ({ ...c, phase: 'syncing', error: null }));
      try {
        const client = new CloudClient(auth.serverUrl, auth.token);
        const pushed = await client.push(snapshot, syncVersionRef.current);
        syncVersionRef.current = pushed.version;
        lastPushedRef.current = JSON.stringify(pushed.state);
        setPersisted(pushed.state);
        setCloud((c) => ({
          ...c,
          phase: 'synced',
          user: auth.user,
          lastSyncAt: Date.now(),
          error: null,
        }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          authStore.clear();
          sessionRef.current = null;
          setCloud((c) => ({ ...c, phase: 'signed-out', user: null, error: '登录已失效，请重新登录' }));
        } else {
          setCloud((c) => ({ ...c, phase: 'offline', error: errorMessage(err) }));
        }
      }
    },
    [authStore, setPersisted],
  );

  // 本地变化后防抖推送
  useEffect(() => {
    if (!loadedRef.current || !sessionRef.current) return;
    if (JSON.stringify(persisted) === lastPushedRef.current) return;
    const timer = window.setTimeout(() => void pushSnapshot(persisted), 1200);
    return () => window.clearTimeout(timer);
  }, [persisted, pushSnapshot]);

  const authenticate = useCallback(
    async (mode: 'login' | 'register', username: string, password: string) => {
      const serverUrl = cloud.serverUrl;
      setCloud((c) => ({ ...c, phase: 'signing-in', error: null }));
      try {
        const client = new CloudClient(serverUrl);
        const result =
          mode === 'login'
            ? await client.login(username, password)
            : await client.register(username, password);
        const auth: StoredAuth = {
          token: result.token,
          user: result.user,
          serverUrl,
          savedAt: Date.now(),
        };
        authStore.save(auth);
        sessionRef.current = auth;
        setCloud((c) => ({ ...c, phase: 'syncing', user: result.user, error: null }));
        await syncWithAuth(auth);
      } catch (err) {
        setCloud((c) => ({
          ...c,
          phase: c.user ? 'synced' : 'error',
          error: authErrorMessage(err),
        }));
      }
    },
    [authStore, cloud.serverUrl, syncWithAuth],
  );

  const login = useCallback(
    (username: string, password: string) => authenticate('login', username, password),
    [authenticate],
  );

  const register = useCallback(
    (username: string, password: string) => authenticate('register', username, password),
    [authenticate],
  );

  const logout = useCallback(async () => {
    const auth = sessionRef.current;
    sessionRef.current = null;
    authStore.clear();
    lastPushedRef.current = '';
    setCloud((c) => ({
      ...c,
      phase: 'signed-out',
      user: null,
      lastSyncAt: null,
      error: null,
    }));
    if (auth) await new CloudClient(auth.serverUrl, auth.token).logout();
  }, [authStore]);

  const syncNow = useCallback(async () => {
    const auth = sessionRef.current;
    if (auth) await syncWithAuth(auth);
  }, [syncWithAuth]);

  const setServerUrl = useCallback(
    (url: string) => {
      const normalized = url.trim().replace(/\/+$/, '');
      if (!normalized) return;
      saveServerUrl(normalized);
      // token 与服务器绑定，换地址视为退出登录，本地数据保留
      sessionRef.current = null;
      authStore.clear();
      lastPushedRef.current = '';
      setCloud((c) => ({
        ...c,
        serverUrl: normalized,
        phase: 'signed-out',
        user: null,
        lastSyncAt: null,
        error: null,
      }));
    },
    [authStore],
  );

  // ---------- 设置 ----------

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setPersisted((s: PersistedState) => ({
      ...s,
      settings: { ...s.settings, ...patch },
      settingsAt: Date.now(),
    }));
  }, [setPersisted]);

  const replaceState = useCallback(
    (s: PersistedState) => {
      clearSavedSession();
      setSavedSession(null);
      setPersisted(s);
    },
    [setPersisted],
  );

  const resetProgress = useCallback(() => {
    clearSavedSession();
    setSavedSession(null);
    setPersisted((s: PersistedState) => resetProgressState(s));
  }, [setPersisted]);

  const setView = useCallback((v: View) => dispatch({ type: 'GOTO', view: v }), []);

  const startSessionRaw = useCallback(
    (
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
      } = {},
    ) => {
      clearSavedSession();
      setSavedSession(null);
      const session = createSession(list, title, opts);
      dispatch({ type: 'START_SESSION', session });
    },
    [],
  );

  const resumeSession = useCallback(() => {
    if (!savedSession) return;
    dispatch({
      type: 'RESTORE_SESSION',
      session: { ...savedSession, list: savedSession.list.map((it) => ({ ...it })) },
    });
  }, [savedSession]);

  const discardResume = useCallback(() => {
    clearSavedSession();
    setSavedSession(null);
  }, []);

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
    startSessionRaw(shuffleQs.slice(0, n), '随机练习', {
      shuffle: persistRef.current.settings.shuffle === 1,
    });
  }, [data, startSessionRaw]);
  const startUnanswered = useCallback(() => {
    const un = unansweredQuestions(data, persistRef.current);
    const pool = (un.length ? un : [...data.questions]).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const n = Math.min(persistRef.current.settings.count || 20, pool.length);
    startSessionRaw(pool.slice(0, n), un.length ? '智能推进 · 新题' : '随机练习', {
      shuffle: persistRef.current.settings.shuffle === 1,
    });
  }, [data, startSessionRaw]);
  const startWrong = useCallback(() => {
    const w = wrongQuestions(data, persistRef.current);
    if (!w.length) {
      alert('暂无错题，先去做题吧 🎉');
      return;
    }
    startSessionRaw(w, '错题重练', {});
  }, [data, startSessionRaw]);
  const startFavorites = useCallback(() => {
    const list = favoriteQuestions(data, persistRef.current);
    if (!list.length) {
      alert('还没有收藏题目，答题时点题卡右上角的星标即可收藏。');
      return;
    }
    startSessionRaw(list, '收藏练习', {});
  }, [data, startSessionRaw]);

  const startDaily = useCallback(() => {
    const date = dateKey();
    const list = dailyQuestions(data, date, DAILY_COUNT);
    startSessionRaw(list, '每日一练', { mode: 'daily', date, startedAt: Date.now() });
  }, [data, startSessionRaw]);

  const startTimed = useCallback(() => {
    startSessionRaw(randomQuestions(data, TIMED_COUNT), '限时挑战', {
      mode: 'timed',
      startedAt: Date.now(),
      durationMs: TIMED_DURATION_MS,
    });
  }, [data, startSessionRaw]);

  const startExam = useCallback(() => {
    startSessionRaw(randomQuestions(data, EXAM_COUNT), '模拟考', {
      mode: 'exam',
      startedAt: Date.now(),
      durationMs: EXAM_DURATION_MS,
    });
  }, [data, startSessionRaw]);

  const toggleFavorite = useCallback(
    (q: Question) => {
      toggleFavoriteInState(persistRef.current, q);
      setPersisted({ ...persistRef.current });
    },
    [setPersisted],
  );
  const addNote = useCallback(
    (q: Question, text: string) => {
      const note = addQuestionNote(persistRef.current, q, text);
      if (!note) return;
      setPersisted({ ...persistRef.current });
    },
    [setPersisted],
  );
  const reviewWrong = useCallback(() => {
    const s = app.session;
    if (!s) return;
    const wrong = s.list
      .filter((it) => it.done && it.lastPick >= 0 && it.map[it.lastPick] !== it.q.a)
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
      emitAnswerFeedback(ok ? 'ok' : 'bad', persistRef.current.settings);
      setPersisted({ ...persistRef.current });
      dispatch({ type: 'TICK' });
      if (
        shouldAutoAdvance(ok, persistRef.current.settings, sess.reviewOnly, item.fresh === true)
      ) {
        dispatch({ type: 'SET_AUTO_PENDING', pending: true });
      }
    },
    [setPersisted],
  );

  const pick = useCallback(
    (pickIdx: number) => {
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
    },
    [grade],
  );

  const next = useCallback(() => {
    clearFresh(appSessionRef.current);
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'NEXT' });
  }, []);
  const prev = useCallback(() => {
    clearFresh(appSessionRef.current);
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'PREV' });
  }, []);
  const move = useCallback((d: number) => (d > 0 ? next() : prev()), [next, prev]);
  const jump = useCallback((i: number) => {
    clearFresh(appSessionRef.current);
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'JUMP', idx: i });
  }, []);
  const quit = useCallback(() => {
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    setView('home');
  }, [setView]);

  // 结束本轮：挑战模式写入成绩，每日一练标记完成
  const finish = useCallback(() => {
    const sess = appSessionRef.current;
    if (sess) {
      const record = makeChallengeRecord(sess);
      if (record && recordChallenge(persistRef.current, record)) {
        if (record.kind === 'daily') {
          markDailyCompleted(persistRef.current, sess.date ?? dateKey());
        }
        setPersisted({ ...persistRef.current });
      }
    }
    dispatch({ type: 'FINISH' });
  }, [setPersisted]);

  const toggleSheet = useCallback(() => dispatch({ type: 'TOGGLE_SHEET' }), []);
  const setAutoPending = useCallback(
    (p: boolean) => dispatch({ type: 'SET_AUTO_PENDING', pending: p }),
    [],
  );
  const tickNow = useCallback(() => dispatch({ type: 'TICK' }), []);

  // 会话内的 item 是原地修改的，这里每次渲染重新汇总，避免拿到过期的已完成数量
  const resume: ResumeSummary | null = savedSession
    ? {
        title: savedSession.title,
        idx: savedSession.idx,
        total: savedSession.list.length,
        done: savedSession.list.filter((it) => it.done).length,
      }
    : null;

  const value = useMemo<QuizApp>(
    () => ({
      data,
      state: persisted,
      app,
      settings: persisted.settings,
      store,
      sync,
      cloud,
      newAchievements,
      resume,
      resumeSession,
      discardResume,
      persist,
      patchSettings,
      replaceState,
      resetProgress,
      startChapter,
      startRandom,
      startUnanswered,
      startWrong,
      startFavorites,
      startDaily,
      startTimed,
      startExam,
      reviewWrong,
      toggleFavorite,
      addNote,
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
      login,
      register,
      logout,
      syncNow,
      setServerUrl,
      dismissAchievements,
    }),
    [
      data, persisted, app, store, sync, cloud, newAchievements, resume, resumeSession, discardResume,
      persist, patchSettings, replaceState, resetProgress,
      startChapter, startRandom, startUnanswered, startWrong, startFavorites, startDaily, startTimed, startExam,
      reviewWrong, toggleFavorite, addNote, startSessionRaw,
      grade, pick, move, jump, next, prev, quit, finish, setView, toggleSheet, setAutoPending, tickNow,
      login, register, logout, syncNow, setServerUrl, dismissAchievements,
    ],
  );

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

function chapterTitleOf(data: QuizData, c: number): string {
  return data.chapters[String(c)] ?? `第${String(c).padStart(2, '0')}章`;
}