/**
 * SQLite 持久层（Node 24 内置 node:sqlite，无原生依赖）。
 *
 * 数据分两类：
 *   - 题库：`banks` / `bank_chapters` / `bank_questions`（草稿态）+ `bank_releases`（不可变发布包）
 *   - 用户：`users` / `auth_tokens` + 按「用户 × 题库」存的进度快照 `user_states_v2`
 *
 * 进度仍是整份 JSON 快照 + version 乐观并发，冲突时由客户端/服务端合并后重试；
 * 按题库分表只是把主键扩成 (user_id, bank_id)，合并规则仍由 `@megrez/core` 的 mergeStates 负责。
 *
 * 不引入迁移框架：新库直接建最新结构，旧库用 PRAGMA table_info 判断后 ALTER / 搬迁。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUILTIN_BANK_ID, normalizeState, type PersistedState } from '@megrez/core';
import { env } from './env';

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/** 同步事务包装：SQLite 单连接，回调内不要 await */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---------- 结构探测工具 ----------

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

function tableColumns(name: string): string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((column) => column.name);
}

function ensureColumn(table: string, column: string, definition: string): void {
  if (!tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * 旧版 GitHub 认证的用户表没有 password_hash。
 * 按要求清空重建：删掉整套旧认证数据（用户、token、设备码、进度快照、成就），
 * 只执行一次，之后由新 schema 接管。
 */
{
  if (tableExists('users')) {
    const columns = tableColumns('users');
    if (!columns.includes('password_hash')) {
      db.exec(`
        DROP TABLE IF EXISTS user_achievements_v2;
        DROP TABLE IF EXISTS user_achievements;
        DROP TABLE IF EXISTS user_states_v2;
        DROP TABLE IF EXISTS user_states;
        DROP TABLE IF EXISTS device_codes;
        DROP TABLE IF EXISTS auth_tokens;
        DROP TABLE IF EXISTS users;
      `);
    }
  }
}

// ---------- 用户与认证 ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    member_until  INTEGER NOT NULL DEFAULT 0,
    disabled_at   INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
`);

// 旧库补列：会员与角色
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
ensureColumn('users', 'member_until', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'disabled_at', 'INTEGER');

// 老库没有管理员：把最早注册的用户提升为管理员，否则后台无人可用
{
  const admins = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").get() as {
    total: number;
  };
  if (admins.total === 0) {
    const first = db
      .prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1')
      .get() as { id: string } | undefined;
    if (first) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
  }
}

// ---------- 题库（草稿态）与发布包 ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS banks (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    subtitle        TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft',
    current_version INTEGER NOT NULL DEFAULT 0,
    question_count  INTEGER NOT NULL DEFAULT 0,
    chapter_count   INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_chapters (
    bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
    c       INTEGER NOT NULL,
    title   TEXT NOT NULL,
    sort    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bank_id, c)
  );

  -- 题目 ID 只在题库内唯一，因此主键是 (bank_id, id)：不同题库可以都用 1-1
  CREATE TABLE IF NOT EXISTS bank_questions (
    id          TEXT NOT NULL,
    bank_id     TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
    c           INTEGER NOT NULL,
    n           INTEGER NOT NULL,
    stem        TEXT NOT NULL,
    options     TEXT NOT NULL,
    answer      INTEGER NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    source_tag  TEXT NOT NULL DEFAULT '',
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (bank_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_bank_questions_bank ON bank_questions(bank_id, c, n);

  CREATE TABLE IF NOT EXISTS bank_releases (
    bank_id      TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    bundle       TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    published_at INTEGER NOT NULL,
    PRIMARY KEY (bank_id, version)
  );
`);

// 内置题库的占位行：老进度要迁到 bank_id = 'builtin'，外键要求这一行先存在。
// 内容由 seed 写入，发布版本见 bank_releases。
{
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO banks
       (id, name, subtitle, description, status, current_version, question_count, chapter_count, created_by, created_at, updated_at)
     VALUES (?, ?, '', '', 'published', 0, 0, 0, NULL, ?, ?)`,
  ).run(BUILTIN_BANK_ID, '清晖软考（高项）题库', now, now);
}

// ---------- 会员与统计 ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS redeem_codes (
    code          TEXT PRIMARY KEY,
    batch_id      TEXT,
    duration_days INTEGER NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL,
    redeemed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at   INTEGER,
    revoked_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch ON redeem_codes(batch_id);

  CREATE TABLE IF NOT EXISTS membership_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    days        INTEGER NOT NULL,
    code        TEXT,
    operator_id TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_daily (
    date         TEXT NOT NULL,
    bank_id      TEXT NOT NULL,
    active_users INTEGER NOT NULL DEFAULT 0,
    downloads    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, bank_id)
  );
`);

// ---------- 旧进度表 → 按题库 ----------

/**
 * user_states(user_id) → user_states_v2(user_id, bank_id)，旧数据统一落到 builtin；
 * user_achievements 同理。已迁移过（v2 表存在）就跳过，二次启动不会重复搬迁。
 */
function migratePerBankProgress(): void {
  if (tableExists('user_states_v2')) return;

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_states_v2 (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bank_id    TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
        state      TEXT NOT NULL,
        version    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, bank_id)
      );

      CREATE TABLE IF NOT EXISTS user_achievements_v2 (
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bank_id        TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
        achievement_id TEXT NOT NULL,
        unlocked_at    INTEGER NOT NULL,
        PRIMARY KEY (user_id, bank_id, achievement_id)
      );
    `);

    if (tableExists('user_states')) {
      db.exec(`
        INSERT OR IGNORE INTO user_states_v2 (user_id, bank_id, state, version, updated_at)
        SELECT user_id, '${BUILTIN_BANK_ID}', state, version, updated_at FROM user_states;
      `);
    }
    if (tableExists('user_achievements')) {
      db.exec(`
        INSERT OR IGNORE INTO user_achievements_v2 (user_id, bank_id, achievement_id, unlocked_at)
        SELECT user_id, '${BUILTIN_BANK_ID}', achievement_id, unlocked_at FROM user_achievements;
      `);
    }

    db.exec(`
      DROP TABLE IF EXISTS user_states;
      DROP TABLE IF EXISTS user_achievements;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

migratePerBankProgress();

// ---------- 用户 ----------

export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  username: string;
  name: string | null;
  role: UserRole;
  /** 会员到期时间戳（毫秒），0 表示从未开通 */
  memberUntil: number;
  /** 非空表示账号已被禁用 */
  disabledAt: number | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  name: string | null;
  password_hash: string;
  role: string;
  member_until: number;
  disabled_at: number | null;
  created_at: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'user',
    memberUntil: row.member_until ?? 0,
    disabledAt: row.disabled_at ?? null,
    createdAt: row.created_at,
  };
}

