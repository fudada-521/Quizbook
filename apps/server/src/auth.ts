/**
 * 认证：用户名 + 密码登录，签发不透明 Bearer token。
 * - 密码用 scrypt 加盐哈希存储，校验使用恒定时间比较；
 * - token 只保存 SHA-256 哈希，原文只在签发时出现；
 * - 不依赖 Cookie，Web / Tauri / Capacitor 三端通用。
 */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { db, findUserById, type User } from './db';
import { env } from './env';

const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** 生成 `scrypt$<salt>$<hash>` 形式的密码哈希 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newToken(): string {
  return `qbk_${randomBytes(32).toString('base64url')}`;
}

/** 为用户签发 token，返回明文（仅此一次） */
export function issueToken(userId: string, label?: string): string {
  const raw = newToken();
  const now = Date.now();
  db.prepare(
    'INSERT INTO auth_tokens (id, user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), userId, sha256(raw), label ?? null, now);
  return raw;
}

export function revokeToken(raw: string): void {
  db.prepare('UPDATE auth_tokens SET revoked_at = ? WHERE token_hash = ?').run(Date.now(), sha256(raw));
}

/** 根据 Bearer token 找用户；无效、过期或吊销返回 null */
export function userFromToken(raw: string): User | null {
  if (!raw) return null;
  const row = db
    .prepare(
      `SELECT user_id FROM auth_tokens
       WHERE token_hash = ? AND revoked_at IS NULL AND created_at >= ?`,
    )
    .get(sha256(raw), Date.now() - env.tokenTtlDays * 24 * 60 * 60 * 1000) as
    | { user_id: string }
    | undefined;
  if (!row) return null;
  db.prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(raw));
  return findUserById(row.user_id);
}

export type { User };