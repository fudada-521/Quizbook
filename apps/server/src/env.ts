/**
 * 运行时配置：优先读取 apps/server/.env（Node 20.12+ 的 process.loadEnvFile）。
 * 所有路径都以 apps/server 为基准，pnpm --filter 启动时 cwd 即该目录。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 8787);
const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');

export const env = {
  port,
  host: process.env.HOST ?? '127.0.0.1',
  publicUrl,
  dbPath: process.env.DB_PATH ?? resolve(process.cwd(), 'data/megrez.db'),
  webDist: process.env.WEB_DIST ?? resolve(process.cwd(), '../web/dist'),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** 登录 token 有效期（天） */
  tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS ?? 365),
} as const;