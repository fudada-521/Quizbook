/**
 * SQLite 持久层（Node 24 内置 node:sqlite，无原生依赖）。
 *
 * 单用户场景下不需要把进度拆成关系表：每个用户存一份合并后的 JSON 快照，
 * 配合 version 做乐观并发控制，冲突时由客户端/服务端合并后重试。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env';
import { normalizeState, type PersistedState } from '@megrez/core';

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/**
 * 旧版 GitHub 认证的用户表没有 password_hash。
 * 按要求清空重建：删掉整套旧认证数据（用户、token、设备码、进度快照、成就），
 * 只执行一次，之后由新 schema 接管。
 */
{
  const usersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { name: string } | undefined;
  if (usersTable) {
    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'password_hash')) {
      db.exec(`
        DROP TABLE IF EXISTS user_achievements;
        DROP TABLE IF EXISTS user_states;
        DROP TABLE IF EXISTS device_codes;
        DROP TABLE IF EXISTS auth_tokens;
        DROP TABLE IF EXISTS users;
      `);
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT,
    password_hash TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS user_states (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state      TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- 成就解锁记录（P3 使用；先建表避免后续迁移）
  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );
`);

export interface User {
  id: string;
  username: string;
  name: string | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  name: string | null;
  password_hash: string;
  created_at: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    createdAt: row.created_at,
  };
}

export interface UserRecord extends User {
  passwordHash: string;
}

export function createUser(input: {
  username: string;
  name?: string | null;
  passwordHash: string;
}): User {
  const now = Date.now();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO users (id, username, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.username, input.name ?? null, input.passwordHash, now, now);
  return { id, username: input.username, name: input.name ?? null, createdAt: now };
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

export interface StoredState {
  state: PersistedState;
  version: number;
  updatedAt: number;
}

export function loadState(userId: string): StoredState | null {
  const row = db
    .prepare('SELECT state, version, updated_at FROM user_states WHERE user_id = ?')
    .get(userId) as { state: string; version: number; updated_at: number } | undefined;
  if (!row) return null;
  return { state: normalizeState(JSON.parse(row.state)), version: row.version, updatedAt: row.updated_at };
}

export function saveState(userId: string, state: PersistedState, expectedVersion: number): StoredState {
  const now = Date.now();
  const nextVersion = expectedVersion + 1;
  db.prepare(
    `INSERT INTO user_states (user_id, state, version, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, version = excluded.version, updated_at = excluded.updated_at
     WHERE user_states.version = ?`,
  ).run(userId, JSON.stringify(state), nextVersion, now, expectedVersion);

  const saved = loadState(userId);
  if (!saved) throw new Error('保存进度失败');
  return saved;
}