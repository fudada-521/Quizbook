/**
 * HTTP 路由：
 *   - 用户名 + 密码注册 / 登录
 *   - 进度同步（始终与服务端快照合并）
 *   - 成就查询
 */
import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  achievementProgress,
  applyAchievements,
  BUILTIN_BANK_ID,
  mergeStates,
  normalizeState,
  type PersistedState,
} from '@megrez/core';
import { env } from './env';
import { quizData } from './questions';
import {
  hashPassword,
  issueToken,
  revokeToken,
  userFromToken,
  verifyPassword,
  type User,
} from './auth';
import { randomUUID } from 'node:crypto';
import {
  countUsers,
  createUser,
  deleteState,
  findUserById,
  findUserRecordByUsername,
  loadState,
  saveState,
} from './db';
import { getBankMeta, getPublishedBank, listPublishedBanks } from './banks';
import {
  extendMembership,
  generateCodes,
  redeemCode,
  TRIAL_DAYS,
} from './membership';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    rawToken?: string;
  }
}

/** 会员判定：member_until > now；未开通时 expiresAt 为 0 */
export function membershipOf(user: User, now = Date.now()) {
  return { active: user.memberUntil > now, expiresAt: user.memberUntil };
}

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    membership: membershipOf(user),
  };
}

function bearerToken(req: FastifyRequest): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const raw = bearerToken(req);
  const user = userFromToken(raw);
  if (!user) return reply.code(401).send({ error: 'unauthorized' });
  if (user.disabledAt) return reply.code(403).send({ error: 'account_disabled' });
  req.user = user;
  req.rawToken = raw;
}

/** 登录 + 会员：同步与下载其他题库都要过这一关 */
async function requireMember(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent || !req.user) return;
  if (req.user.memberUntil <= Date.now()) {
    return reply.code(402).send({
      error: 'membership_required',
      membership: membershipOf(req.user),
    });
  }
}

/** 登录 + 管理员：后端鉴权才是安全边界，前端的隐藏只是体验 */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent || !req.user) return;
  if (req.user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    !!v.answers && typeof v.answers === 'object' &&
    !!v.settings && typeof v.settings === 'object'
  );
}

// ---------- 失败限流（内存实现，按 key 计数） ----------

interface LimitEntry {
  count: number;
  resetAt: number;
}

function createLimiter(max: number, windowMs: number) {
  const store = new Map<string, LimitEntry>();
  return {
    limited(key: string): boolean {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        if (entry) store.delete(key);
        return false;
      }
      return entry.count >= max;
    },
    fail(key: string): void {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      entry.count += 1;
    },
    clear(key: string): void {
      store.delete(key);
    },
  };
}

/** 注册 / 登录：同 IP 10 分钟 20 次 */
const authLimiter = createLimiter(20, 10 * 60 * 1000);
/** 兑换码：同一用户 1 分钟 5 次 */
const redeemLimiter = createLimiter(5, 60 * 1000);

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function validateCredentials(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return '用户名需为 3–32 位字母、数字、下划线、点或短横线';
  }
  if (password.length < 8) return '密码至少 8 位';
  if (password.length > 128) return '密码过长';
  return null;
}

