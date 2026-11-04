/**
 * 题本 Quizbook 服务端入口。
 * 本地启动：pnpm --filter @quiz/server dev
 * 生产：同一个进程同时提供 API 与 Web 静态产物（apps/web/dist）。
 */
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { env, githubEnabled } from './env';
import { purgeExpiredDeviceCodes } from './auth';
import { registerRoutes } from './routes';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
});

await app.register(cors, {
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});

await app.register(formbody);

registerRoutes(app);

const webDist = resolve(env.webDist);
const hasWebDist = existsSync(resolve(webDist, 'index.html'));

if (hasWebDist) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    // 只提供 sendFile，实际路由交给 notFoundHandler，避免与 /api、/auth 抢路由
    wildcard: false,
  });
  app.log.info({ webDist }, '将托管 Web 静态产物');
} else {
  app.log.info({ webDist }, '未找到 Web 构建产物，仅提供 API（先执行 pnpm build）');
}

app.setNotFoundHandler(async (req, reply) => {
  const url = req.raw.url ?? '/';
  const pathname = url.split('?')[0];

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (!hasWebDist || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
  }

  // 带扩展名的按静态文件处理，其余走 SPA 入口
  const isAsset = pathname !== '/' && extname(pathname) !== '';
  const file = isAsset ? pathname.replace(/^\/+/, '') : 'index.html';
  try {
    return await reply.sendFile(file);
  } catch {
    return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
  }
});

purgeExpiredDeviceCodes();

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(
    {
      publicUrl: env.publicUrl,
      githubEnabled,
      devLogin: env.devLogin,
      dbPath: env.dbPath,
    },
    'quizbook-server 已启动',
  );
  if (!githubEnabled && env.devLogin) {
    app.log.warn('未配置 GitHub OAuth，当前仅支持开发模式登录（DEV_LOGIN=1）');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`收到 ${signal}，正在关闭`);
    await app.close();
    process.exit(0);
  });
}