/**
 * 应用状态：把 core 领域逻辑 + storage 适配封装成 React 可用的 hook。
 * 采用 useReducer + context，无额外状态库依赖。
 *
 * 题库维度：
 * - `bankId` / `data` 表示当前题库；内置题库随包提供，其他题库从 BankRepository 读取；
 * - 进度与会话按题库分桶，切换题库只动本地，不联网；
 * - 云同步按题库进行，本地优先，登录 / 切换 / 手动 / 答完防抖时触发。
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
  BUILTIN_BANK_ID,
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
  validateBank,
  type Settings,
  type Question,
} from '@megrez/core';
import { type BankMeta, type BankRepository, type ProgressStore } from '@megrez/storage';
import {
  ApiError,
  CloudClient,
  type AuthUser,
  type MembershipState,
  type RedeemResult,
  type RemoteBankMeta,
  type StoredAuth,
} from '@megrez/storage/http';
import {
  createLocalAuthStore,
  loadServerUrl,
  saveServerUrl,
} from '@megrez/storage/auth';
import {
  clearAllSessions,
  clearSession,
  loadSessions,
  saveSession,
} from './sessionPersistence';
import {
  bankProgressKey,
  clearBankLocalData,
  loadCurrentBankId,
  saveCurrentBankId,
} from './bankStorage';
import {
  clearMembership,
  loadCatalog,
  loadMembership,
  membershipIsActive,
  saveCatalog,
  saveMembership,
  type CachedMembership,
} from './account';
import { emitAnswerFeedback } from '../feedback';
import { notify } from '../components/Feedback';

export type View =
  | 'home'
  | 'quiz'
  | 'result'
  | 'favorites'
  | 'favorite-detail'
  | 'achievements'
  | 'settings'
  | 'banks';

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

/** 题库操作失败原因，供 UI 决定引导登录还是提示会员 */
export type BankActionReason = 'login' | 'membership' | 'invalid' | 'network' | 'storage' | 'builtin';

export type BankActionResult =
  | { ok: true }
  | { ok: false; reason: BankActionReason; message: string };

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
  | { type: 'TOGGLE_SHEET' }
  | { type: 'RESET_APP' };

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
    case 'RESET_APP':
      return { ...initialState };
    default:
      return state;
  }
}

export interface QuizApp {
  /** 当前题库的完整数据 */
  data: QuizData;
  state: PersistedState;
  app: AppState;
  settings: Settings;
  store: ProgressStore;
  /** 云端登录与同步状态 */
  cloud: CloudState;
  /** 刚解锁的成就（用于弹提示） */
  newAchievements: string[];
  /** 最近活动的未完成练习会话（用于首页「继续练习」） */
  resume: ResumeSummary | null;
  /** 全部未完成会话，按来源索引（章节行据此显示「继续」） */
  savedSessions: QuizSession[];

  // 题库
  bankId: string;
  bankName: string;
  bankVersion: number;
  /** 内置题库的元信息，题库管理页用它渲染第一行 */
  builtinBank: {
    id: string;
    name: string;
    version: number;
    questionCount: number;
    chapterCount: number;
  };
  installedBanks: BankMeta[];
  catalog: RemoteBankMeta[];
  catalogAt: number | null;
  bankBusy: string | null;
  switchBank: (id: string) => Promise<void>;
  /** 下载或更新题库；返回失败原因供 UI 引导 */
  installBank: (id: string) => Promise<BankActionResult>;
  deleteBank: (id: string, clearProgress: boolean) => Promise<BankActionResult>;
  refreshCatalog: () => Promise<boolean>;

  // 会员
  membership: CachedMembership | null;
  isMember: boolean;
  refreshMembership: () => Promise<void>;
  redeemCode: (code: string) => Promise<RedeemResult>;

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
    if (err.status === 402) return '会员已到期，多端同步已暂停';
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

function payloadMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const payload = err.payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

function actionFailure(err: unknown): BankActionResult {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return { ok: false, reason: 'network', message: '无法连接服务器，请检查网络后重试' };
    }
    if (err.status === 401) {
      return { ok: false, reason: 'login', message: '登录已失效，请重新登录' };
    }
    if (err.status === 402) {
      return { ok: false, reason: 'membership', message: '题库下载为会员功能' };
    }
    if (err.status === 404) {
      return { ok: false, reason: 'invalid', message: '题库不存在或尚未发布' };
    }
    return { ok: false, reason: 'invalid', message: payloadMessage(err) ?? err.message };
  }
  const message = err instanceof Error ? err.message : '操作失败';
  return { ok: false, reason: 'storage', message };
}

