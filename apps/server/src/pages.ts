/**
 * 设备码授权相关的极简 HTML 页面。
 * server 不引入模板引擎，保持零额外依赖。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 题本</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f6f3; --card: #ffffff; --text: #17181a; --muted: #6b6f76;
    --line: #e3e2dc; --accent: #17181a; --accent-text: #f6f6f3;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #141517; --card: #1c1e21; --text: #ececea; --muted: #9a9ea6; --line: #2c2f33; --accent: #ececea; --accent-text: #141517; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line);
    border-radius: 18px; padding: 28px 24px; box-shadow: 0 12px 40px rgba(0,0,0,.06);
  }
  h1 { font-size: 20px; margin: 0 0 10px; letter-spacing: .01em; }
  p { margin: 0 0 14px; color: var(--muted); line-height: 1.65; font-size: 14px; }
  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px;
    letter-spacing: .18em; text-align: center; padding: 16px 8px; margin: 6px 0 18px;
    border: 1px dashed var(--line); border-radius: 12px; user-select: all;
  }
  .btn {
    display: block; width: 100%; text-align: center; text-decoration: none; cursor: pointer;
    padding: 12px 16px; border-radius: 12px; border: 1px solid var(--accent);
    background: var(--accent); color: var(--accent-text); font-size: 15px; font-weight: 600;
  }
  .btn.secondary { margin-top: 10px; background: transparent; color: var(--text); border-color: var(--line); }
  form { margin: 0; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 16px; text-align: center; }
</style>
</head>
<body>
  <main class="card">${body}</main>
</body>
</html>`;
}

export function devicePage(opts: {
  userCode: string;
  expired: boolean;
  authorized: boolean;
  githubEnabled: boolean;
  devLogin: boolean;
}): string {
  const { userCode, expired, authorized, githubEnabled, devLogin } = opts;

  if (authorized) {
    return layout(
      '已授权',
      `<h1>已授权</h1>
       <p>授权完成，请回到「题本」应用，它会自动完成登录。</p>
       <div class="hint">可以关闭此页面了。</div>`,
    );
  }

  if (expired) {
    return layout(
      '授权码已过期',
      `<h1>授权码已过期</h1>
       <p>这个验证码已经失效，请回到应用重新发起登录。</p>`,
    );
  }

  const actions = [
    githubEnabled
      ? `<a class="btn" href="/auth/github/start?code=${encodeURIComponent(userCode)}">使用 GitHub 登录</a>`
      : '',
    devLogin
      ? `<form method="POST" action="/auth/device/approve">
           <input type="hidden" name="code" value="${escapeHtml(userCode)}">
           <button class="btn secondary" type="submit">开发模式登录（本机）</button>
         </form>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return layout(
    '确认登录',
    `<h1>确认登录</h1>
     <p>在「题本」应用中核对下面的验证码，确认一致后继续登录。</p>
     <div class="code">${escapeHtml(userCode)}</div>
     ${actions || `<p>服务端尚未配置登录方式。</p>`}
     <div class="hint">如果这不是你发起的登录，请直接关闭页面。</div>`,
  );
}

export function donePage(): string {
  return layout(
    '登录成功',
    `<h1>登录成功</h1>
     <p>已授权。请回到「题本」应用，它会自动完成登录并开始同步。</p>
     <div class="hint">现在可以关闭此页面了。</div>`,
  );
}

export function errorPage(message: string): string {
  return layout(
    '登录失败',
    `<h1>登录失败</h1>
     <p>${escapeHtml(message)}</p>
     <div class="hint">请回到应用重试，或检查服务端日志。</div>`,
  );
}