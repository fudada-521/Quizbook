/**
 * 认证：不透明 Bearer token + 设备码授权。
 * - token 只保存 SHA-256 哈希，原文只在签发/领取时出现；
 * - 设备码授权让 Web / Tauri / Capacitor 三端统一走系统浏览器登录，
 *   不需要各平台各自处理 OAuth 回调。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, findUserById, upsertGithubUser, type User } from './db';
import { env } from './env';

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newToken(): string {
  return `qbk_${randomBytes(32).toString('base64url')}`;
}

/** 生成 XXXX-XXXX 形式、去掉易混淆字符的用户码 */
export function newUserCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

export function normalizeUserCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.{1,4})/, '$1-$2');
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

/** 根据 Bearer token 找用户；无效/过期/吊销返回 null */
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

export interface DeviceCode {
  id: string;
  userCode: string;
  status: 'pending' | 'authorized';
  userId: string | null;
  rawToken: string | null;
  createdAt: number;
  expiresAt: number;
}

interface DeviceRow {
  id: string;
  user_code: string;
  status: string;
  user_id: string | null;
  raw_token: string | null;
  created_at: number;
  expires_at: number;
}

function toDeviceCode(row: DeviceRow): DeviceCode {
  return {
    id: row.id,
    userCode: row.user_code,
    status: row.status === 'authorized' ? 'authorized' : 'pending',
    userId: row.user_id,
    rawToken: row.raw_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** 清理过期设备码（懒清理，启动与每次轮询时调用） */
export function purgeExpiredDeviceCodes(now = Date.now()): void {
  db.prepare('DELETE FROM device_codes WHERE expires_at < ?').run(now);
}

export function createDeviceCode(): { deviceCode: string; userCode: string; expiresAt: number } {
  purgeExpiredDeviceCodes();
  const deviceCode = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + env.deviceCodeTtlSeconds * 1000;

  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = newUserCode();
    try {
      db.prepare(
        'INSERT INTO device_codes (id, user_code, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).run(sha256(deviceCode), userCode, 'pending', now, expiresAt);
      return { deviceCode, userCode, expiresAt };
    } catch {
      // user_code 撞车，换一个重试
    }
  }
  throw new Error('无法生成设备码');
}

export function findDeviceByUserCode(userCode: string): DeviceCode | null {
  const row = db
    .prepare('SELECT * FROM device_codes WHERE user_code = ?')
    .get(normalizeUserCode(userCode)) as DeviceRow | undefined;
  return row ? toDeviceCode(row) : null;
}

export function findDeviceByDeviceCode(deviceCode: string): DeviceCode | null {
  const row = db
    .prepare('SELECT * FROM device_codes WHERE id = ?')
    .get(sha256(deviceCode)) as DeviceRow | undefined;
  return row ? toDeviceCode(row) : null;
}

/** 授权：记录用户并暂存明文 token，等待 App 轮询领取 */
export function authorizeDeviceCode(userCode: string, userId: string, rawToken: string): boolean {
  const result = db
    .prepare(
      `UPDATE device_codes SET status = 'authorized', user_id = ?, raw_token = ?
       WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
    )
    .run(userId, rawToken, normalizeUserCode(userCode), Date.now());
  return Number(result.changes) === 1;
}

/** App 领取 token：一次性删除记录 */
export function consumeAuthorizedDeviceCode(deviceCode: string): { rawToken: string; user: User } | null {
  const code = findDeviceByDeviceCode(deviceCode);
  if (!code || code.status !== 'authorized' || !code.userId || !code.rawToken) return null;
  const user = findUserById(code.userId);
  if (!user) return null;
  db.prepare('DELETE FROM device_codes WHERE id = ?').run(code.id);
  return { rawToken: code.rawToken, user };
}

/** 开发登录：未配置 GitHub 时使用的固定账号 */
export function devUser(): User {
  return upsertGithubUser({
    githubId: 'dev-local',
    login: 'dev',
    name: '本地开发账号',
  });
}

export type { User };