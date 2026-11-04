/**
 * HTTP 路由：
 *   - 用户名 + 密码注册 / 登录
 *   - 进度同步（始终与服务端快照合并）
 *   - 成就查询
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  achievementProgress,
  applyAchievements,
  mergeStates,
  normalizeState,
  type PersistedState,
} from '@quiz/core';
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
import { createUser, findUserRecordByUsername, loadState, saveState } from './db';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    rawToken?: string;
  }
}

function publicUser(user: User) {
  return { id: user.id, username: user.username, name: user.name };
}

async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = userFromToken(raw);
  if (!user) return reply.code(401).send({ error: 'unauthorized' });
  req.user = user;
  req.rawToken = raw;
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

// ---------- 登录失败限流（内存实现，按 IP 计数） ----------

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    if (entry) attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearFailures(key: string): void {
  attempts.delete(key);
}

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

  app.get('/api/health', async () => ({ ok: true, now: Date.now(), service: 'quizbook-server' }));

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

      if (isRateLimited(key)) {
        return reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
      }
      const invalid = validateCredentials(username, password);
      if (invalid) return reply.code(400).send({ error: invalid });

      const passwordHash = await hashPassword(password);
      let user: User;
      try {
        user = createUser({ username, passwordHash });
      } catch {
        // UNIQUE 约束：并发注册同名账号
        recordFailure(key);
        return reply.code(409).send({ error: '用户名已被占用' });
      }

      clearFailures(key);
      return reply.send({ token: issueToken(user.id, 'password'), user: publicUser(user) });
    },
  );

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const username = (req.body?.username ?? '').trim();
      const password = req.body?.password ?? '';
      const key = `login:${req.ip}`;

      if (isRateLimited(key)) {
        return reply.code(429).send({ error: '尝试次数过多，请稍后再试' });
      }

      const record = username ? findUserRecordByUsername(username) : null;
      // 用户不存在时也跑一次 scrypt，避免通过响应时间枚举用户名
      const valid = record
        ? await verifyPassword(password, record.passwordHash)
        : ((await hashPassword(password)), false);

      if (!record || !valid) {
        recordFailure(key);
        return reply.code(401).send({ error: '用户名或密码错误' });
      }

      clearFailures(key);
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

  // ---------- 进度同步 ----------

  app.get('/api/sync', { preHandler: requireUser }, async (req) => {
    const stored = loadState(req.user!.id);
    if (!stored) return { state: null, version: 0, updatedAt: null };
    return { state: stored.state, version: stored.version, updatedAt: stored.updatedAt };
  });

  app.put<{ Body: { state?: unknown; baseVersion?: number } }>(
    '/api/sync',
    { preHandler: requireUser, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
      const { state, baseVersion } = req.body ?? {};
      if (!isPersistedState(state)) {
        return reply.code(400).send({ error: 'invalid_state' });
      }

      const current = loadState(req.user!.id);
      const currentVersion = current?.version ?? 0;

      // 服务端始终合并，而不是覆盖：即使 baseVersion 落后，也不会丢另一端的数据
      const merged = mergeStates(normalizeState(state), current?.state ?? null);
      const unlockedAchievements = quizData ? applyAchievements(merged, quizData) : [];

      const saved = saveState(req.user!.id, merged, currentVersion);
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

  // ---------- 成就 ----------

  app.get('/api/achievements', { preHandler: requireUser }, async (req) => {
    const stored = loadState(req.user!.id);
    const state = stored?.state ?? normalizeState({});
    if (!quizData) return { available: false, progress: [] };
    return {
      available: true,
      unlocked: state.achievements,
      progress: achievementProgress(state, quizData),
    };
  });
}