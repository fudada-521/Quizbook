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
import { normalizeState, type PersistedState } from '@quiz/core';

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    github_id   TEXT UNIQUE,
    login       TEXT NOT NULL,
    name        TEXT,
    avatar_url  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
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

  -- 设备码授权（App 轮询换取 token）。device_code 只存哈希；
  -- raw_token 仅在授权后短暂保存，供客户端领取一次，领取后立即清空。
  CREATE TABLE IF NOT EXISTS device_codes (
    id         TEXT PRIMARY KEY,
    user_code  TEXT NOT NULL UNIQUE,
    status     TEXT NOT NULL DEFAULT 'pending',
    user_id    TEXT,
    raw_token  TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

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
  githubId: string | null;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  github_id: string | null;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.github_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

export function upsertGithubUser(input: {
  githubId: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}): User {
  const now = Date.now();
  const existing = db
    .prepare('SELECT * FROM users WHERE github_id = ?')
    .get(input.githubId) as UserRow | undefined;

  if (existing) {
    db.prepare(
      'UPDATE users SET login = ?, name = ?, avatar_url = ?, updated_at = ? WHERE id = ?',
    ).run(input.login, input.name ?? null, input.avatarUrl ?? null, now, existing.id);
    return toUser({ ...existing, login: input.login, name: input.name ?? null, avatar_url: input.avatarUrl ?? null });
  }

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO users (id, github_id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.githubId, input.login, input.name ?? null, input.avatarUrl ?? null, now, now);
  return { id, githubId: input.githubId, login: input.login, name: input.name ?? null, avatarUrl: input.avatarUrl ?? null, createdAt: now };
}

export function findUserById(id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
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