export function registerRoutes(app: FastifyInstance): void {
  // ---------- 基础信息 ----------

  app.get('/api/health', async () => ({ ok: true, now: Date.now(), service: 'megrez-server' }));

  app.get('/api/config', async () => ({
    authEnabled: true,
    registerEnabled: true,
    publicUrl: env.publicUrl,
  }));

  // ---------- 注册 / 登录 ----------

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/register',
    async (req, reply) => {
      const username = (req.body?.username ?? '').trim();
      const password = req.body?.password ?? '';
      const key = `register:${req.ip}`;

      if (authLimiter.limited(key)) {
        return reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
      }
      const invalid = validateCredentials(username, password);
      if (invalid) return reply.code(400).send({ error: invalid });

      const passwordHash = await hashPassword(password);
      let user: User;
      try {
        // 首个注册用户自动成为管理员
        user = createUser({
          username,
          passwordHash,
          role: countUsers() === 0 ? 'admin' : 'user',
        });
      } catch {
        // UNIQUE 约束：并发注册同名账号
        authLimiter.fail(key);
        return reply.code(409).send({ error: '用户名已被占用' });
      }

      // 新用户送 7 天试用，并记一条 trial 流水
      extendMembership(user.id, TRIAL_DAYS, 'trial');
      user = findUserById(user.id) ?? user;

      authLimiter.clear(key);
      return reply.send({ token: issueToken(user.id, 'password'), user: publicUser(user) });
    },
  );

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const username = (req.body?.username ?? '').trim();
      const password = req.body?.password ?? '';
      const key = `login:${req.ip}`;

      if (authLimiter.limited(key)) {
        return reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
      }

      const record = username ? findUserRecordByUsername(username) : null;
      // 用户不存在时也跑一次 scrypt，避免通过响应时间枚举用户名
      const valid = record
        ? await verifyPassword(password, record.passwordHash)
        : ((await hashPassword(password)), false);

      if (!record || !valid) {
        authLimiter.fail(key);
        return reply.code(401).send({ error: '用户名或密码错误' });
      }
      if (record.disabledAt) {
        return reply.code(403).send({ error: 'account_disabled' });
      }

      authLimiter.clear(key);
      return reply.send({
        token: issueToken(record.id, 'password'),
        user: publicUser(record),
      });
    },
  );

  // ---------- 当前用户 ----------

  app.get('/api/me', { preHandler: requireUser }, async (req) => ({
    user: publicUser(req.user!),
  }));

  app.post('/api/auth/logout', { preHandler: requireUser }, async (req) => {
    if (req.rawToken) revokeToken(req.rawToken);
    return { ok: true };
  });

  // ---------- 会员 ----------

  app.get('/api/membership', { preHandler: requireUser }, async (req) => membershipOf(req.user!));

  app.post<{ Body: { code?: string } }>(
    '/api/membership/redeem',
    { preHandler: requireUser },
    async (req, reply) => {
      const user = req.user!;
      const key = `redeem:${user.id}`;
      if (redeemLimiter.limited(key)) {
        return reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
      }

      const result = redeemCode(user.id, req.body?.code ?? '');
      if (!result.ok) {
        redeemLimiter.fail(key);
        const messages = {
          invalid_code: '兑换码无效',
          code_used: '兑换码已被使用',
          code_revoked: '兑换码已作废',
        } as const;
        return reply.code(400).send({ error: result.error, message: messages[result.error] });
      }

      redeemLimiter.clear(key);
      return { ...result.membership, days: result.days };
    },
  );

  // ---------- 管理：兑换码 ----------

  app.post<{ Body: { count?: number; days?: number; note?: string } }>(
    '/api/admin/redeem-codes',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const count = Number(req.body?.count ?? 0);
      const days = Number(req.body?.days ?? 0);
      if (!Number.isInteger(count) || count < 1 || count > 1000) {
        return reply.code(400).send({ error: 'invalid_count' });
      }
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return reply.code(400).send({ error: 'invalid_days' });
      }

      const batchId = randomUUID();
      const codes = generateCodes({
        count,
        days,
        note: req.body?.note ?? '',
        operatorId: req.user!.id,
        batchId,
      });
      return { batchId, days, codes };
    },
  );

  // ---------- 题库目录与题库包 ----------

  // 已发布题库的元数据：公开，未登录也能看到有哪些题库
  app.get('/api/banks', async () =>
    listPublishedBanks().map((bank) => ({
      id: bank.id,
      name: bank.name,
      subtitle: bank.subtitle,
      description: bank.description,
      version: bank.currentVersion,
      questionCount: bank.questionCount,
      chapterCount: bank.chapterCount,
      updatedAt: bank.updatedAt,
    })),
  );

  // 完整题库包：builtin 公开；其他题库需要登录 + 会员
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>(
    '/api/banks/:id/bundle',
    async (req, reply) => {
      const bankId = req.params.id;
      const meta = getBankMeta(bankId);
      if (!meta || meta.currentVersion === 0) {
        return reply.code(404).send({ error: 'not_found' });
      }

      if (bankId !== BUILTIN_BANK_ID) {
        const user = userFromToken(bearerToken(req));
        if (!user) return reply.code(401).send({ error: 'unauthorized' });
        if (user.disabledAt) return reply.code(403).send({ error: 'account_disabled' });
        if (user.memberUntil <= Date.now()) {
          return reply.code(402).send({
            error: 'membership_required',
            membership: membershipOf(user),
          });
        }
      }

      const requested = req.query.version;
      const version = requested === undefined ? undefined : Number(requested);
      if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
        return reply.code(400).send({ error: 'invalid_version' });
      }

      const release = getPublishedBank(bankId, version);
      if (!release) return reply.code(404).send({ error: 'not_found' });

      // 发布包不可变：版本号就是天然 ETag，客户端再次下载可直接 304
      const etag = `"${bankId}-v${release.version}"`;
      reply.header('ETag', etag);
      reply.header('Cache-Control', bankId === BUILTIN_BANK_ID ? 'public, max-age=0, must-revalidate' : 'private, max-age=0, must-revalidate');
      if (req.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }

      reply.type('application/json; charset=utf-8');
      const body = Buffer.from(JSON.stringify(release.bundle));
      if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
        reply.header('Content-Encoding', 'gzip');
        reply.header('Vary', 'Accept-Encoding');
        return reply.send(gzipSync(body));
      }
      return reply.send(body);
    },
  );

  // ---------- 按题库同步（会员） ----------

  /** 只有发布过的题库才能同步：草稿对客户端不存在 */
  function publishedBank(bankId: string) {
    const meta = getBankMeta(bankId);
    return meta && meta.currentVersion > 0 ? meta : null;
  }

  app.get<{ Params: { id: string } }>(
    '/api/banks/:id/sync',
    { preHandler: requireMember },
    async (req, reply) => {
      const bankId = req.params.id;
      if (!publishedBank(bankId)) return reply.code(404).send({ error: 'not_found' });
      const stored = loadState(req.user!.id, bankId);
      if (!stored) return { state: null, version: 0, updatedAt: null };
      return { state: stored.state, version: stored.version, updatedAt: stored.updatedAt };
    },
  );

  app.put<{ Params: { id: string }; Body: { state?: unknown; baseVersion?: number } }>(
    '/api/banks/:id/sync',
    { preHandler: requireMember, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
      const bankId = req.params.id;
      if (!publishedBank(bankId)) return reply.code(404).send({ error: 'not_found' });

      const { state, baseVersion } = req.body ?? {};
      if (!isPersistedState(state)) {
        return reply.code(400).send({ error: 'invalid_state' });
      }

      const current = loadState(req.user!.id, bankId);
      const currentVersion = current?.version ?? 0;

      // 服务端始终合并，而不是覆盖：即使 baseVersion 落后，也不会丢另一端的数据
      const merged = mergeStates(normalizeState(state), current?.state ?? null);

      // 成就用该题库自己的题目复核，避免拿内置题库的题去判定别的题库
      const release = getPublishedBank(bankId);
      const unlockedAchievements = release ? applyAchievements(merged, release.bundle) : [];

      const saved = saveState(req.user!.id, bankId, merged, currentVersion);
      if (saved.version !== currentVersion + 1) {
        return reply.code(409).send({
          error: 'conflict',
          version: saved.version,
          state: saved.state,
          updatedAt: saved.updatedAt,
        });
      }

      // baseVersion 仅保留在协议里用于诊断，合并策略不依赖它
      void baseVersion;
      return reply.send({
        state: merged,
        version: saved.version,
        updatedAt: saved.updatedAt,
        unlockedAchievements,
      });
    },
  );

  // 删除某个题库的云端进度（客户端「删除题库」时可选调用）
  app.delete<{ Params: { id: string } }>(
    '/api/banks/:id/sync',
    { preHandler: requireMember },
    async (req, reply) => {
      const bankId = req.params.id;
      if (!publishedBank(bankId)) return reply.code(404).send({ error: 'not_found' });
      deleteState(req.user!.id, bankId);
      return { ok: true };
    },
  );

  // 旧版全局同步接口：进度已按题库拆分，旧客户端只能升级
  app.get('/api/sync', async (_req, reply) =>
    reply.code(426).send({ error: 'upgrade_required', message: '请升级到支持按题库同步的客户端' }),
  );
  app.put('/api/sync', async (_req, reply) =>
    reply.code(426).send({ error: 'upgrade_required', message: '请升级到支持按题库同步的客户端' }),
  );

  // ---------- 成就 ----------

  app.get('/api/achievements', { preHandler: requireUser }, async (req) => {
    const stored = loadState(req.user!.id, BUILTIN_BANK_ID);
    const state = stored?.state ?? normalizeState({});
    if (!quizData) return { available: false, progress: [] };
    return {
      available: true,
      unlocked: state.achievements,
      progress: achievementProgress(state, quizData),
    };
  });
}