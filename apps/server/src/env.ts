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
  dbPath: process.env.DB_PATH ?? resolve(process.cwd(), 'data/quizbook.db'),
  githubClientId: process.env.GITHUB_CLIENT_ID ?? '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
  /** 未配置 GitHub 时，本地默认允许开发登录 */
  devLogin: process.env.DEV_LOGIN
    ? process.env.DEV_LOGIN === '1' || process.env.DEV_LOGIN === 'true'
    : process.env.NODE_ENV !== 'production',
  webDist: process.env.WEB_DIST ?? resolve(process.cwd(), '../web/dist'),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** 登录 token 有效期（天） */
  tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS ?? 365),
  /** 设备码有效期（秒） */
  deviceCodeTtlSeconds: Number(process.env.DEVICE_CODE_TTL_SECONDS ?? 600),
} as const;

/** GitHub OAuth 是否已配置 */
export const githubEnabled = Boolean(env.githubClientId && env.githubClientSecret);

export const githubRedirectUri = `${env.publicUrl}/api/auth/github/callback`;