export function QuizProvider(props: {
  builtin: QuizData;
  createStore: (bankId: string) => ProgressStore;
  banks: BankRepository;
  children: ReactNode;
}) {
  const { builtin, createStore, banks } = props;
  const authStore = useMemo(() => createLocalAuthStore(), []);

  const [bankId, setBankIdState] = useState<string>(() => loadCurrentBankId());
  const [data, setData] = useState<QuizData>(builtin);
  const [reloadToken, setReloadToken] = useState(0);
  const [installedBanks, setInstalledBanks] = useState<BankMeta[]>([]);
  const [catalog, setCatalog] = useState<RemoteBankMeta[]>(() => loadCatalog()?.banks ?? []);
  const [catalogAt, setCatalogAt] = useState<number | null>(
    () => loadCatalog()?.fetchedAt ?? null,
  );
  const [bankBusy, setBankBusy] = useState<string | null>(null);
  const [membership, setMembership] = useState<CachedMembership | null>(() => loadMembership());
  const membershipRef = useRef<CachedMembership | null>(membership);

  const store = useMemo(() => createStore(bankId), [createStore, bankId]);

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
  const [savedSessions, setSavedSessions] = useState<QuizSession[]>([]);
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
  /** 首次加载是冷启动：不联网，保证断网 / 双击打开可用 */
  const bootedRef = useRef(false);
  /** 当前已经加载进 persisted/data 的题库，防止切换瞬间把旧进度写入新桶 */
  const loadedBankRef = useRef<string | null>(null);
  const bankIdRef = useRef(bankId);
  const dataRef = useRef(data);
  const sessionRef = useRef<StoredAuth | null>(null);
  const syncRunningRef = useRef(false);
  const lastPushedRef = useRef(new Map<string, string>());

  bankIdRef.current = bankId;
  dataRef.current = data;
  membershipRef.current = membership;

  const applyMembership = useCallback((next: MembershipState): CachedMembership => {
    const cached = saveMembership(next);
    membershipRef.current = cached;
    setMembership(cached);
    return cached;
  }, []);

  const refreshInstalledBanks = useCallback(async () => {
    try {
      setInstalledBanks(await banks.list());
    } catch {
      setInstalledBanks([]);
    }
  }, [banks]);

  useEffect(() => {
    void refreshInstalledBanks();
  }, [refreshInstalledBanks]);

  // ---------- 登录态初始化（不联网） ----------

  useEffect(() => {
    const auth = authStore.load();
    sessionRef.current = auth;
    if (auth) {
      setCloud((c) => ({ ...c, phase: 'synced', user: auth.user, serverUrl: auth.serverUrl }));
      if (!loadMembership() && auth.user.membership) {
        applyMembership(auth.user.membership);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 题库加载 ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let id = bankId;
      let nextData: QuizData | null = null;

      if (id === BUILTIN_BANK_ID) {
        nextData = builtin;
        try {
          const stored = await banks.get(BUILTIN_BANK_ID);
          if (stored && stored.version > builtin.version) nextData = stored;
        } catch {
          // 读不到就用包内数据
        }
      } else {
        try {
          nextData = await banks.get(id);
        } catch {
          nextData = null;
        }
        if (!nextData && !cancelled) {
          notify('题库未安装，已切回内置题库', 'error');
          saveCurrentBankId(BUILTIN_BANK_ID);
          setBankIdState(BUILTIN_BANK_ID);
          return;
        }
      }

      if (cancelled || !nextData) return;

      const bankStore = createStore(id);
      const loaded = (await bankStore.load()) ?? normalizeState({});
      if (cancelled) return;

      const today = `daily:${dateKey()}`;
      const sessions = loadSessions(id, nextData).filter((s) => {
        if (!s.origin?.startsWith('daily:')) return true;
        if (s.origin === today) return true;
        clearSession(id, s.origin);
        return false;
      });
      if (cancelled) return;

      loadedRef.current = true;
      loadedBankRef.current = id;
      setData(nextData);
      setPersisted(loaded);
      savedSessionsRef.current = sessions;
      setSavedSessions(sessions);

      // 冷启动不联网；切换题库后才自动同步（登录与手动同步由调用方触发）
      const isBoot = !bootedRef.current;
      bootedRef.current = true;
      const auth = sessionRef.current;
      if (!isBoot && auth && membershipIsActive(membershipRef.current)) {
        void syncBank(auth, id, loaded, nextData);
      }
    })();
    return () => {
      cancelled = true;
    };
    // syncBank 是稳定回调，不放进依赖避免重复加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, banks, builtin, createStore, reloadToken]);

  // 本地持久化：只保存已加载完成的当前题库，避免切换瞬间串桶
  const persistRef = useRef(persisted);
  useEffect(() => {
    persistRef.current = persisted;
  }, [persisted]);

  useEffect(() => {
    if (!loadedRef.current || loadedBankRef.current !== bankId) return;
    void store.save(persisted);
  }, [persisted, store, bankId]);

  const persist = useCallback(() => {
    void store.save(persistRef.current);
  }, [store]);

  // 本地实时评估成就：只作用于当前题库
  useEffect(() => {
    if (!loadedRef.current || loadedBankRef.current !== bankId) return;
    const ids = applyAchievements(persistRef.current, data);
    if (!ids.length) return;
    setPersisted({ ...persistRef.current });
    setNewAchievements((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
  }, [persisted, data, bankId, setPersisted]);

  // 答题过程中持续保存会话快照；本来源结束（结算页）只清除这一份
  useEffect(() => {
    if (!loadedRef.current || loadedBankRef.current !== bankId) return;
    if (app.view === 'quiz' && app.session) {
      const session = app.session;
      saveSession(bankId, session);
      if (!session.origin) return;
      savedSessionsRef.current = [
        session,
        ...savedSessionsRef.current.filter((s) => s.origin !== session.origin),
      ];
      setSavedSessions(savedSessionsRef.current);
    } else if (app.view === 'result') {
      const origin = app.session?.origin;
      if (!origin) return;
      clearSession(bankId, origin);
      savedSessionsRef.current = savedSessionsRef.current.filter((s) => s.origin !== origin);
      setSavedSessions(savedSessionsRef.current);
    }
  }, [app.session, app.tick, app.view, bankId]);

  const dismissAchievements = useCallback(() => setNewAchievements([]), []);

  // ---------- 云端同步（按题库） ----------

  const handleSyncError = useCallback(
    (err: unknown, auth: StoredAuth) => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          authStore.clear();
          sessionRef.current = null;
          setCloud((c) => ({ ...c, phase: 'signed-out', user: null, error: '登录已失效，请重新登录' }));
          return;
        }
        if (err.status === 403) {
          authStore.clear();
          sessionRef.current = null;
          setCloud((c) => ({ ...c, phase: 'signed-out', user: null, error: '账号已被禁用' }));
          return;
        }
        if (err.status === 402) {
          const payload = err.payload as { membership?: MembershipState } | null;
          applyMembership(payload?.membership ?? { active: false, expiresAt: null });
          setCloud((c) => ({
            ...c,
            phase: 'synced',
            user: auth.user,
            error: '会员已到期，多端同步已暂停；兑换后自动恢复',
          }));
          return;
        }
        if (err.status === 0) {
          setCloud((c) => ({ ...c, phase: 'offline', error: errorMessage(err) }));
          return;
        }
      }
      setCloud((c) => ({ ...c, phase: 'error', error: errorMessage(err) }));
    },
    [applyMembership, authStore],
  );

  /** 用指定凭据刷新会员状态，401/403 交给统一的错误处理 */
  const fetchMembership = useCallback(
    async (auth: StoredAuth): Promise<MembershipState | null> => {
      try {
        const state = await new CloudClient(auth.serverUrl, auth.token).getMembership();
        applyMembership(state);
        return state;
      } catch (err) {
        handleSyncError(err, auth);
        return null;
      }
    },
    [applyMembership, handleSyncError],
  );

  const syncBank = useCallback(
    async (auth: StoredAuth, targetBank: string, snapshot: PersistedState, bankData: QuizData) => {
      if (!membershipIsActive(membershipRef.current)) return;
      if (syncRunningRef.current) return;
      syncRunningRef.current = true;
      setCloud((c) => ({ ...c, phase: 'syncing', error: null }));
      try {
        const client = new CloudClient(auth.serverUrl, auth.token);
        const remote = await client.pullBankState(targetBank);
        const merged = mergeStates(snapshot, remote.state);
        applyAchievements(merged, bankData);
        const pushed = await client.pushBankState(targetBank, merged, remote.version);
        lastPushedRef.current.set(targetBank, JSON.stringify(pushed.state));
        if (bankIdRef.current !== targetBank) return;
        setPersisted(pushed.state);
        if (pushed.unlockedAchievements.length) {
          setNewAchievements((prev) => [
            ...prev,
            ...pushed.unlockedAchievements.filter((id) => !prev.includes(id)),
          ]);
        }
        setCloud((c) => ({
          ...c,
          phase: 'synced',
          user: auth.user,
          lastSyncAt: Date.now(),
          error: null,
        }));
      } catch (err) {
        handleSyncError(err, auth);
      } finally {
        syncRunningRef.current = false;
      }
    },
    [handleSyncError, setPersisted],
  );

  const pushSnapshot = useCallback(
    async (targetBank: string, snapshot: PersistedState, bankData: QuizData) => {
      const auth = sessionRef.current;
      if (!auth || !membershipIsActive(membershipRef.current)) return;
      if (lastPushedRef.current.get(targetBank) === JSON.stringify(snapshot)) return;
      if (syncRunningRef.current) return;
      syncRunningRef.current = true;
      setCloud((c) => ({ ...c, phase: 'syncing', error: null }));
      try {
        const client = new CloudClient(auth.serverUrl, auth.token);
        const pushed = await client.pushBankState(targetBank, snapshot, 0);
        lastPushedRef.current.set(targetBank, JSON.stringify(pushed.state));
        if (bankIdRef.current !== targetBank) return;
        setPersisted(pushed.state);
        if (pushed.unlockedAchievements.length) {
          setNewAchievements((prev) => [
            ...prev,
            ...pushed.unlockedAchievements.filter((id) => !prev.includes(id)),
          ]);
        }
        setCloud((c) => ({
          ...c,
          phase: 'synced',
          user: auth.user,
          lastSyncAt: Date.now(),
          error: null,
        }));
      } catch (err) {
        handleSyncError(err, auth);
      } finally {
        syncRunningRef.current = false;
      }
    },
    [handleSyncError, setPersisted],
  );

  // 本地变化后防抖推送（仅会员、仅已登录）
  useEffect(() => {
    if (!loadedRef.current || loadedBankRef.current !== bankId) return;
    if (!sessionRef.current || !membershipIsActive(membershipRef.current)) return;
    if (lastPushedRef.current.get(bankId) === JSON.stringify(persisted)) return;
    const timer = window.setTimeout(
      () => void pushSnapshot(bankId, persisted, dataRef.current),
      1200,
    );
    return () => window.clearTimeout(timer);
  }, [persisted, bankId, pushSnapshot]);

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
        if (result.user.membership) {
          applyMembership(result.user.membership);
        } else {
          await fetchMembership(auth);
        }
        setCloud((c) => ({ ...c, phase: 'syncing', user: result.user, error: null }));
        if (membershipIsActive(membershipRef.current)) {
          await syncBank(auth, bankIdRef.current, persistRef.current, dataRef.current);
        } else {
          setCloud((c) => ({ ...c, phase: 'synced', user: result.user, error: null }));
        }
      } catch (err) {
        setCloud((c) => ({
          ...c,
          phase: c.user ? 'synced' : 'error',
          error: authErrorMessage(err),
        }));
      }
    },
    [applyMembership, authStore, cloud.serverUrl, fetchMembership, syncBank],
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
    clearMembership();
    membershipRef.current = null;
    setMembership(null);
    lastPushedRef.current.clear();
    setCloud((c) => ({
      ...c,
      phase: 'signed-out',
      user: null,
      lastSyncAt: null,
      error: null,
    }));
    if (auth) {
      try {
        await new CloudClient(auth.serverUrl, auth.token).logout();
      } catch {
        // 本地已退出，服务端不可达时无需阻塞
      }
    }
  }, [authStore]);

  const syncNow = useCallback(async () => {
    const auth = sessionRef.current;
    if (!auth) return;
    if (!membershipIsActive(membershipRef.current)) {
      const state = await fetchMembership(auth);
      if (!state?.active) {
        setCloud((c) => ({ ...c, error: '多端同步为会员功能，兑换后即可使用' }));
        return;
      }
    }
    await syncBank(auth, bankIdRef.current, persistRef.current, dataRef.current);
  }, [fetchMembership, syncBank]);

  const setServerUrl = useCallback(
    (url: string) => {
      const normalized = url.trim().replace(/\/+$/, '');
      if (!normalized) return;
      saveServerUrl(normalized);
      // token 与服务器绑定，换地址视为退出登录，本地数据保留
      sessionRef.current = null;
      authStore.clear();
      clearMembership();
      membershipRef.current = null;
      setMembership(null);
      lastPushedRef.current.clear();
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

  // ---------- 会员 ----------

  const refreshMembership = useCallback(async () => {
    const auth = sessionRef.current;
    if (!auth) return;
    await fetchMembership(auth);
  }, [fetchMembership]);

  /** 本地判断未过期就直接放行，否则联网刷新一次 */
  const ensureMembership = useCallback(async (): Promise<boolean> => {
    const auth = sessionRef.current;
    if (!auth) return false;
    if (membershipIsActive(membershipRef.current)) return true;
    try {
      const state = await new CloudClient(auth.serverUrl, auth.token).getMembership();
      applyMembership(state);
      return state.active;
    } catch (err) {
      handleSyncError(err, auth);
      return membershipIsActive(membershipRef.current);
    }
  }, [applyMembership, handleSyncError]);

  const redeemCode = useCallback(
    async (code: string): Promise<RedeemResult> => {
      const auth = sessionRef.current;
      if (!auth) throw new Error('请先登录');
      try {
        const result = await new CloudClient(auth.serverUrl, auth.token).redeem(code.trim());
        applyMembership(result);
        await syncBank(auth, bankIdRef.current, persistRef.current, dataRef.current);
        return result;
      } catch (err) {
        if (err instanceof ApiError) {
          throw new Error(payloadMessage(err) ?? errorMessage(err));
        }
        throw err;
      }
    },
    [applyMembership, syncBank],
  );

  // 会员状态本地判断；过期后 UI 会提示刷新
  const isMember = membershipIsActive(membership);

  // ---------- 题库操作 ----------

  const refreshCatalogInternal = useCallback(async (): Promise<boolean> => {
    try {
      const list = await new CloudClient(loadServerUrl()).listBanks();
      const saved = saveCatalog(list);
      setCatalog(saved.banks);
      setCatalogAt(saved.fetchedAt);
      return true;
    } catch {
      // 离线时保留缓存
      return false;
    }
  }, []);

  const refreshCatalog = useCallback(
    () => refreshCatalogInternal(),
    [refreshCatalogInternal],
  );

  const switchBank = useCallback(async (next: string) => {
    if (next === bankIdRef.current) return;
    // 答题中切走：先保存当前会话，切回来还能继续
    const session = app.session;
    if (session?.origin) saveSession(bankIdRef.current, session);
    saveCurrentBankId(next);
    setNewAchievements([]);
    setBankIdState(next);
    dispatch({ type: 'RESET_APP' });
  }, [app.session]);

  const installBank = useCallback(
    async (id: string): Promise<BankActionResult> => {
      const auth = sessionRef.current;
      if (!auth) return { ok: false, reason: 'login', message: '请先登录后再下载题库' };
      if (!(await ensureMembership())) {
        return {
          ok: false,
          reason: 'membership',
          message: '题库下载为会员功能，兑换会员后即可使用',
        };
      }
      setBankBusy(id);
      try {
        const client = new CloudClient(auth.serverUrl, auth.token);
        const { data: raw } = await client.downloadBank(id);
        const checked = validateBank(raw);
        if (!checked.ok || !checked.bank) {
          return {
            ok: false,
            reason: 'invalid',
            message: checked.errors[0] ?? '题库包格式不正确',
          };
        }
        if (checked.bank.id !== id) {
          return { ok: false, reason: 'invalid', message: '题库包与请求的题库不一致' };
        }
        await banks.put(checked.bank);
        await refreshInstalledBanks();
        if (id === bankIdRef.current) {
          setReloadToken((n) => n + 1);
          notify('题库已更新，正在重新加载');
        } else {
          notify(installedBanks.some((b) => b.id === id) ? '题库已更新' : '题库已下载');
        }
        return { ok: true };
      } catch (err) {
        return actionFailure(err);
      } finally {
        setBankBusy(null);
      }
    },
    [banks, ensureMembership, installedBanks, refreshInstalledBanks],
  );

  const deleteBank = useCallback(
    async (id: string, clearProgress: boolean): Promise<BankActionResult> => {
      if (id === BUILTIN_BANK_ID) {
        return { ok: false, reason: 'builtin', message: '内置题库不可删除' };
      }
      setBankBusy(id);
      try {
        await banks.remove(id);
        // 先切走再清数据：switchBank 会把当前会话保存到原题库，顺序反了会留下快照
        if (id === bankIdRef.current) await switchBank(BUILTIN_BANK_ID);
        if (clearProgress) {
          clearAllSessions(id);
          clearBankLocalData(id);
        }
        await refreshInstalledBanks();
        notify(clearProgress ? '题库与本地进度已删除' : '题库已删除，云端进度保留');
        return { ok: true };
      } catch (err) {
        return actionFailure(err);
      } finally {
        setBankBusy(null);
      }
    },
    [banks, refreshInstalledBanks, switchBank],
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
      clearAllSessions(bankId);
      savedSessionsRef.current = [];
      setSavedSessions([]);
      setPersisted(s);
    },
    [bankId, setPersisted],
  );

  const resetProgress = useCallback(() => {
    clearAllSessions(bankId);
    savedSessionsRef.current = [];
    setSavedSessions([]);
    setPersisted((s: PersistedState) => resetProgressState(s));
  }, [bankId, setPersisted]);

  const resetAllLearningData = useCallback(() => {
    clearAllSessions(bankId);
    savedSessionsRef.current = [];
    setSavedSessions([]);
    setPersisted((s: PersistedState) => resetAllLearningState(s));
    dispatch({ type: 'SET_AUTO_PENDING', pending: false });
    dispatch({ type: 'GOTO', view: 'home' });
  }, [bankId, setPersisted]);

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
        clearSession(bankId, origin);
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
    [bankId, buildSession, cloneSession],
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
    clearSession(bankId, target);
    savedSessionsRef.current = savedSessionsRef.current.filter((s) => s.origin !== target);
    setSavedSessions(savedSessionsRef.current);
  }, [bankId]);

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

  // 会话内的 item 是原地修改的；savedSessions 每次保存都会换新数组，故用 memo 汇总
  const resume = useMemo<ResumeSummary | null>(() => {
    const latest = savedSessions.find((s) => s.origin !== 'review');
    if (!latest?.origin) return null;
    return {
      origin: latest.origin,
      title: latest.title,
      idx: latest.idx,
      total: latest.list.length,
      done: latest.list.filter((it) => it.done).length,
    };
  }, [savedSessions]);

  const value = useMemo<QuizApp>(
    () => ({
      data,
      state: persisted,
      app,
      settings: persisted.settings,
      store,
      cloud,
      newAchievements,
      resume,
      savedSessions,
      bankId,
      bankName: data.name,
      bankVersion: data.version,
      builtinBank: {
        id: builtin.id,
        name: builtin.name,
        version: builtin.version,
        questionCount: builtin.questions.length,
        chapterCount: Object.keys(builtin.chapters).length,
      },
      installedBanks,
      catalog,
      catalogAt,
      bankBusy,
      switchBank,
      installBank,
      deleteBank,
      refreshCatalog,
      membership,
      isMember,
      refreshMembership,
      redeemCode,
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
      data, persisted, app, store, cloud, newAchievements, resume, savedSessions,
      bankId, builtin, installedBanks, catalog, catalogAt, bankBusy, switchBank, installBank, deleteBank, refreshCatalog,
      membership, isMember, refreshMembership, redeemCode,
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
  return data.chapters[String(c)] ?? `第 ${c} 章`;
}

/** 供 App 创建按题库分桶的进度存储 */
export { bankProgressKey };