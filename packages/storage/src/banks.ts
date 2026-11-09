/**
 * 已下载题库的本地仓储。
 *
 * - 首选 IndexedDB（数据库 `megrez_banks`，对象仓库 `banks`，keyPath `id`）；
 * - IndexedDB 不可用（部分 `file://` 场景、隐私模式）时回退到 localStorage；
 * - 回退模式只允许缓存 1 个非内置题库，避免 5 MB 配额被瞬间占满。
 *
 * 内置题库随应用打包，不进这里；这里只存用户额外下载/更新的题库包。
 */
import {
  normalizeQuizData,
  type QuizData,
  type RawQuizData,
} from '@megrez/core';

export interface BankMeta {
  id: string;
  name: string;
  subtitle?: string;
  version: number;
  questionCount: number;
  chapterCount: number;
  /** 首次下载到本机的时间 */
  installedAt: number;
}

export interface BankRepository {
  readonly kind: 'indexeddb' | 'localstorage';
  /** 已安装题库的元数据（不含题目正文） */
  list(): Promise<BankMeta[]>;
  /** 读取完整题库包；不存在或数据损坏返回 null */
  get(id: string): Promise<QuizData | null>;
  /** 写入/覆盖题库包，元数据由包内容推导 */
  put(data: QuizData): Promise<void>;
  remove(id: string): Promise<void>;
}

interface BankRecord extends BankMeta {
  data: QuizData;
}

const DB_NAME = 'megrez_banks';
const DB_VERSION = 1;
const STORE = 'banks';

const LS_PREFIX = 'megrez_bank_cache_v1:';
/** localStorage 回退模式下允许缓存的非内置题库数量 */
const LS_MAX_BANKS = 1;

function toMeta(record: BankRecord): BankMeta {
  return {
    id: record.id,
    name: record.name,
    subtitle: record.subtitle,
    version: record.version,
    questionCount: record.questionCount,
    chapterCount: record.chapterCount,
    installedAt: record.installedAt,
  };
}

function makeRecord(data: QuizData, installedAt: number): BankRecord {
  return {
    id: data.id,
    name: data.name,
    subtitle: data.subtitle,
    version: data.version,
    questionCount: data.questions.length,
    chapterCount: Object.keys(data.chapters).length,
    installedAt,
    data,
  };
}

/** 旧包/损坏包兜底：补齐题目 id 与题库元数据 */
function decodeRecord(raw: unknown): BankRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<BankRecord>;
  if (typeof record.id !== 'string' || !record.id || !record.data) return null;
  try {
    const data = normalizeQuizData(record.data as RawQuizData, {
      id: record.id,
      name: typeof record.name === 'string' && record.name ? record.name : record.id,
      version: typeof record.version === 'number' ? record.version : 1,
    });
    return makeRecord(data, typeof record.installedAt === 'number' ? record.installedAt : Date.now());
  } catch {
    return null;
  }
}

// ---------- IndexedDB 实现 ----------

interface IndexedDbRepository extends BankRepository {
  ready(): Promise<void>;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('无法打开题库数据库'));
    req.onblocked = () => reject(new Error('题库数据库被其他页面占用'));
  });
}

async function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const tx = db.transaction(STORE, mode);
  const result = await fn(tx.objectStore(STORE));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'));
  });
  return result;
}

export function createIndexedDbBankRepository(): IndexedDbRepository {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const database = () => {
    if (!dbPromise) {
      dbPromise = openDatabase().catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  };

  return {
    kind: 'indexeddb',
    async ready() {
      await database();
    },
    async list() {
      const db = await database();
      const rows = await withStore(db, 'readonly', (store) => idbRequest(store.getAll()));
      return (rows as unknown[])
        .map((row) => decodeRecord(row))
        .flatMap((record) => (record ? [toMeta(record)] : []))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    },
    async get(id) {
      const db = await database();
      const row = await withStore(db, 'readonly', (store) => idbRequest(store.get(id)));
      return decodeRecord(row)?.data ?? null;
    },
    async put(data) {
      const db = await database();
      const existing = await withStore(db, 'readonly', (store) => idbRequest(store.get(data.id)));
      const previous = decodeRecord(existing);
      const record = makeRecord(data, previous?.installedAt ?? Date.now());
      await withStore(db, 'readwrite', (store) => idbRequest(store.put(record)));
    },
    async remove(id) {
      const db = await database();
      await withStore(db, 'readwrite', (store) => idbRequest(store.delete(id)));
    },
  };
}

// ---------- localStorage 回退实现 ----------

function safeStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function listKeys(s: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const key = s.key(i);
    if (key && key.startsWith(LS_PREFIX)) keys.push(key);
  }
  return keys;
}

export function createLocalStorageBankRepository(storage?: Storage): BankRepository {
  const s = safeStorage(storage);

  const read = (id: string): BankRecord | null => {
    if (!s) return null;
    try {
      const raw = s.getItem(LS_PREFIX + id);
      return raw ? decodeRecord(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  return {
    kind: 'localstorage',
    async list() {
      if (!s) return [];
      return listKeys(s)
        .map((key) => {
          try {
            return decodeRecord(JSON.parse(s.getItem(key) ?? ''));
          } catch {
            return null;
          }
        })
        .flatMap((record) => (record ? [toMeta(record)] : []))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    },
    async get(id) {
      return read(id)?.data ?? null;
    },
    async put(data) {
      if (!s) throw new Error('本机存储不可用，无法保存题库');
      const previous = read(data.id);
      if (!previous) {
        const others = listKeys(s).filter((key) => key.slice(LS_PREFIX.length) !== 'builtin');
        if (others.length >= LS_MAX_BANKS) {
          throw new Error('本地缓存最多保存 1 个题库，请先删除其他题库');
        }
      }
      const record = makeRecord(data, previous?.installedAt ?? Date.now());
      try {
        s.setItem(LS_PREFIX + data.id, JSON.stringify(record));
      } catch {
        throw new Error('本机存储空间不足，无法保存题库');
      }
    },
    async remove(id) {
      s?.removeItem(LS_PREFIX + id);
    },
  };
}

/**
 * 自动选择实现：有 IndexedDB 就先用它，首次打开失败后永久回退到 localStorage。
 * 这样 `file://`、隐私模式等场景不会因为一次 open 失败就整个功能不可用。
 */
export function createBankRepository(storage?: Storage): BankRepository {
  const fallback = createLocalStorageBankRepository(storage);
  if (typeof indexedDB === 'undefined') return fallback;

  const idb = createIndexedDbBankRepository();
  let chosen: BankRepository | null = null;

  const resolve = async (): Promise<BankRepository> => {
    if (chosen) return chosen;
    try {
      await idb.ready();
      chosen = idb;
    } catch {
      chosen = fallback;
    }
    return chosen;
  };

  return {
    get kind() {
      return chosen?.kind ?? 'indexeddb';
    },
    async list() {
      return (await resolve()).list();
    },
    async get(id) {
      return (await resolve()).get(id);
    },
    async put(data) {
      return (await resolve()).put(data);
    },
    async remove(id) {
      return (await resolve()).remove(id);
    },
  };
}