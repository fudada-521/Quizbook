<!-- @format -->

# @megrez/server

Megrez Megrez 后端：用户名 + 密码登录 + 多端进度合并同步 + 成就权威校验。

## 本地启动

```bash
pnpm install
pnpm server:dev        # 默认 http://127.0.0.1:8787
```

首次使用在 App 的设置页直接输入用户名和密码注册；也可以调用接口：

```bash
curl -X POST http://127.0.0.1:8787/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"fukun","password":"至少八位的密码"}'
```

## 配置

见 [`.env.example`](./.env.example)。关键项：

| 变量             | 默认                         | 说明                                     |
| ---------------- | ---------------------------- | ---------------------------------------- |
| `HOST` / `PORT`  | `127.0.0.1` / `8787`         | 监听地址；手机同局域网调试改为 `0.0.0.0` |
| `PUBLIC_URL`     | `http://localhost:8787`      | 对外地址，仅用于展示/诊断                |
| `DB_PATH`        | `apps/server/data/megrez.db` | SQLite 文件（已 gitignore）              |
| `CORS_ORIGIN`    | `*`                          | 允许的来源，逗号分隔                     |
| `TOKEN_TTL_DAYS` | `365`                        | 登录 token 有效期                        |

## 接口

| 方法   | 路径                              | 权限   | 说明                                                     |
| ------ | --------------------------------- | ------ | -------------------------------------------------------- |
| GET    | `/api/health`                     | 公开   | 健康检查                                                 |
| GET    | `/api/config`                     | 公开   | 客户端可读取的服务配置                                   |
| POST   | `/api/auth/register`              | 公开   | 注册并登录；首个用户 `admin`，新用户送 7 天试用          |
| POST   | `/api/auth/login`                 | 公开   | 用户名 + 密码登录；禁用账号返回 403                      |
| GET    | `/api/me`                         | 登录   | 当前用户与会员状态                                       |
| POST   | `/api/auth/logout`                | 登录   | 吊销当前 token                                           |
| GET    | `/api/banks`                      | 公开   | 已发布题库的元数据列表                                   |
| GET    | `/api/banks/:id/bundle`           | 见下   | 完整题库包，支持 ETag / 304 / gzip；`builtin` 公开       |
| GET    | `/api/banks/:id/sync`             | 会员   | 拉取该题库的云端进度                                     |
| PUT    | `/api/banks/:id/sync`             | 会员   | 推送并与远端合并，返回权威快照与本次新解锁成就           |
| DELETE | `/api/banks/:id/sync`             | 会员   | 删除该题库的云端进度                                     |
| GET    | `/api/membership`                 | 登录   | 会员状态 `{ active, expiresAt }`                         |
| POST   | `/api/membership/redeem`          | 登录   | `{ code }` 兑换会员时长                                  |
| POST   | `/api/admin/redeem-codes`         | 管理员 | 批量生成兑换码 `{ count, days, note }`                   |
| GET    | `/api/achievements`               | 登录   | 内置题库的成就进度（服务端权威校验）                     |

`/api/sync` 已废弃，旧客户端调用会收到 `426 Upgrade Required`。

登录 token 形如 `qbk_xxx`，服务端只保存 SHA-256 哈希；密码使用 scrypt 加盐哈希存储。
登录/注册按 IP 限制频率（10 分钟内最多 20 次），兑换码按用户限制（1 分钟 5 次）。

## 数据

- SQLite 由 Node 24 内置的 `node:sqlite` 驱动，无原生依赖。
- 题库分两层：`banks` / `bank_chapters` / `bank_questions` 是草稿，`bank_releases` 是每次发布生成的不可变完整包；客户端只读发布包。
- 进度按「用户 × 题库」各存一份 `PersistedState` JSON 快照 + `version`；客户端推送时服务端用 `@megrez/core` 的 `mergeStates` 与远端快照合并，因此旧设备不会覆盖新数据。
- 旧库启动时自动迁移：`user_states` → `user_states_v2(user_id, bank_id)`，老数据落到 `builtin`；`users` 补 `role` / `member_until` / `disabled_at`，并把最早注册的用户提升为管理员。
- 首次启动会把 `data/questions.json` 导入为内置题库并发布 v1；已有题目时跳过，不会覆盖。
- 生产环境应把 `data/` 目录做定时备份（直接拷贝 `megrez.db` 前建议先 `sqlite3 ... ".backup"`，或停机拷贝 `.db` + `-wal`）。

## 部署（Docker + Caddy）

```bash
cd apps/server/deploy
cp .env.example .env        # 填写 DOMAIN / PUBLIC_URL
docker compose up -d --build
```

Caddy 会自动申请 HTTPS 证书，并把请求反代到 server；server 同时托管 Web 单文件产物。

生产环境务必给 `megrez-data` 卷做定时备份：

```bash
DB_PATH=/var/lib/docker/volumes/megrez_megrez-data/_data/megrez.db \
BACKUP_DIR=/backup sh apps/server/scripts/backup.sh
```

> 镜像已在本地 Docker 实测通过：构建成功，容器内 `/`、`/admin/`、注册/登录、题库包（ETag/304/gzip）、按题库同步、兑换码与旧接口 426 均正常。部署前仍建议先 `docker compose config` 检查配置。

## 当前范围

- [x] Fastify + TypeScript + SQLite 骨架
- [x] 用户名 + 密码注册 / 登录（scrypt 哈希、失败限流）
- [x] Bearer token 鉴权、吊销；角色与禁用
- [x] 服务端合并算法（`@megrez/core` 的 `mergeStates`，与客户端共用）
- [x] 成就权威校验（`/api/achievements`，同步时自动解锁）
- [x] 题库草稿 / 发布 / 版本包、`GET /api/banks`、`bundle`（ETag / 304 / gzip）
- [x] 按题库同步（`/api/banks/:id/sync`）与旧接口 426
- [x] 会员字段、7 天试用、兑换码、`requireMember` / `requireAdmin`
- [x] 内置题库幂等 seed；旧库自动迁移
- [x] `/admin/` 托管管理后台产物
- [x] Dockerfile / docker-compose / Caddyfile / 备份脚本
- [ ] 后台题库编辑、批量导入、用户管理、统计看板（P3 / P4）
