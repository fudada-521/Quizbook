# @quiz/server

题本 Quizbook 后端：GitHub 登录（设备码授权）+ 多端进度合并同步 + 成就权威校验。

## 本地启动

```bash
pnpm install
pnpm server:dev        # 默认 http://127.0.0.1:8787
```

不配置 `.env` 时自动启用**开发模式登录**（`DEV_LOGIN=1`），验证页会显示「开发模式登录（本机）」按钮，不需要 GitHub OAuth。

需要真实 GitHub 登录时：

```bash
cp apps/server/.env.example apps/server/.env
# 填入 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
# GitHub OAuth App 的回调地址填写：http://localhost:8787/api/auth/github/callback
pnpm server:dev
```

生产环境需要设置 `PUBLIC_URL` 为实际域名，并把 `DEV_LOGIN` 设为 `0`。

## 配置

见 [`.env.example`](./.env.example)。关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | 监听地址；手机同局域网调试改为 `0.0.0.0` |
| `PUBLIC_URL` | `http://localhost:8787` | 生成验证链接与 GitHub 回调地址 |
| `DB_PATH` | `apps/server/data/quizbook.db` | SQLite 文件（已 gitignore） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 空 | 留空则只支持开发登录 |
| `DEV_LOGIN` | 非生产环境为 `1` | 开发模式登录开关 |
| `CORS_ORIGIN` | `*` | 允许的来源，逗号分隔 |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 客户端可读取的登录配置 |
| POST | `/api/auth/device/start` | 生成设备码，返回 `deviceCode` / `userCode` / `verificationUrl` |
| GET | `/auth/device?code=XXXX-XXXX` | 用户确认页（GitHub 或开发登录） |
| POST | `/api/auth/device/poll` | App 轮询换取 token（一次性） |
| GET | `/api/me` | 当前用户（Bearer token） |
| POST | `/api/auth/logout` | 吊销当前 token |
| GET | `/api/sync` | 拉取进度快照 |
| PUT | `/api/sync` | 推送进度；服务端与远端合并后返回权威快照和本次新解锁成就 |
| GET | `/api/achievements` | 成就进度（服务端权威校验） |

登录 token 形如 `qbk_xxx`，服务端只保存 SHA-256 哈希。

## 数据

- SQLite 由 Node 24 内置的 `node:sqlite` 驱动，无原生依赖。
- 每个用户保存一份 `PersistedState` JSON 快照 + `version`；客户端推送时服务端用 `@quiz/core` 的 `mergeStates` 与远端快照合并，因此旧设备不会覆盖新数据。
- 生产环境应把 `data/` 目录做定时备份（直接拷贝 `quizbook.db` 前建议先 `sqlite3 ... ".backup"`，或停机拷贝 `.db` + `-wal`）。

## 部署（Docker + Caddy）

```bash
cd apps/server/deploy
cp .env.example .env        # 填写 DOMAIN / PUBLIC_URL / GitHub OAuth
docker compose up -d --build
```

Caddy 会自动申请 HTTPS 证书，并把请求反代到 server；server 同时托管 Web 单文件产物。
GitHub OAuth App 的回调地址填 `https://你的域名/api/auth/github/callback`。

生产环境务必：

- `DEV_LOGIN=0`（compose 已固定）
- 给 `quizbook-data` 卷做定时备份：

```bash
DB_PATH=/var/lib/docker/volumes/quizbook_quizbook-data/_data/quizbook.db \
BACKUP_DIR=/backup sh apps/server/scripts/backup.sh
```

> 本机 Docker 守护进程未运行，镜像构建尚未实际验证；部署前请先 `docker compose config` 检查配置。

## 当前范围

- [x] Fastify + TypeScript + SQLite 骨架
- [x] 设备码登录（GitHub OAuth / 开发模式）
- [x] Bearer token 鉴权、吊销
- [x] 服务端合并算法（`@quiz/core` 的 `mergeStates`，与客户端共用）
- [x] 成就权威校验（`/api/achievements`，同步时自动解锁）
- [x] Dockerfile / docker-compose / Caddyfile / 备份脚本