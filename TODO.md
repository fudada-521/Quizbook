# 待办事项（TODO）

> 记录当前项目已知的、尚未完成的工作项。完成后请更新状态并简要注明。

## 进行中

（无）

## 待办

### 云同步（SyncBackend）

- [ ] **实现真正的账号云同步后端**（当前为占位 `NoopSyncBackend`）
  - 位置：`packages/storage/src/index.ts` 的 `SyncBackend` 接口（`pull` / `push`）
  - 现状：Web 端 `packages/storage/src/web.ts` 用 noop 后端；进度仅存 `localStorage`（Web）/ 待接原生存储（桌面/移动）
  - 目标：接一个可用的后端（候选 Supabase / Firebase / 自建 WebDAV / 自建 API）
  - 需完成：
    1. 选定后端并实现 `SyncBackend`（拉取远端 `PersistedState`、推送本地进度）
    2. 冲突合并策略（当前 `createSyncManager` 只是「作答数更多者胜」的简化，需替换为时间戳/脏标记合并）
    3. 三端接入：Web 用 localStorage + 云；桌面(Tauri) 用文件存储 + 云；移动(Capacitor) 用原生 Preferences + 云
    4. 登录/鉴权与多设备同步 UI
  - 前置：需用户提供后端目标与账号（见会话中的确认项）

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

- [x] 题库从 `questions.js` 转为 `data/questions.json`（唯一数据源）
- [x] 抽出 `@quiz/core`（判分/抽题/错题/进度纯函数 + 15 个单测）
- [x] 抽出 `@quiz/storage`（`ProgressStore` / `SyncBackend` 接口 + noop 桩 + 文件导入导出）
- [x] React+Vite+TS 重写 UI，保留百词斩式体验（单文件构建，双击离线可用 + PWA）
- [x] Tauri 2 桌面壳编译通过（产物已生成）
- [x] Capacitor 7 移动壳（iOS/Android 原生工程已生成）
- [x] 进度 schema 版本化（`schemaVersion: 1`）