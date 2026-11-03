# 知题 · 答题练习（跨平台）

软考·信息系统项目管理师 综合知识刷题应用。
一套 React 代码，同时产出 **网页 / 桌面 App / 手机 App**。

## 目录结构

```
答题程序/
├── data/
│   └── questions.json          # 题库（唯一数据源，2210 题）
├── packages/
│   ├── core/                   # 平台无关领域逻辑：判分/抽题/错题本/进度
│   └── storage/                # 进度存储适配层：localStorage/文件/云同步接口
└── apps/
    ├── web/                    # React + Vite + TS 前端（所有端共用）
    ├── desktop/                # Tauri 2 桌面壳（macOS/Windows/Linux）
    └── mobile/                 # Capacitor 移动壳（iOS/Android）
```

## 快速开始

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（web，热更新）
pnpm build            # 构建 Web 单文件产物（apps/web/dist/index.html）
pnpm preview          # 本地预览构建产物
pnpm test             # 运行 core 单元测试
pnpm desktop:dev      # 桌面 App 开发模式
pnpm desktop:build    # 桌面 App 打包（apps/desktop/src-tauri/target/release/）
```

### 各端使用方式

- **网页版**：`apps/web/dist/index.html` 是**单文件**，双击即可离线打开；也支持 PWA「安装到主屏」。
- **桌面版**：`pnpm desktop:build` 产出 `.app`（macOS）/ `.exe`（Windows）/ 二进制（Linux）。
- **手机版**：`pnpm mobile:sync && pnpm mobile:ios`（或 `android`），再用 Xcode/Android Studio 打包上架。

### 打包 Android APK（命令行）

原生工程由 Capacitor 生成（未入库），首次需先创建并同步：

```bash
cd apps/mobile
pnpm exec cap add android      # 仅首次
pnpm --filter @quiz/web build && pnpm exec cap sync android
```

然后构建（需 JDK 17+ 与 Android SDK，`android/local.properties` 的 `sdk.dir` 指向本机 SDK）：

```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/sdk/Android/sdk"
gradle assembleDebug            # 或 ./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

> 国内网络下建议在 `android/settings.gradle` 的 `pluginManagement` 与 `dependencyResolutionManagement`
> 中优先加入阿里云镜像（`https://maven.aliyun.com/repository/google` 等），可显著加速依赖下载。

## 数据模型

题库 `data/questions.json` 结构：

```jsonc
{
  "generatedFrom": "...",
  "chapters": { "1": "信息化发展", "..." : "..." },
  "questions": [
    { "c": 1, "n": 1, "s": "题干", "o": ["A","B","C","D"], "a": 3, "e": "解析" }
  ]
}
```

- `a` 是 **0 基下标**（`a:3` 表示 D）。
- 题目唯一键 `${c}-${n}`，新增题目必须保证唯一。
- 进度持久化 schema 见 `packages/core/src/types.ts`（`PersistedState`，当前 `schemaVersion: 3`，包含 `favorites` 收藏表与 `notes` 题目心得时间线）。

## 架构

- **`@quiz/core`**：纯函数领域逻辑，无 DOM/框架依赖，可用 `pnpm test` 单测。
- **`@quiz/storage`**：`ProgressStore` 接口（`load`/`save`/`subscribe`）+ `SyncBackend` 接口（`pull`/`push`）。
  Web 用 `localStorage`（`@quiz/storage/web`），桌面/移动可注入文件或原生存储实现，云同步实现 `SyncBackend` 即可接入。
- **`@quiz/web`**：React UI，通过 `QuizStore`（Context + hook）封装状态；极简工具风界面（浅色/深色自动跟随系统）、百词斩式答题卡片、答对自动跳转（答错停留）、章节进度、错题本、收藏夹、题目心得、答题卡、键盘快捷键。
- **断点续做**：未完成的练习会话保存在本机（`gaoxiang_quiz_session_v1`），退出或重新打开后可回到原题继续。

## 功能

| 功能 | 说明 |
|---|---|
| 百词斩式节奏 | 点选项 → 滑入答案解析页；答对倒计时自动下一题，答错停留细读 |
| 按章节/随机/智能推进 | 顺序练习、全库随机抽题、优先未做题 |
| 错题本 | 自动收录，错题重练 + 本轮回顾 |
| 收藏夹 | 题卡右上角星标收藏；独立列表页可查看题目详情，支持全部收藏专项练习（新收藏优先）；清空记录不会删除收藏 |
| 题目心得 | 在答题解析与收藏详情中按时间线追加个人心得（不可修改），支持 ⌘/Ctrl+Enter 记录；开始写心得会取消本题自动跳转 |
| 答题卡 / 快捷键 | 顶栏答题卡跳转；A–D 选择、Enter 继续、←→ 翻题 |
| 选项乱序 | 防死记位置 |
| 进度保存 | Web 存 localStorage；可导出/导入 JSON（跨端手动同步），预留云同步接口 |
| 断点续做 | 未完成的练习自动保存，退出或重新打开后从原题继续 |

## 已知限制

1. 题目文字来自题库整理，个别字词可能存在错别字，不影响作答。
2. 少数含网络图/表格的计算题文字描述不完整，属原书图片内容，可忽略。
3. 被刻意剔除的多空题导致题号间断，不要"修复"编号连续性。
4. 云同步需后端；当前提供接口桩 + 文件导入导出，接入任意云需实现 `SyncBackend`（见 `TODO.md`）。