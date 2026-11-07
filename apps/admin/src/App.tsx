import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  listBanks,
  login as apiLogin,
  me as apiMe,
  type AdminUser,
  type BankSummary,
} from './api';

/** 后台与答题端同域，用 sessionStorage 避免和玩家的 localStorage 登录态混用 */
const TOKEN_KEY = 'megrez_admin_token_v1';

export function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiMe(token)
      .then((result) => {
        if (!cancelled) setUser(result.user);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // token 过期 / 被吊销：回到登录页
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          signOut();
          return;
        }
        setError(err instanceof Error ? err.message : '无法连接服务器');
      });
    return () => {
      cancelled = true;
    };
  }, [token, signOut]);

  if (!token) {
    return (
      <LoginPage
        error={error}
        onSuccess={(nextToken, nextUser) => {
          sessionStorage.setItem(TOKEN_KEY, nextToken);
          setToken(nextToken);
          setUser(nextUser);
          setError(null);
        }}
        onError={setError}
      />
    );
  }

  if (!user) {
    return (
      <div className="center">
        <div className="card">
          <h1>正在验证登录…</h1>
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div className="center">
        <div className="card">
          <h1>无权访问</h1>
          <p className="hint">当前账号（{user.username}）不是管理员，请联系第一位注册的用户开通。</p>
          <button type="button" onClick={signOut}>
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard user={user} token={token} onSignOut={signOut} />;
}

function LoginPage(props: {
  error: string | null;
  onSuccess: (token: string, user: AdminUser) => void;
  onError: (message: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiLogin(username.trim(), password);
      props.onSuccess(result.token, result.user);
    } catch (err) {
      props.onError(err instanceof ApiError ? errorText(err) : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>Megrez 管理后台</h1>
        <p className="hint">使用管理员账号登录。首个注册的用户自动成为管理员。</p>
        <label>
          用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
        {props.error ? <p className="error">{props.error}</p> : null}
      </form>
    </div>
  );
}

function Dashboard(props: { user: AdminUser; token: string; onSignOut: () => void }) {
  const [banks, setBanks] = useState<BankSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBanks()
      .then((list) => {
        if (!cancelled) setBanks(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <h1>题库管理</h1>
          <div className="who">
            当前管理员：{props.user.username} · 会员到期{' '}
            {props.user.membership.expiresAt
              ? new Date(props.user.membership.expiresAt).toLocaleDateString('zh-CN')
              : '未开通'}
          </div>
        </div>
        <button type="button" className="ghost" onClick={props.onSignOut}>
          退出登录
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>题库 ID</th>
            <th>名称</th>
            <th>题目数</th>
            <th>章节数</th>
            <th>当前版本</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {banks === null ? (
            <tr>
              <td colSpan={6} className="empty">
                加载中…
              </td>
            </tr>
          ) : banks.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty">
                还没有已发布的题库
              </td>
            </tr>
          ) : (
            banks.map((bank) => (
              <tr key={bank.id}>
                <td>
                  <code>{bank.id}</code>
                </td>
                <td>{bank.name}</td>
                <td>{bank.questionCount}</td>
                <td>{bank.chapterCount}</td>
                <td>v{bank.version}</td>
                <td>{new Date(bank.updatedAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <p className="hint" style={{ marginTop: 16, color: 'var(--muted)' }}>
        导入、发布、兑换码与用户管理将在后续迭代接入（P3）。
      </p>
    </div>
  );
}

function errorText(err: ApiError): string {
  if (err.status === 401) return '用户名或密码错误';
  if (err.status === 403) return '账号已被禁用';
  if (err.status === 429) return '尝试次数过多，请稍后再试';
  return err.message || '登录失败';
}