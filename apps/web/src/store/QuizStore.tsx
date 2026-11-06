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
  resetAllLearningState,
  mergeStates,
  applyAchievements,
  dailyQuestions,
  randomQuestions,
  shuffle,
  makeMap,
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
} from '@megrez/core';
import { ProgressStore, SyncBackend } from '@megrez/storage';
import {
  ApiError,
  CloudClient,
  type AuthUser,
  type StoredAuth,
} from '@megrez/storage/http';
import {
  createLocalAuthStore,
  loadServerUrl,
  saveServerUrl,
} from '@megrez/storage/auth';
import { clearAllSessions, clearSession, loadSessions, saveSession } from './sessionPersistence';
import { emitAnswerFeedback } from '../feedback';
import { notify } from '../components/Feedback';

export type View =
  | 'home'
  | 'quiz'
  | 'result'
  | 'favorites'
  | 'favorite-detail'
  | 'achievements'
  | 'settings';

/** 翻题离开时清掉“刚判分”标记，回看已答题不再触发自动跳转 */
function clearFresh(session: QuizSession | null | undefined): void {
  if (!session) return;
  for (const it of session.list) it.fresh = false;
}

/** 新建会话时可选的练习参数 */
type SessionOpts = {
  shuffle?: boolean;
  reviewOnly?: boolean;
  origin?: string;
  mode?: SessionMode;
  startedAt?: number;
  durationMs?: number;
  date?: string;
  seed?: number;
};

export interface ResumeSummary {
  origin: string;
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
  /** 最近活动的未完成练习会话（用于首页「继续练习」） */
  resume: ResumeSummary | null;
  /** 全部未完成会话，按来源索引（章节行据此显示「继续」） */
  savedSessions: QuizSession[];
  resumeSession: (origin?: string) => void;
  discardResume: (origin?: string) => void;
  /** 丢弃当前 resume 并从头开始同一来源的练习 */
  restartResume: () => void;
  // 进度操作
  persist: () => void;
  patchSettings: (patch: Partial<Settings>) => void;
  replaceState: (s: PersistedState) => void;
  /** 清空作答/错题等记录，保留收藏、心得、成就 */
  resetProgress: () => void;
  /** 清空全部学习数据：作答、错题、收藏、心得、成就 */
  resetAllLearningData: () => void;
  // 会话
  startChapter: (c: number) => void;
  startRandom: () => void;
  startUnanswered: () => void;
  startWrong: () => void;
  /** 不传章节则练全部收藏，传章节则只练该章的收藏题；fresh 为真时丢弃续做从头开始 */
  startFavorites: (chapter?: number, fresh?: boolean) => void;
  startDaily: () => void;
  startTimed: () => void;
  startExam: () => void;
  reviewWrong: () => void;
  /** 结算页「重做本轮」：用同一批题重新开始 */
  redoSession: () => void;
  /** 解析卡里的「重做本题」：撤销当前题的作答状态，重新选择 */
  redoCurrent: () => void;
  toggleFavorite: (q: Question) => void;
  addNote: (q: Question, text: string) => void;
  startSessionRaw: (list: Question[], title: string, opts?: SessionOpts) => void;
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
  // 每个练习来源各存一份未完成会话；昨日的每日一练不再续做，顺手清理
  const [savedSessions, setSavedSessions] = useState<QuizSession[]>(() => {
    const today = `daily:${dateKey()}`;
    return loadSessions(data).filter((s) => {
      if (!s.origin?.startsWith('daily:')) return true;
      if (s.origin === today) return true;
      clearSession(s.origin);
      return false;
    });
  });
  const savedSessionsRef = useRef(savedSessions);
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

