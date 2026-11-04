/**
 * HTTP 路由：
 *   - 设备码授权（三端统一登录）
 *   - GitHub OAuth 回调
 *   - 进度同步（乐观并发 + 冲突回传，合并逻辑 P1 接入）
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  achievementProgress,
  applyAchievements,
  mergeStates,
  normalizeState,
  type PersistedState,
} from '@quiz/core';
import { env, githubEnabled } from './env';
import { quizData } from './questions';
import {
  authorizeDeviceCode,
  consumeAuthorizedDeviceCode,
  createDeviceCode,
  devUser,
  findDeviceByDeviceCode,
  findDeviceByUserCode,
  issueToken,
  revokeToken,
  userFromToken,
  type User,
} from './auth';
import { upsertGithubUser, loadState, saveState } from './db';
import { exchangeGithubCode, fetchGithubUser, githubAuthorizeUrl } from './github';
import { devicePage, donePage, errorPage } from './pages';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    rawToken?: string;
  }
}

function publicUser(user: User) {
  return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl };
}

function sendHtml(reply: FastifyReply, html: string, status = 200) {
  return reply.code(status).type('text/html; charset=utf-8').send(html);
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

export function registerRoutes(app: FastifyInstance): void {
  // ---------- 基础信息 ----------

  app.get('/api/health', async () => ({ ok: true, now: Date.now(), service: 'quizbook-server' }));

  app.get('/api/config', async () => ({
    authEnabled: true,
    githubEnabled,
    devLogin: env.devLogin,
    publicUrl: env.publicUrl,
  }));

  // ---------- 设备码授权 ----------

  app.post('/api/auth/device/start', async (_req, reply) => {
    const { deviceCode, userCode, expiresAt } = createDeviceCode();
    return reply.send({
      deviceCode,
      userCode,
      verificationUrl: `${env.publicUrl}/auth/device?code=${encodeURIComponent(userCode)}`,
      expiresIn: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
      interval: 2,
    });
  });

  app.post<{ Body: { deviceCode?: string } }>('/api/auth/device/poll', async (req, reply) => {
    const deviceCode = req.body?.deviceCode;
    if (!deviceCode) return reply.code(400).send({ error: 'missing_device_code' });

    const code = findDeviceByDeviceCode(deviceCode);
    if (!code) return reply.code(404).send({ error: 'invalid_device_code' });
    if (code.expiresAt < Date.now()) {
      return reply.send({ status: 'expired' });
    }
    if (code.status === 'pending') {
      return reply.send({ status: 'pending', interval: 2 });
    }

    const consumed = consumeAuthorizedDeviceCode(deviceCode);
    if (!consumed) return reply.code(404).send({ error: 'invalid_device_code' });
    return reply.send({
      status: 'authorized',
      token: consumed.rawToken,
      user: publicUser(consumed.user),
    });
  });

  // 用户码验证页：用户在这里确认登录
  app.get<{ Querystring: { code?: string } }>('/auth/device', async (req, reply) => {
    const userCode = req.query.code ?? '';
    const code = userCode ? findDeviceByUserCode(userCode) : null;
    if (!code) return sendHtml(reply, errorPage('验证码无效，请回到应用重新发起登录。'), 400);

    const expired = code.expiresAt < Date.now();
    if (!expired && code.status === 'authorized') {
      return sendHtml(reply, devicePage({
        userCode: code.userCode,
        expired: false,
        authorized: true,
        githubEnabled,
        devLogin: env.devLogin,
      }));
    }
    return sendHtml(reply, devicePage({
      userCode: code.userCode,
      expired,
      authorized: false,
      githubEnabled,
      devLogin: env.devLogin,
    }), expired ? 410 : 200);
  });

  // 开发模式：不经过 GitHub，直接绑定固定开发账号
  app.post<{ Body: { code?: string } }>('/auth/device/approve', async (req, reply) => {
    if (!env.devLogin) return reply.code(403).send({ error: 'dev_login_disabled' });
    const userCode = req.body?.code ?? '';
    const code = findDeviceByUserCode(userCode);
    if (!code || code.status !== 'pending' || code.expiresAt < Date.now()) {
      return sendHtml(reply, errorPage('验证码无效或已过期。'), 400);
    }
    const user = devUser();
    const rawToken = issueToken(user.id, 'dev-device');
    authorizeDeviceCode(code.userCode, user.id, rawToken);
    return reply.redirect('/auth/done');
  });

  // 把验证码交给 GitHub OAuth
  app.get<{ Querystring: { code?: string } }>('/auth/github/start', async (req, reply) => {
    if (!githubEnabled) return sendHtml(reply, errorPage('服务端尚未配置 GitHub 登录。'), 503);
    const code = findDeviceByUserCode(req.query.code ?? '');
    if (!code || code.status !== 'pending' || code.expiresAt < Date.now()) {
      return sendHtml(reply, errorPage('验证码无效或已过期。'), 400);
    }
    return reply.redirect(githubAuthorizeUrl(code.userCode));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/api/auth/github/callback',
    async (req, reply) => {
      const { code, state, error, error_description } = req.query;
      if (error) return sendHtml(reply, errorPage(error_description || error), 400);
      if (!code || !state) return sendHtml(reply, errorPage('GitHub 回调缺少参数。'), 400);

      const device = findDeviceByUserCode(state);
      if (!device || device.expiresAt < Date.now()) {
        return sendHtml(reply, errorPage('登录会话已过期，请回到应用重试。'), 400);
      }

      try {
        const accessToken = await exchangeGithubCode(code);
        const ghUser = await fetchGithubUser(accessToken);
        const user = upsertGithubUser({
          githubId: String(ghUser.id),
          login: ghUser.login,
          name: ghUser.name,
          avatarUrl: ghUser.avatar_url,
        });
        const rawToken = issueToken(user.id, `github:${ghUser.login}`);
        authorizeDeviceCode(device.userCode, user.id, rawToken);
        return reply.redirect('/auth/done');
      } catch (err) {
        req.log.error({ err }, 'GitHub OAuth 失败');
        return sendHtml(reply, errorPage('GitHub 授权失败，请稍后重试。'), 502);
      }
    },
  );

  app.get('/auth/done', async (_req, reply) => sendHtml(reply, donePage()));

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