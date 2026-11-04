/**
 * GitHub OAuth（Authorization Code Flow）。
 * 只申请 read:user，用来拿 login / 昵称 / 头像。
 */
import { env, githubRedirectUri } from './env';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

export function githubAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env.githubClientId);
  url.searchParams.set('redirect_uri', githubRedirectUri);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeGithubCode(code: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: githubRedirectUri,
    }),
  });
  const data = (await res.json()) as GithubTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `GitHub token 交换失败 (${res.status})`);
  }
  return data.access_token;
}

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quizbook-server',
    },
  });
  if (!res.ok) throw new Error(`获取 GitHub 用户失败 (${res.status})`);
  return (await res.json()) as GithubUser;
}