  // 答题过程中持续保存会话快照；本来源结束（结算页）只清除这一份，其他练习不受影响
  useEffect(() => {
    if (app.view === 'quiz' && app.session) {
      const session = app.session;
      saveSession(session);
      if (!session.origin) return;
      savedSessionsRef.current = [
        session,
        ...savedSessionsRef.current.filter((s) => s.origin !== session.origin),
      ];
      setSavedSessions(savedSessionsRef.current);
    } else if (app.view === 'result') {
      const origin = app.session?.origin;
      if (!origin) return;
      clearSession(origin);
      savedSessionsRef.current = savedSessionsRef.current.filter((s) => s.origin !== origin);
      setSavedSessions(savedSessionsRef.current);
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
      clearAllSessions();
      savedSessionsRef.current = [];
      setSavedSessions([]);
      setPersisted(s);
    },
    [setPersisted],
  );

  const resetProgress = useCallback(() => {
    clearAllSessions();
    savedSessionsRef.current = [];
    setSavedSessions([]);
    setPersisted((s: PersistedState) => resetProgressState(s));
  }, [setPersisted]);

  const resetAllLearningData = useCallback(() => {
    clearAllSessions();
    savedSessionsRef.current = [];
    setSavedSessions([]);
    setPersisted((s: PersistedState) => resetAllLearningState(s));
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'GOTO', view: 'home' });
  }, [setPersisted]);

  const setView = useCallback((v: View) => dispatch({ type: 'GOTO', view: v }), []);

  /** 无条件新建会话（一次性入口用，不参与断点续做） */
  const startSessionRaw = useCallback((list: Question[], title: string, opts: SessionOpts = {}) => {
    dispatch({ type: 'START_SESSION', session: createSession(list, title, opts) });
  }, []);

  const cloneSession = useCallback(
    (s: QuizSession): QuizSession => ({
      ...s,
      list: s.list.map((it) => ({ ...it })),
    }),
    [],
  );

  /** 按练习来源构建一组新题；没有可练的题时返回 null */
  const buildSession = useCallback(
    (origin: string): { list: Question[]; title: string; opts?: SessionOpts } | null => {
      if (origin.startsWith('chapter:')) {
        const c = Number(origin.slice('chapter:'.length));
        const list = questionsOfChapter(data, c);
        return list.length ? { list, title: chapterTitleOf(data, c) } : null;
      }
      if (origin.startsWith('favorites:')) {
        const c = Number(origin.slice('favorites:'.length));
        const list = favoriteQuestions(data, persistRef.current).filter((q) => q.c === c);
        if (!list.length) return null;
        return { list, title: `收藏练习：${chapterTitleOf(data, c)}` };
      }
      if (origin.startsWith('daily:')) {
        const date = origin.slice('daily:'.length) || dateKey();
        return {
          list: dailyQuestions(data, date, DAILY_COUNT),
          title: '每日一练',
          opts: { mode: 'daily', date, startedAt: Date.now() },
        };
      }
      switch (origin) {
        case 'random': {
          const pool = shuffle(data.questions);
          const n = Math.min(persistRef.current.settings.count || 20, pool.length);
          return {
            list: pool.slice(0, n),
            title: '随机练习',
            opts: { shuffle: persistRef.current.settings.shuffle === 1 },
          };
        }
        case 'unanswered': {
          const un = unansweredQuestions(data, persistRef.current);
          const pool = shuffle(un.length ? un : data.questions);
          const n = Math.min(persistRef.current.settings.count || 20, pool.length);
          return {
            list: pool.slice(0, n),
            title: un.length ? '智能推进：新题' : '随机练习',
            opts: { shuffle: persistRef.current.settings.shuffle === 1 },
          };
        }
        case 'wrong': {
          const w = wrongQuestions(data, persistRef.current);
          if (!w.length) {
            notify('暂无错题，先去做题吧');
            return null;
          }
          return { list: w, title: '错题重练' };
        }
        case 'favorites': {
          const list = favoriteQuestions(data, persistRef.current);
          if (!list.length) {
            notify('还没有收藏题目，答题时点题卡右上角的星标即可收藏。');
            return null;
          }
          return { list, title: '收藏练习' };
        }
        case 'timed':
          return {
            list: randomQuestions(data, TIMED_COUNT),
            title: '限时挑战',
            opts: { mode: 'timed', startedAt: Date.now(), durationMs: TIMED_DURATION_MS },
          };
        case 'exam':
          return {
            list: randomQuestions(data, EXAM_COUNT),
            title: '模拟考',
            opts: { mode: 'exam', startedAt: Date.now(), durationMs: EXAM_DURATION_MS },
          };
        default:
          return null;
      }
    },
    [data],
  );

  /**
   * 从某个练习入口进入：已有该来源的未完成会话就续上，否则新建一组。
   * fresh 为真时丢弃旧会话，强制从头开始。
   */
  const startOrigin = useCallback(
    (origin: string, fresh = false) => {
      if (fresh) {
        clearSession(origin);
        savedSessionsRef.current = savedSessionsRef.current.filter((s) => s.origin !== origin);
        setSavedSessions(savedSessionsRef.current);
      } else {
        const existing = savedSessionsRef.current.find((s) => s.origin === origin);
        if (existing) {
          dispatch({ type: 'RESTORE_SESSION', session: cloneSession(existing) });
          return;
        }
      }

      const spec = buildSession(origin);
      if (!spec) return;
      dispatch({
        type: 'START_SESSION',
        session: createSession(spec.list, spec.title, { ...spec.opts, origin }),
      });
    },
    [buildSession, cloneSession],
  );

  const startChapter = useCallback(
    (c: number) => startOrigin(`chapter:${c}`),
    [startOrigin],
  );
  const startRandom = useCallback(() => startOrigin('random'), [startOrigin]);
  const startUnanswered = useCallback(() => startOrigin('unanswered'), [startOrigin]);
  const startWrong = useCallback(() => startOrigin('wrong'), [startOrigin]);
  const startFavorites = useCallback(
    (chapter?: number, fresh = false) =>
      startOrigin(chapter == null ? 'favorites' : `favorites:${chapter}`, fresh),
    [startOrigin],
  );
  const startDaily = useCallback(() => startOrigin(`daily:${dateKey()}`), [startOrigin]);
  const startTimed = useCallback(() => startOrigin('timed'), [startOrigin]);
  const startExam = useCallback(() => startOrigin('exam'), [startOrigin]);

  /** 首页「继续练习」默认恢复最近活动的一份 */
  const resumeSession = useCallback(
    (origin?: string) => {
      const target = origin
        ? savedSessionsRef.current.find((s) => s.origin === origin)
        : savedSessionsRef.current.find((s) => s.origin !== 'review');
      if (!target) return;
      dispatch({ type: 'RESTORE_SESSION', session: cloneSession(target) });
    },
    [cloneSession],
  );

  const discardResume = useCallback((origin?: string) => {
    const target = origin ?? savedSessionsRef.current.find((s) => s.origin !== 'review')?.origin;
    if (!target) return;
    clearSession(target);
    savedSessionsRef.current = savedSessionsRef.current.filter((s) => s.origin !== target);
    setSavedSessions(savedSessionsRef.current);
  }, []);

  /** 丢弃当前 resume 并从头开始同一来源的练习 */
  const restartResume = useCallback(() => {
    const target = savedSessionsRef.current.find((s) => s.origin !== 'review');
    if (!target?.origin) {
      startUnanswered();
      return;
    }
    startOrigin(target.origin, true);
  }, [startOrigin, startUnanswered]);

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
      notify('本轮全部答对');
      dispatch({ type: 'GOTO', view: 'home' });
      return;
    }
    startSessionRaw(wrong, '本轮错题重做', { reviewOnly: true });
  }, [app.session, startSessionRaw]);

  const appSessionRef = useRef(app.session);
  useEffect(() => {
    appSessionRef.current = app.session;
  }, [app.session]);

  /** 结算页「重做本轮」：同一批题重新作答，挑战模式重新计时 */
  const redoSession = useCallback(() => {
    const sess = appSessionRef.current;
    if (!sess) return;
    const list = sess.list.map((it) => it.q);
    if (!list.length) return;
    const opts: SessionOpts = {
      shuffle: persistRef.current.settings.shuffle === 1,
      mode: sess.mode,
      origin: sess.origin,
      seed: sess.seed,
    };
    if (sess.mode === 'timed' || sess.mode === 'exam') {
      opts.startedAt = Date.now();
      opts.durationMs = sess.durationMs;
    } else if (sess.mode === 'daily') {
      opts.startedAt = Date.now();
      opts.date = sess.date;
    }
    dispatch({ type: 'START_SESSION', session: createSession(list, sess.title, opts) });
  }, []);

  /** 解析卡里的「重做本题」：撤销本题作答，重新选择；乱序模式下重新洗牌选项 */
  const redoCurrent = useCallback(() => {
    const sess = appSessionRef.current;
    if (!sess) return;
    const item = sess.list[sess.idx];
    if (!item) return;
    item.done = false;
    item.pick = null;
    item.lastPick = -1;
    item.fresh = false;
    if (persistRef.current.settings.shuffle === 1) item.map = makeMap(true);
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'TICK' });
  }, []);

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
  const latest = savedSessions.find((s) => s.origin !== 'review');
  const resume: ResumeSummary | null = latest?.origin
    ? {
        origin: latest.origin,
        title: latest.title,
        idx: latest.idx,
        total: latest.list.length,
        done: latest.list.filter((it) => it.done).length,
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
      savedSessions,
      resumeSession,
      discardResume,
      restartResume,
      persist,
      patchSettings,
      replaceState,
      resetProgress,
      resetAllLearningData,
      startChapter,
      startRandom,
      startUnanswered,
      startWrong,
      startFavorites,
      startDaily,
      startTimed,
      startExam,
      reviewWrong,
      redoSession,
      redoCurrent,
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
      data, persisted, app, store, sync, cloud, newAchievements, resume, savedSessions,
      resumeSession, discardResume, restartResume,
      persist, patchSettings, replaceState, resetProgress, resetAllLearningData,
      startChapter, startRandom, startUnanswered, startWrong, startFavorites, startDaily, startTimed, startExam,
      reviewWrong, redoSession, redoCurrent, toggleFavorite, addNote, startSessionRaw,
      grade, pick, move, jump, next, prev, quit, finish, setView, toggleSheet, setAutoPending, tickNow,
      login, register, logout, syncNow, setServerUrl, dismissAchievements,
    ],
  );

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

function chapterTitleOf(data: QuizData, c: number): string {
  return data.chapters[String(c)] ?? `第${String(c).padStart(2, '0')}章`;
}