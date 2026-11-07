/**
 * Megrez Megrez 服务端入口。
 * 本地启动：pnpm --filter @megrez/server dev
 * 生产：同一个进程同时提供 API 与 Web 静态产物（apps/web/dist）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { env } from './env';
import { registerRoutes } from './routes';
import { seedBuiltinBank } from './banks';
import { quizData } from './questions';

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

registerRoutes(app);

// 首次启动把 data/questions.json 导入为内置题库并发布 v1；已有数据时跳过
{
  const seeded = seedBuiltinBank(quizData);
  if (!quizData) {
    app.log.warn('未找到内置题库文件，跳过 seed（可用 QUESTIONS_PATH 指定）');
  } else {
    app.log.info(seeded, seeded.seeded ? '内置题库已导入' : '内置题库已存在，跳过 seed');
  }
}

const webDist = resolve(env.webDist);
const hasWebDist = existsSync(resolve(webDist, 'index.html'));

const adminDist = resolve(env.adminDist);
const adminIndexPath = resolve(adminDist, 'index.html');
const hasAdminDist = existsSync(adminIndexPath);

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

if (hasAdminDist) {
  await app.register(fastifyStatic, {
    root: adminDist,
    prefix: '/admin/',
    // 第二个 @fastify/static 实例不能再装饰 reply.sendFile
    decorateReply: false,
  });
  app.log.info({ adminDist }, '将托管管理后台产物');
} else {
  app.log.info({ adminDist }, '未找到管理后台产物，/admin 不可用（先执行 pnpm admin:build）');
}

app.setNotFoundHandler(async (req, reply) => {
  const url = req.raw.url ?? '/';
  const pathname = url.split('?')[0];
  const isRead = req.method === 'GET' || req.method === 'HEAD';

  if (pathname.startsWith('/api/')) {
    return reply.code(404).send({ error: 'not_found' });
  }

  // 管理后台：/admin 与 /admin/<前端路由> 都回 admin 的 index.html
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname === '/admin') return reply.redirect('/admin/', 301);
    // 静态资源不存在的就是 404，只有前端路由才回落到 SPA 入口
    const adminAsset = pathname !== '/admin/' && extname(pathname) !== '';
    if (!hasAdminDist || !isRead || adminAsset) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
    }
    return reply.type('text/html; charset=utf-8').send(readFileSync(adminIndexPath, 'utf8'));
  }

  if (!hasWebDist || !isRead) {
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

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(
    {
      publicUrl: env.publicUrl,
      dbPath: env.dbPath,
    },
    'megrez-server 已启动',
  );
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