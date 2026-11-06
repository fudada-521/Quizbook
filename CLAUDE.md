# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

「天权 Megrez」是软考·信息系统项目管理师（综合知识）刷题应用。一套 React + Vite 代码同时产出网页、Tauri 桌面端和 Capacitor 移动端。pnpm monorepo，Node >= 20，包管理器固定为 pnpm@10.32.1。

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # Web 开发服务器（Vite）
pnpm build            # 类型检查 + 构建单文件产物 apps/web/dist/index.html
pnpm preview          # 预览构建产物
pnpm test             # 运行 @megrez/core 单测
pnpm typecheck        # 所有含 typecheck 脚本的包执行 tsc --noEmit
pnpm desktop:dev      # Tauri 桌面开发
pnpm desktop:build    # Tauri 打包（自动先构建 Web）
pnpm mobile:sync      # 构建 Web 后 cap sync（同步到 ios/ 与 android/）
pnpm mobile:ios       # 打开 Xcode 工程
pnpm mobile:android   # 打开 Android Studio / Gradle 工程
pnpm server:dev       # 后端本地开发（Fastify，默认 http://127.0.0.1:8787）
```

- 单测没有测试框架，也没有按用例过滤的参数：入口是 `packages/core/test/core.test.ts`，用 `tsx` 直接运行并靠 `ok()/fails` 计数、`process.exit` 返回退出码。运行单个包用 `pnpm --filter @megrez/core test`，或 `pnpm exec tsx packages/core/test/core.test.ts`。新增用例直接写进该文件。
- 项目当前没有 ESLint / Prettier / CI（见 `TODO.md`）。
- 移动端原生工程 `apps/mobile/ios`、`apps/mobile/android` 未入库。首次使用需在 `apps/mobile` 下执行 `pnpm exec cap add android`（或 `ios`），再 `pnpm --filter @megrez/web build && pnpm exec cap sync android`。APK 构建需要 JDK 17+ 与 Android SDK，详细命令见 `README.md`。

## 架构

### 数据流与包边界

- `data/questions.json` 是唯一题库数据源（2210 题）。它由 `apps/web/src/App.tsx` 直接 `import`（依赖 `resolveJsonModule`）打进 Web bundle，因此三端共享同一份数据；改题库后必须重新 `pnpm build`，桌面/移动端也需要重新 sync/打包。`.history/` 里的旧 `questions.js` 只是编辑器历史，不要恢复使用。
- `packages/core`：平台无关的纯函数领域逻辑（判分、抽题、错题本、收藏、题目心得、进度、schema 兼容），不依赖 DOM 或框架。
- `packages/storage`：`ProgressStore`（`load`/`save`/`subscribe`）与 `SyncBackend` 接口及适配器。`src/web.ts` 是 localStorage 实现，键名 `megrez_quiz_v1`（首次加载自动迁移旧键 `quizbook_quiz_v1`、`gaoxiang_quiz_v1`）；`src/sync.ts` 是手动导入/导出的序列化辅助；`src/http.ts` 是云同步客户端 `CloudClient`（设备码登录、`pull`/`push`、成就），`src/auth.ts` 存 token（`megrez_auth_v1`）与服务器地址（`megrez_server_v1`）。
- 所有 workspace 包都通过 `package.json` 的 `main`/`exports` 直接暴露 `src/*.ts` 源码，没有包级编译步骤；Vite、tsx、tsconfig paths 直接消费 TS 源码。不要为它们增加 `dist` 构建产物。
- `apps/server`：Fastify + TypeScript 后端（`pnpm server:dev`）。使用 Node 24 内置 `node:sqlite`，无需原生依赖。登录采用**用户名 + 密码**：`POST /api/auth/register` 开放注册、`POST /api/auth/login` 登录，密码用 scrypt 加盐哈希存储，失败尝试按 IP 限流。token 只存 SHA-256 哈希。进度按用户存一份 JSON 快照 + `version`；`PUT /api/sync` 不再拒绝旧版本，而是用 `@megrez/core` 的 `mergeStates()` 与远端快照合并（`baseVersion` 仅供诊断），并顺带执行成就权威校验。部署产物在 `apps/server/Dockerfile` 与 `apps/server/deploy/`（compose + Caddy）。配置见 `apps/server/.env.example`；`apps/server/data/` 与 `.env` 已 gitignore。旧版 GitHub/设备码认证已移除，旧库在首次启动时自动删除旧认证表。
- 三端目前共用 `apps/web` 的 localStorage 存储：桌面与移动端尚未接文件/原生存储（`TODO.md` 有明确待办）。桌面端 `src-tauri` 没有自定义 Rust command，`frontendDist` 指向 `../web/dist`；移动端 `webDir` 同样指向 `../web/dist`。

### Web 应用

- `apps/web/src/store/QuizStore.tsx` 是唯一状态中枢：`useReducer` 管理视图/会话/答题卡（`AppState`），`useState` 管理持久化进度（`PersistedState`），通过 Context + `useQuiz()` 暴露。
- 断点续做由 `store/sessionPersistence.ts` 负责：会话快照存 localStorage 键 `megrez_quiz_sessions_v2`，按练习来源（`chapter:3`、`favorites:8`、`random`、`wrong`、`daily:2026-11-04` 等）各存一份，互不覆盖；上一品牌的整份表 `quizbook_quiz_sessions_v2` 与更早的旧单份键 `quizbook_quiz_session_v1`、`gaoxiang_quiz_session_v1` 首次读取自动迁移。快照只保存题目键 `${c}-${n}` 与作答状态，加载时按当前题库重新关联。从同一入口再次进入会恢复该来源上次中断的位置；进入结算页只清除当前这一份，导入/清空进度会清除全部；答题中退出则保留，首页「继续练习」显示最近活动的一份。
- 关键设计：`@megrez/core` 的 `gradeAnswer()` 会**原地修改** `PersistedState` 和 `SessionItem`（设置 `done`、`lastPick`）。QuizStore 因此用 `persistRef` 持有最新进度、修改后 `setPersisted({...persistRef.current})` 触发刷新。改动状态管理时要保持这个“可变 core + 不可变 React 快照”的约定。
- 视图切换在 `App.tsx` 中按 `app.view` 渲染 `HomeView` / `QuizView` / `ResultView` / `FavoritesView`；`SettingsDialog` 是常驻的 `<dialog>`。收藏夹详情弹窗由 `FavoritesView` 自行管理，打开时用 `showModal()` 并把焦点放在对话框容器上。
- 收藏、成就、设置三页共用 `.view-page` / `.view-head` 骨架（宽度以设置页 920px 为准）；题干、选项与解析卡统一用 `components/AnswerParts.tsx` 的 `AnswerOptions` / `RevealCard`，答题页与收藏详情不得各写一套。
- 移动端手势集中在 `gestures.ts`（左缘右滑返回、答题页左右滑翻题、收藏详情下滑关闭），用 touch 事件实现；`Shell` 通过 History API 维护一条二级页历史，系统返回键/手势与应用内视图共用同一套切换逻辑。
- 题目心得统一由 `components/QuestionNotes.tsx` 渲染，答题解析（`AnswerParts.RevealCard`）与收藏详情复用。解析页传入 `onComposeStart`，用户聚焦输入框即暂停本题自动跳转倒计时。
- 构建使用 `vite-plugin-singlefile`（JS/CSS 全部内联进一个 `index.html`）并配合 `inlineDynamicImports`；同时用 `vite-plugin-pwa` 提供「安装到主屏」。产物约 1.5 MB 属正常。不要引入需要额外静态资源的运行时加载方式，否则会破坏“双击离线打开”。
- UI 不使用组件库：设计令牌集中在 `apps/web/src/tokens.css`（浅色/深色两套 CSS 变量），深色由 `<html data-theme>` 决定；`src/theme.ts` 负责「跟随系统 / 浅色 / 深色」的本机偏好（localStorage 键 `megrez_theme_v1`，不同步），设置页「外观」可切换，线性图标在 `components/Icon.tsx`。改视觉时优先调整变量和已有类，不要在视图里写内联样式或另起一套配色。

### 领域约定

- 题目的 `a` 是 **0 基下标**（`a:3` 表示 D）；`o` 固定 4 项；唯一键为 `${c}-${n}`（`qkey()`）。
- `chapters` 在 JSON 中键为字符串，读取时统一用 `String(c)`。
- 题号存在刻意间断：多空题被剔除，不要为了“连续”而重排 `n`。
- 选项乱序通过 `SessionItem.map`（显示下标 → 原始下标）实现；渲染与判分必须经 `map` 换算，`q.a` 始终是原始下标。
- 进度 schema 当前为 `schemaVersion: 4`（v2 `favorites`，v3 `notes`，v4 `daily`/`challenges`/`achievements`/`favoriteRemovals`/`settingsAt`/`resetAt`），`normalizeState()` 负责旧数据兜底。改动 `PersistedState` 结构时需同步迁移逻辑并提升版本号。
- 多端合并集中在 `packages/core/src/merge.ts` 的 `mergeStates(a, b)`，客户端启动/登录时与服务端共用同一实现；不要另写一套合并规则。删除收藏靠 `favoriteRemovals` 墓碑，清空记录靠 `resetAt` 纪元，二者不可省略。
- 挑战模式常量与确定性抽题在 `packages/core/src/challenges.ts`（每日一练 10 题、限时 20 题/10 分钟、模拟考 75 题/150 分钟/45 分及格）；成就在 `packages/core/src/achievements.ts`，本地即时解锁，服务端同步时权威复核。
- `favorites` 是 `题目键 → 收藏时间戳` 的映射；`favoriteQuestions()` 按收藏时间从新到旧返回，`toggleFavorite()` 原地修改状态。收藏专项练习使用全部收藏题；「清空记录」通过 `resetProgress` 保留 `favorites`。
- `notes` 是 `题目键 → QuestionNote[]` 的心得时间线，只追加、不修改也不删除；`notesFor()` 返回旧→新数组，`addQuestionNote()` 负责去空白并生成题内唯一 id。UI 展示时反转数组使最新在前；「清空记录」同样保留 `notes`。
- 答对后自动跳转的条件集中在 `shouldAutoAdvance()`：答对、`autoNext > 0`、非错题回顾模式，且该题是本次停留内刚判分的（`SessionItem.fresh` 为真，翻题离开即清除、不写入会话快照），四者同时满足。用「上一题」或答题卡回看已答题时不会再次倒计时。

## 其他注意事项

- `README.md` 记录了各端打包细节、Android 镜像加速和已知内容限制（OCR 错字、图片题描述不完整等）。
- `.history/`、`apps/web/dist/`、`release/`、原生工程目录、Tauri `target/`、`gen/` 均被 gitignore，不要编辑或提交。
- `apps/desktop/src-tauri/tauri.conf.json` 的 `devUrl` 指向 `http://localhost:1420`，但 `beforeDevCommand` 只执行 Web 构建、并未启动开发服务器。若 `pnpm desktop:dev` 白屏，检查这一点（可改为先启动 `pnpm dev` 并让端口与 `devUrl` 一致，或让 `beforeDevCommand` 启动带 `--port 1420` 的 Vite）。
