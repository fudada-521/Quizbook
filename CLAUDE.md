# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

「知题」是软考·信息系统项目管理师（综合知识）刷题应用。一套 React + Vite 代码同时产出网页、Tauri 桌面端和 Capacitor 移动端。pnpm monorepo，Node >= 20，包管理器固定为 pnpm@10.32.1。

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # Web 开发服务器（Vite）
pnpm build            # 类型检查 + 构建单文件产物 apps/web/dist/index.html
pnpm preview          # 预览构建产物
pnpm test             # 运行 @quiz/core 单测
pnpm typecheck        # 所有含 typecheck 脚本的包执行 tsc --noEmit
pnpm desktop:dev      # Tauri 桌面开发
pnpm desktop:build    # Tauri 打包（自动先构建 Web）
pnpm mobile:sync      # 构建 Web 后 cap sync（同步到 ios/ 与 android/）
pnpm mobile:ios       # 打开 Xcode 工程
pnpm mobile:android   # 打开 Android Studio / Gradle 工程
```

- 单测没有测试框架，也没有按用例过滤的参数：入口是 `packages/core/test/core.test.ts`，用 `tsx` 直接运行并靠 `ok()/fails` 计数、`process.exit` 返回退出码。运行单个包用 `pnpm --filter @quiz/core test`，或 `pnpm exec tsx packages/core/test/core.test.ts`。新增用例直接写进该文件。
- 项目当前没有 ESLint / Prettier / CI（见 `TODO.md`）。
- 移动端原生工程 `apps/mobile/ios`、`apps/mobile/android` 未入库。首次使用需在 `apps/mobile` 下执行 `pnpm exec cap add android`（或 `ios`），再 `pnpm --filter @quiz/web build && pnpm exec cap sync android`。APK 构建需要 JDK 17+ 与 Android SDK，详细命令见 `README.md`。

## 架构

### 数据流与包边界

- `data/questions.json` 是唯一题库数据源（2210 题）。它由 `apps/web/src/App.tsx` 直接 `import`（依赖 `resolveJsonModule`）打进 Web bundle，因此三端共享同一份数据；改题库后必须重新 `pnpm build`，桌面/移动端也需要重新 sync/打包。`.history/` 里的旧 `questions.js` 只是编辑器历史，不要恢复使用。
- `packages/core`：平台无关的纯函数领域逻辑（判分、抽题、错题本、收藏、进度、schema 兼容），不依赖 DOM 或框架。
- `packages/storage`：`ProgressStore`（`load`/`save`/`subscribe`）与 `SyncBackend`（`pull`/`push`）接口及适配器。`src/web.ts` 是 localStorage 实现，键名 `gaoxiang_quiz_v1`；`src/sync.ts` 是手动导入/导出的序列化辅助。云同步目前是 `NoopSyncBackend` 占位。
- 所有 workspace 包都通过 `package.json` 的 `main`/`exports` 直接暴露 `src/*.ts` 源码，没有包级编译步骤；Vite、tsx、tsconfig paths 直接消费 TS 源码。不要为它们增加 `dist` 构建产物。
- 三端目前共用 `apps/web` 的 localStorage 存储：桌面与移动端尚未接文件/原生存储（`TODO.md` 有明确待办）。桌面端 `src-tauri` 没有自定义 Rust command，`frontendDist` 指向 `../web/dist`；移动端 `webDir` 同样指向 `../web/dist`。

### Web 应用

- `apps/web/src/store/QuizStore.tsx` 是唯一状态中枢：`useReducer` 管理视图/会话/答题卡（`AppState`），`useState` 管理持久化进度（`PersistedState`），通过 Context + `useQuiz()` 暴露。
- 断点续做由 `store/sessionPersistence.ts` 负责：会话快照存 localStorage 键 `gaoxiang_quiz_session_v1`，只保存题目键 `${c}-${n}` 与作答状态，加载时按当前题库重新关联。会话在答题中持续写入，进入结算页或导入/清空进度时清除；答题中退出则保留，首页据此显示「继续练习」。
- 关键设计：`@quiz/core` 的 `gradeAnswer()` 会**原地修改** `PersistedState` 和 `SessionItem`（设置 `done`、`lastPick`）。QuizStore 因此用 `persistRef` 持有最新进度、修改后 `setPersisted({...persistRef.current})` 触发刷新。改动状态管理时要保持这个“可变 core + 不可变 React 快照”的约定。
- 视图切换在 `App.tsx` 中按 `app.view` 渲染 `HomeView` / `QuizView` / `ResultView` / `FavoritesView`；`SettingsDialog` 是常驻的 `<dialog>`。收藏夹详情弹窗由 `FavoritesView` 自行管理，打开时用 `showModal()` 并把焦点放在对话框容器上。
- 构建使用 `vite-plugin-singlefile`（JS/CSS 全部内联进一个 `index.html`）并配合 `inlineDynamicImports`；同时用 `vite-plugin-pwa` 提供「安装到主屏」。产物约 1.5 MB 属正常。不要引入需要额外静态资源的运行时加载方式，否则会破坏“双击离线打开”。
- UI 不使用组件库：设计令牌集中在 `apps/web/src/styles.css`（浅色/深色两套 CSS 变量，自动跟随系统），线性图标在 `components/Icon.tsx`。改视觉时优先调整变量和已有类，不要在视图里写内联样式或另起一套配色。

### 领域约定

- 题目的 `a` 是 **0 基下标**（`a:3` 表示 D）；`o` 固定 4 项；唯一键为 `${c}-${n}`（`qkey()`）。
- `chapters` 在 JSON 中键为字符串，读取时统一用 `String(c)`。
- 题号存在刻意间断：多空题被剔除，不要为了“连续”而重排 `n`。
- 选项乱序通过 `SessionItem.map`（显示下标 → 原始下标）实现；渲染与判分必须经 `map` 换算，`q.a` 始终是原始下标。
- 进度 schema 当前为 `schemaVersion: 2`（v2 新增 `favorites`），`normalizeState()` 负责旧数据兜底。改动 `PersistedState` 结构时需同步迁移逻辑并提升版本号。
- `favorites` 是 `题目键 → 收藏时间戳` 的映射；`favoriteQuestions()` 按收藏时间从新到旧返回，`toggleFavorite()` 原地修改状态。收藏专项练习使用全部收藏题；「清空记录」通过 `resetProgress` 保留 `favorites`。
- 答对后自动跳转的条件集中在 `shouldAutoAdvance()`：答对、`autoNext > 0`、非错题回顾模式，三者同时满足。

## 其他注意事项

- `README.md` 记录了各端打包细节、Android 镜像加速和已知内容限制（OCR 错字、图片题描述不完整等）。
- `.history/`、`apps/web/dist/`、`release/`、原生工程目录、Tauri `target/`、`gen/` 均被 gitignore，不要编辑或提交。
- `apps/desktop/src-tauri/tauri.conf.json` 的 `devUrl` 指向 `http://localhost:1420`，但 `beforeDevCommand` 只执行 Web 构建、并未启动开发服务器。若 `pnpm desktop:dev` 白屏，检查这一点（可改为先启动 `pnpm dev` 并让端口与 `devUrl` 一致，或让 `beforeDevCommand` 启动带 `--port 1420` 的 Vite）。