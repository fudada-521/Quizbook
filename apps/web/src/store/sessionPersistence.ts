/**
 * 未完成练习会话的本地快照。
 * 只保存题目的唯一键与作答状态，不重复存储题干，数据仍以 questions.json 为准。
 *
 * 每个练习来源（章节、随机、错题、收藏、每日一练……）各存一份，
 * 互不覆盖：从哪个入口进来，就从该入口上次中断的位置继续。
 */
import {
  qkey,
  type Question,
  type QuizData,
  type QuizSession,
  type SessionItem,
  type SessionMode,
} from '@quiz/core';

const KEY = 'quizbook_quiz_sessions_v2';
/** 旧版本单份快照的键，读取时自动迁移 */
const LEGACY_KEY = 'quizbook_quiz_session_v1';
/** 旧品牌时期的会话键，读取时自动迁移 */
const LEGACY_BRAND_KEY = 'gaoxiang_quiz_session_v1';

interface StoredItem {
  k: string;
  m: [number, number, number, number];
  d: boolean;
  p: number | null;
  l: number;
}

interface StoredSession {
  v: 2;
  title: string;
  reviewOnly: boolean;
  idx: number;
  items: StoredItem[];
  updatedAt: number;
  /** v2：挑战/模拟考的会话信息 */
  mode?: SessionMode;
  startedAt?: number;
  durationMs?: number;
  date?: string;
  seed?: number;
}

interface StoredMap {
  v: 1;
  sessions: Record<string, StoredSession>;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isMap(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && n >= 0 && n <= 3) &&
    new Set(v).size === 4
  );
}

function readMap(): StoredMap {
  const s = storage();
  if (!s) return { v: 1, sessions: {} };
  try {
    const raw = s.getItem(KEY);
    if (!raw) return { v: 1, sessions: {} };
    const parsed = JSON.parse(raw) as Partial<StoredMap>;
    if (parsed && parsed.v === 1 && parsed.sessions && typeof parsed.sessions === 'object') {
      return { v: 1, sessions: parsed.sessions };
    }
  } catch {
    // 损坏时按空处理，下次保存会覆盖
  }
  return { v: 1, sessions: {} };
}

function writeMap(map: StoredMap): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(map));
  } catch {
    // 隐私模式或存储空间不足时静默失败，不影响答题
  }
}

function encode(session: QuizSession, updatedAt: number): StoredSession {
  return {
    v: 2,
    title: session.title,
    reviewOnly: session.reviewOnly,
    idx: session.idx,
    updatedAt,
    items: session.list.map((it) => ({
      k: qkey(it.q),
      m: it.map,
      d: it.done,
      p: it.pick,
      l: it.lastPick,
    })),
    mode: session.mode,
    startedAt: session.startedAt,
    durationMs: session.durationMs,
    date: session.date,
    seed: session.seed,
  };
}

/** 校验并还原一份快照；题目已不存在或数据损坏时返回 null */
function decode(parsed: Partial<StoredSession>, data: QuizData): QuizSession | null {
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;

  const byKey = new Map<string, Question>(data.questions.map((q) => [qkey(q), q]));
  const list: SessionItem[] = [];
  for (const it of parsed.items) {
    if (!it || typeof it.k !== 'string' || !isMap(it.m)) return null;
    const q = byKey.get(it.k);
    if (!q) return null;
    list.push({
      q,
      map: it.m,
      done: !!it.d,
      pick: typeof it.p === 'number' && it.p >= 0 && it.p <= 3 ? it.p : null,
      lastPick: typeof it.l === 'number' ? it.l : -1,
    });
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title : '继续练习',
    reviewOnly: !!parsed.reviewOnly,
    idx: Math.min(Math.max(parsed.idx ?? 0, 0), list.length - 1),
    list,
    mode: parsed.mode,
    startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : undefined,
    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
    date: typeof parsed.date === 'string' ? parsed.date : undefined,
    seed: typeof parsed.seed === 'number' ? parsed.seed : undefined,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  };
}

/** 旧单份快照没有来源标识，按标题/模式推断 */
function inferLegacyOrigin(session: QuizSession, data: QuizData): string {
  if (session.mode === 'timed') return 'timed';
  if (session.mode === 'exam') return 'exam';
  if (session.mode === 'daily') return `daily:${session.date ?? ''}`;
  if (session.reviewOnly) return 'review';

  const title = session.title;
  for (const [c, name] of Object.entries(data.chapters)) {
    if (name === title) return `chapter:${c}`;
  }
  // 章节标题可能带「第X章」前缀，退化为从标题里提取章号
  const chapterMatch = title.match(/第\s*0*(\d+)\s*章/);
  if (chapterMatch) return `chapter:${Number(chapterMatch[1])}`;
  if (title.startsWith('错题')) return 'wrong';
  if (title.startsWith('收藏')) return 'favorites';
  if (title.startsWith('随机')) return 'random';
  if (title.startsWith('智能推进')) return 'unanswered';
  return 'legacy';
}

/** 把旧版本的单份快照迁进新的多会话存储 */
function migrateLegacy(data: QuizData, map: StoredMap): boolean {
  const s = storage();
  if (!s) return false;
  let migrated = false;
  for (const legacyKey of [LEGACY_KEY, LEGACY_BRAND_KEY]) {
    const raw = s.getItem(legacyKey);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession> & { v?: number };
      const session = decode(parsed, data);
      if (session) {
        const origin = inferLegacyOrigin(session, data);
        session.origin = origin;
        map.sessions[origin] = encode(session, session.updatedAt ?? Date.now());
        migrated = true;
      }
    } catch {
      // 旧快照损坏则直接丢弃
    }
    s.removeItem(legacyKey);
    migrated = true;
  }
  return migrated;
}

export function saveSession(session: QuizSession): void {
  if (!session.origin) return;
  const map = readMap();
  const now = Date.now();
  // 与 core 的可变约定保持一致：会话对象本身记录最近保存时间
  session.updatedAt = now;
  map.sessions[session.origin] = encode(session, now);
  writeMap(map);
}

/** 读取全部未完成会话，按最近保存时间从新到旧排序 */
export function loadSessions(data: QuizData): QuizSession[] {
  const map = readMap();
  let dirty = migrateLegacy(data, map);

  const out: QuizSession[] = [];
  for (const [origin, raw] of Object.entries(map.sessions)) {
    const session = decode(raw, data);
    if (!session) {
      delete map.sessions[origin];
      dirty = true;
      continue;
    }
    session.origin = origin;
    out.push(session);
  }
  if (dirty) writeMap(map);
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function loadSession(data: QuizData, origin: string): QuizSession | null {
  return loadSessions(data).find((s) => s.origin === origin) ?? null;
}

export function clearSession(origin: string): void {
  const map = readMap();
  if (!(origin in map.sessions)) return;
  delete map.sessions[origin];
  writeMap(map);
}

export function clearAllSessions(): void {
  try {
    const s = storage();
    s?.removeItem(KEY);
    s?.removeItem(LEGACY_KEY);
    s?.removeItem(LEGACY_BRAND_KEY);
  } catch {
    // ignore
  }
}