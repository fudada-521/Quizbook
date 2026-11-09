/**
 * 会员状态与题库目录的本机缓存。
 *
 * 启动时只读缓存，不联网校验会员；只有下载题库或同步前才按需刷新，
 * 保证断网 / 双击 `index.html` 打开时也能完整使用内置题库。
 */
import type { MembershipState, RemoteBankMeta } from '@megrez/storage/http';

export const MEMBERSHIP_KEY = 'megrez_membership_v1';
export const CATALOG_KEY = 'megrez_bank_catalog_v1';

export interface CachedMembership extends MembershipState {
  checkedAt: number;
}

export interface BankCatalog {
  fetchedAt: number;
  banks: RemoteBankMeta[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const s = storage();
  try {
    s?.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用时静默失败
  }
}

export function loadMembership(): CachedMembership | null {
  const value = readJson<CachedMembership>(MEMBERSHIP_KEY);
  if (!value || typeof value.active !== 'boolean') return null;
  return {
    active: value.active,
    expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
    checkedAt: typeof value.checkedAt === 'number' ? value.checkedAt : 0,
  };
}

export function saveMembership(state: MembershipState): CachedMembership {
  const cached: CachedMembership = {
    active: state.active,
    expiresAt: state.expiresAt,
    checkedAt: Date.now(),
  };
  writeJson(MEMBERSHIP_KEY, cached);
  return cached;
}

export function clearMembership(): void {
  const s = storage();
  try {
    s?.removeItem(MEMBERSHIP_KEY);
  } catch {
    // ignore
  }
}

/** 本地判断是否仍在会员有效期；过期后需要联网刷新一次 */
export function membershipIsActive(
  membership: CachedMembership | null,
  now = Date.now(),
): boolean {
  if (!membership?.active) return false;
  if (membership.expiresAt == null) return true;
  return membership.expiresAt > now;
}

export function loadCatalog(): BankCatalog | null {
  const value = readJson<BankCatalog>(CATALOG_KEY);
  if (!value || !Array.isArray(value.banks)) return null;
  return {
    fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
    banks: value.banks.filter(
      (bank): bank is RemoteBankMeta =>
        !!bank && typeof bank.id === 'string' && typeof bank.name === 'string',
    ),
  };
}

export function saveCatalog(banks: RemoteBankMeta[]): BankCatalog {
  const catalog: BankCatalog = { fetchedAt: Date.now(), banks };
  writeJson(CATALOG_KEY, catalog);
  return catalog;
}