export interface UserRecord extends User {
  passwordHash: string;
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number };
  return row.total;
}

export function createUser(input: {
  username: string;
  name?: string | null;
  passwordHash: string;
  role?: UserRole;
  memberUntil?: number;
}): User {
  const now = Date.now();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role, member_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.username,
    input.name ?? null,
    input.passwordHash,
    input.role ?? 'user',
    input.memberUntil ?? 0,
    now,
    now,
  );
  return {
    id,
    username: input.username,
    name: input.name ?? null,
    role: input.role ?? 'user',
    memberUntil: input.memberUntil ?? 0,
    disabledAt: null,
    createdAt: now,
  };
}

export function findUserById(id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/** 登录校验需要密码哈希；只在服务端内部使用，不对外返回 */
export function findUserRecordByUsername(username: string): UserRecord | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined;
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

// ---------- 进度快照（按题库） ----------

export interface StoredState {
  state: PersistedState;
  version: number;
  updatedAt: number;
}

export function loadState(userId: string, bankId: string): StoredState | null {
  const row = db
    .prepare('SELECT state, version, updated_at FROM user_states_v2 WHERE user_id = ? AND bank_id = ?')
    .get(userId, bankId) as { state: string; version: number; updated_at: number } | undefined;
  if (!row) return null;
  return { state: normalizeState(JSON.parse(row.state)), version: row.version, updatedAt: row.updated_at };
}

export function saveState(
  userId: string,
  bankId: string,
  state: PersistedState,
  expectedVersion: number,
): StoredState {
  const now = Date.now();
  const nextVersion = expectedVersion + 1;
  db.prepare(
    `INSERT INTO user_states_v2 (user_id, bank_id, state, version, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, bank_id) DO UPDATE
       SET state = excluded.state, version = excluded.version, updated_at = excluded.updated_at
     WHERE user_states_v2.version = ?`,
  ).run(userId, bankId, JSON.stringify(state), nextVersion, now, expectedVersion);

  const saved = loadState(userId, bankId);
  if (!saved) throw new Error('保存进度失败');
  return saved;
}

/** 删除某个题库的云端进度（客户端删除题库时可选调用） */
export function deleteState(userId: string, bankId: string): void {
  db.prepare('DELETE FROM user_states_v2 WHERE user_id = ? AND bank_id = ?').run(userId, bankId);
}