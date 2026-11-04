# 待办事项（TODO）

> 记录当前项目已知的、尚未完成的工作项。完成后请更新状态并简要注明。

## 待办

### 云同步与成就

- [ ] **三端实机验证**：设备码登录（系统浏览器确认）、自动同步、断网回归
  - Web 已在本地后端验证通过；Tauri / Capacitor 未在真机跑过
  - 移动端首次使用需在「设置 → 账号与同步 → 服务器地址」填写局域网/公网后端地址
- [ ] 移动端原生存储（`@capacitor/preferences`）与桌面端文件存储接入后，再把 token 迁到同一层
- [ ] （可选）进度快照压缩；题库较大后考虑增量同步

### 部署

- [ ] 在目标服务器上 `docker compose up -d --build` 并验证 HTTPS、GitHub 回调
  - 本机 Docker 守护进程未启动，镜像尚未实际构建
- [ ] 配置 `scripts/backup.sh` 的 cron 定时备份

### 桌面端（Tauri）

- [ ] 桌面端进度接文件存储（当前桌面端与 Web 共用 localStorage，关闭窗口仍在 WebView 缓存里，但未落盘到独立文件）
  - 建议用 `tauri-plugin-store`，在 `ProgressStore` 适配器中实现 `load`/`save` 走文件
- [ ] 打包正式产物并签名（`pnpm desktop:build`；macOS 需开发者证书签名才可分发）

### 移动端（Capacitor）

- [ ] 移动端进度接原生存储（`@capacitor/preferences`），避免依赖 WebView localStorage
- [ ] iOS/Android 打包上架（需 Apple 开发者账号 / Google Play 账号）

### 题库与内容

- [ ] （可选）整理案例题《案例金色考点及真题解析.pdf》为结构化题库
- [ ] （可选）修正 OCR 错别字（如"的/钓"混用），可做批量校对

### 工程

- [ ] （可选）加 lint（ESLint + Prettier）与 pre-commit hook
- [ ] （可选）加 CI 流水线（自动跑 `pnpm test` + `pnpm typecheck` + 三端构建）
- [ ] （可选）Web 端部署到静态托管（GitHub Pages / Vercel）以便云端访问

## 已完成

- [x] 后端 P0：`apps/server`（Fastify + node:sqlite、设备码登录、GitHub OAuth、Bearer 鉴权、进度同步接口、本地开发登录）
- [x] 云同步 P1/P2：schema v4、`mergeStates()` 多端合并（answers/wrong/favorites/notes/settings/daily/challenges/achievements + resetAt）、`CloudClient` + token 存取、登录/同步 UI、1.2s 防抖自动推送与启动拉取
- [x] 挑战模式：每日一练（10 题）、限时挑战（20 题/10 分钟）、模拟考（75 题/150 分钟，45 分及格），确定性抽题与计时自动交卷
- [x] 成就系统：10 个核心成就（进度/习惯/收藏/挑战），本地即时解锁 + 服务端权威校验，成就页与解锁提示
- [x] 部署产物：`apps/server/Dockerfile`、`deploy/docker-compose.yml`、`Caddyfile`、`.env.example`、`scripts/backup.sh`
- [x] 题库从 `questions.js` 转为 `data/questions.json`（唯一数据源）
- [x] 抽出 `@quiz/core`（判分/抽题/错题/收藏/心得/进度纯函数 + 29 个单测）
- [x] 抽出 `@quiz/storage`（`ProgressStore` / `SyncBackend` 接口 + noop 桩 + 文件导入导出）
- [x] React+Vite+TS 重写 UI，保留百词斩式体验（单文件构建，双击离线可用 + PWA）
- [x] Tauri 2 桌面壳编译通过（产物已生成）
- [x] Capacitor 7 移动壳（iOS/Android 原生工程已生成）
- [x] 进度 schema 版本化（当前 `schemaVersion: 4`，新增 `daily` / `challenges` / `achievements` / `favoriteRemovals` / `settingsAt` / `resetAt`）
- [x] 极简工具风 UI 重设计（浅色/深色自动跟随系统、断点续做）
- [x] 收藏夹：题卡星标、收藏列表与只读详情、全部收藏专项练习
- [x] 题目心得：解析页与收藏详情中的只追加时间线，写心得时暂停自动跳题
