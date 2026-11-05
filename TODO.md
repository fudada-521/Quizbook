# 待办事项（TODO）

> 记录当前项目已知的、尚未完成的工作项。完成后请更新状态并简要注明。

## 待办

> 优先级：P0 = 影响正常使用；P1 = 明确的体验缺陷；P2 = 优化项；P3 = 规划/需先做方案。

### 体验优化（2026-11-05 整理并完成）

#### 本轮已完成

- [x] **统一页面骨架与标题**：新增 `.view-page` / `.view-head`（`max-width: 920px`），收藏、成就、设置三页共用；成就页 h1 改为「成就」，解锁进度下沉到副标题，标题字号统一为 32px（移动端 28/26px）
- [x] **收藏详情复用答题页 UI**：抽出 `components/AnswerParts.tsx` 的 `AnswerOptions` / `RevealCard`，答题页与收藏详情共用；删除 `.fav-stem-full`、`.fav-explain` 等重复样式
- [x] **移动端字号**：`max-width: 720px` 下题干 17.5px、选项 16px、行高 1.7+
- [x] **宽屏题干提前换行**：根因是 `base.css` 给所有 `h2` 设了 `max-width: 30ch`，题干在 30 字符处就断行；`.stem` 已改为 `max-width: none`
- [x] **解析移到选项下方**：`QuizView` 中 `Reveal` 挪到 `Options` 之后，相邻间距规则改为 `.options + .reveal`
- [x] **判分动效**：答对时正确选项复用解析卡的 `okReveal`（弹起 + 绿色光晕），答错时错误选项用 `badReveal` 震动，与原生触觉并存
- [x] **手机端隐藏键盘提示**：媒体查询改为 `(hover: none), (pointer: coarse)`；解析页「按 Enter」拆到 `.kbd-only` 中按设备隐藏
- [x] **滑动关闭/返回**：新增 `gestures.ts`，实现左缘右滑返回（收藏/成就/设置/结算）、收藏详情头部下滑关闭、答题页左右滑动翻题；同时接入 History API，系统返回键/手势与应用内视图一致（`Shell` 中统一维护一条二级页历史）
- [x] **首页成就卡片位置**：从「继续练习」与右侧栏之间移入右侧栏「学习概览」之后
- [x] **音效音量与失灵**：主输出串联 `DynamicsCompressorNode` 并提升音量（tone 0.13–0.18 + master 1.6）；在首个 pointerdown / touchstart / keydown 中同步 `resume()` 并播 0 振幅预热音，判分时等上下文 running 后再调度
- [x] **答题中达成成就的祝贺**：由右下角 toast 改为居中祝贺弹窗（遮罩 + 徽章弹入 + 卡片动画），可点击关闭或等待自动关闭；展示期间暂停自动跳题，关闭后重新计时

#### 待验证（真机）

- [ ] 真机回归：iOS Safari / Android WebView 上的音效解锁、边缘右滑返回、答题页横向滑动、收藏详情下滑关闭
- [ ] 系统返回键在 Tauri / Capacitor 壳内的行为（Web 已按 History API 处理）

#### 规划（需先出方案）

- [ ] **本地每日提醒（P2）**：接入系统通知，按日提醒刷题
  - Web/PWA：Notifications API + Service Worker（已用 `vite-plugin-pwa`），受权限与「是否安装到主屏」限制，定时不可靠，作为降级方案
  - Capacitor：优先 `@capacitor/local-notifications`，支持每日重复的原生本地通知
  - Tauri：`tauri-plugin-notification` + 启动时补发或系统级定时
  - 需新增设置项：开关、提醒时间、权限申请与拒绝后的引导；注意三端能力差异与「单文件离线可用」约束
- [ ] **多题库支持（P3）**
  - 现状：`apps/web/src/App.tsx` 直接 `import` `data/questions.json`，题库编进 bundle；进度题目键 `${c}-${n}` 不含题库维度
  - 关键改造：题库元数据（id/名称/版本/题量）与运行时数据源；存储按题库分区或给题目键加前缀；`@quiz/core` 的判分/抽题/合并需接受题库上下文；`mergeStates()` 与云同步需兼容
  - 先做方案：题库来源（内置多份按需加载 vs 远程下载）、切换后的进度隔离策略、离线可用性权衡

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
- [x] 成就系统：50 个成就（进度/习惯/收藏/挑战/准确率/隐藏），分级系列展示 + 隐藏成就提示，本地即时解锁 + 服务端权威校验，成就页与解锁提示
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
