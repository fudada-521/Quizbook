/**
 * 会员与兑换码。
 *
 * 会员状态只存在 `users.member_until` 一个字段里（毫秒时间戳），不单独建会员表；
 * 续期规则是 `max(now, member_until) + days`，已过期从当下重新起算。
 * 兑换码一码一人一次，兑换与续期写在同一个事务里，避免「码作废了但没加上时长」。
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { db, transaction } from './db';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_DAYS = 7;

/** 兑换码字符集：去掉 0/O/1/I 等易混淆字符 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type MembershipAction = 'trial' | 'redeem' | 'manual' | 'revoke';

export interface Membership {
  active: boolean;
  expiresAt: number;
}

export function memberState(memberUntil: number, now = Date.now()): Membership {
  return { active: memberUntil > now, expiresAt: memberUntil };
}

interface MemberRow {
  member_until: number;
}

function readMemberUntil(userId: string): number {
  const row = db.prepare('SELECT member_until FROM users WHERE id = ?').get(userId) as MemberRow | undefined;
  if (!row) throw new Error(`用户不存在：${userId}`);
  return row.member_until ?? 0;
}

/**
 * 延长会员时长并记一条流水。days 为负表示扣减（后台手动调整）。
 * 返回新的到期时间。
 */
export function extendMembership(
  userId: string,
  days: number,
  action: MembershipAction,
  options: { code?: string | null; operatorId?: string | null; now?: number } = {},
): number {
  const now = options.now ?? Date.now();
  const base = Math.max(now, readMemberUntil(userId));
  const until = Math.max(now, base + days * DAY_MS);

  db.prepare('UPDATE users SET member_until = ?, updated_at = ? WHERE id = ?').run(until, now, userId);
  db.prepare(
    `INSERT INTO membership_logs (id, user_id, action, days, code, operator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, action, days, options.code ?? null, options.operatorId ?? null, now);

  return until;
}

// ---------- 兑换码 ----------

function randomCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  return `MGR-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

/** 批量生成兑换码，返回生成的码。batch_id 便于后续导出与作废 */
export function generateCodes(input: {
  count: number;
  days: number;
  note?: string;
  operatorId?: string | null;
  batchId?: string;
}): string[] {
  const count = Math.max(1, Math.min(1000, Math.floor(input.count)));
  const days = Math.max(1, Math.floor(input.days));
  const now = Date.now();
  const batchId = input.batchId ?? randomUUID();

  const insert = db.prepare(
    `INSERT INTO redeem_codes (code, batch_id, duration_days, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const codes = new Set<string>();
  transaction(() => {
    while (codes.size < count) {
      const code = randomCode();
      if (codes.has(code)) continue;
      try {
        insert.run(code, batchId, days, input.note ?? '', input.operatorId ?? null, now);
        codes.add(code);
      } catch {
        // 极低概率的主键冲突：换一个码重试
      }
    }
  });

  return [...codes];
}

export type RedeemError = 'invalid_code' | 'code_used' | 'code_revoked';

export type RedeemResult =
  | { ok: true; membership: Membership; days: number }
  | { ok: false; error: RedeemError };

interface CodeRow {
  duration_days: number;
  redeemed_by: string | null;
  redeemed_at: number | null;
  revoked_at: number | null;
}

/** 兑换：一码一人一次，兑换与续期在同一事务内完成 */
export function redeemCode(userId: string, rawCode: string): RedeemResult {
  const code = normalizeCode(rawCode);
  const now = Date.now();

  const row = db
    .prepare('SELECT duration_days, redeemed_by, redeemed_at, revoked_at FROM redeem_codes WHERE code = ?')
    .get(code) as CodeRow | undefined;

  if (!row) return { ok: false, error: 'invalid_code' };
  if (row.revoked_at) return { ok: false, error: 'code_revoked' };
  if (row.redeemed_at || row.redeemed_by) return { ok: false, error: 'code_used' };

  try {
    const until = transaction(() => {
      const updated = db
        .prepare(
          'UPDATE redeem_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_at IS NULL AND revoked_at IS NULL',
        )
        .run(userId, now, code);
      if (updated.changes !== 1) throw new Error('code_used');
      return extendMembership(userId, row.duration_days, 'redeem', { code, now });
    });

    return { ok: true, membership: memberState(until, now), days: row.duration_days };
  } catch {
    // 并发兑换：另一个请求已经把这个码用掉了
    return { ok: false, error: 'code_used' };
  }
}