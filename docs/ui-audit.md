<!-- @format -->

# Megrez Megrez · Hallmark 审计修复清单

> 审计日期：2026-11-04。状态：**P0/P1/P2 已修复**（P0-2 为误报不改；4px 栅格豁免；渲染复检未执行）。

## Context

用 Hallmark v2（反 AI 味设计 skill）对现有 UI 做了一次只读审计，目的是找出对比度、可访问性、设计令牌与文案层面的具体问题。审计方式：

- 静态：`node ~/.claude/skills/hallmark/scripts/sloplint.mjs apps/web/src --scope app`
- 渲染：启动 `pnpm dev` 后 `HALLMARK_PUPPETEER=/tmp/hallmark-tools node ~/.claude/skills/hallmark/scripts/sloplint.mjs --url http://localhost:5175/ --scope app --render`

结果：**33 FAIL（静态）+ 7 FAIL（渲染）**，118 REFLEX 中 118 条里仅「4px 栅格」一项就占 118 条（可整体豁免），另有 15 WARN。审计截图在 `.hallmark/shots/`（未跟踪文件）。

本清单只列**建议修复项**，按风险排序。4px 栅格、`text-wrap: balance` 等风格类 REFLEX 默认豁免。

---

## P0 · 可访问性与真实缺陷

### P0-1 弱化文本对比度不足（影响面最大）

**根因**：`--ink-3` 在两种模式下都低于 4.5:1。

| Token           | 当前值    | 背景      | 实测       |
| --------------- | --------- | --------- | ---------- |
| `--ink-3`（暗） | `#73736a` | `#0e0f0d` | **4.02:1** |
| `--ink-3`（亮） | `#9a9a92` | `#f6f6f3` | **2.62:1** |

**推荐改法**（`apps/web/src/styles.css:19` 与 `:50`）：

- 亮色 `--ink-3: #9a9a92` → `#6e6e67`（4.74:1）
- 暗色 `--ink-3: #73736a` → `#8f8f85`（5.89:1）

这样一次修复以下所有被渲染实测点名的元素：

- `.brand-sub`（styles.css:183）
- `.eyebrow`（styles.css:380）
- `.panel-head h2`「学习概览」（styles.css:517）
- `.mode-desc`「10 题」（styles.css:595）
- `.q-meta`（styles.css:840）
- `.shortcut-hint` / `.reveal-hint` 等

**备选（更保守）**：保持 `--ink-3` 只用于装饰（箭头、分割），把上述功能性小字改用 `--ink-2`。代价是改动点更多。

**注意**：`.achievement-icon`（styles.css:2415）在 surface-3 上为 3.30:1，属于非文本图标，3:1 已达标，可不动。

### P0-2 选项字母对比度：静态报告为误报，不改

sloplint 静态报告 `.option.correct .letter` 1.85:1。实测：

- 亮色 `#fff` on `--ok #157a4a` = 5.36:1
- 暗色 `#12130f` on `--ok #63d3a0` = 10.09:1

静态检查器未应用 `@media (prefers-color-scheme: dark)` 覆盖（styles.css:989-995）。**结论：无需修改**，但重跑渲染时应在答题页确认。

### P0-3 自动跳转倒计时 SVG 缺少可访问性标记

`apps/web/src/views/QuizView.tsx:256` 的 `<svg className="cd-ring">` 无 `aria-hidden` / `aria-label`。它是装饰环，旁边的 `{secs}s` 已提供信息。

**改法**：加 `aria-hidden="true"`。`components/Icon.tsx:153` 已有正确写法可参照。

### P0-4 弹窗 / Toast 使用 `100vw` 可能撑出横向滚动

Gate 34 要求 `overflow-x: clip` 且不要用 `100vw`（滚动条会算进宽度）。

| 位置                                   | 当前                                    | 建议                                   |
| -------------------------------------- | --------------------------------------- | -------------------------------------- |
| `styles.css:1508` `.fav-dialog`        | `width: min(640px, calc(100vw - 32px))` | `width: min(640px, calc(100% - 32px))` |
| `styles.css:1602` `dialog#settings`    | `width: min(480px, calc(100vw - 32px))` | `width: min(480px, calc(100% - 32px))` |
| `styles.css:1963` `.fav-dialog` @media | `width: calc(100vw - 24px)`             | `width: calc(100% - 24px)`             |
| `styles.css:2056` `.fav-dialog` @media | `width: calc(100vw - 16px)`             | `width: calc(100% - 16px)`             |
| `styles.css:2480` `.toast-stack`       | `width: min(380px, calc(100vw - 32px))` | `width: min(380px, calc(100% - 32px))` |

### P0-5 功能性文字过小

- `styles.css:1254` `.shortcut-hint`：`10.5px` → `12px`
- `styles.css:231` `kbd`：`10px` → `11px`
- 顺带：`styles.css:1541` `.fav-dialog .eyebrow` 10.5px、`styles.css:1572` `.fav-explain .label` 10.5px、`styles.css:1160` `.notes-count` 10.5px → 建议统一 `11px`

---

## P1 · 规范与文案

### P1-1 硬编码颜色移入令牌

`styles.css:957/967/981` 的 `#fff` 与 `:993` 的 `#12130f` 可合并成一个语义令牌：

```css
:root {
    --on-accent: #ffffff;
}
@media (prefers-color-scheme: dark) {
    :root {
        --on-accent: #12130f;
    }
}
```

然后把三条规则改为 `color: var(--on-accent)`，并删除 `styles.css:989-995` 的局部覆盖块（令牌已按模式切换）。

弹窗阴影/遮罩同理，新增令牌后替换：

- `styles.css:1516` / `:1609` `rgba(15, 15, 12, 0.28)` → `var(--shadow-dialog)`
- `styles.css:1529` / `:1618` `rgba(15, 16, 13, 0.4)` → `var(--backdrop)`

### P1-2 `.progress > i` 不再动画 `width`

`styles.css:364-370` 当前 `transition: width`。改为 `transform: scaleX()`，并把各组件的内联 `width: X%` 改为 `transform: scaleX(X/100)`：

- `views/QuizView.tsx:101`
- `views/HomeView.tsx:76`（需确认 `<i>` 位置）、`:178`、`:251`
- `views/AchievementsView.tsx:40`、`:79`

CSS：

```css
.progress > i {
    transform-origin: left center;
    transition: transform 0.35s ease;
}
```

### P1-3 字距大写小标签

去掉 label 角色的 `letter-spacing`（保留字号/字重）：

- `styles.css:385` `.eyebrow` `0.08em`
- `styles.css:521` `.panel-head h2` `0.08em`
- `styles.css:1105` `.reveal-body .label` `0.08em`
- `styles.css:1151` `.notes-title` `0.04em`
- `styles.css:1568` `.fav-explain .label`（同 `.label` 组）

### P1-4 破折号与中圆点串

- `App.tsx:133-135`：`快捷键 A–D 选择 · Enter 确认/继续 · ← → 翻题`
  → `快捷键 A、B、C、D 选择；Enter 确认或继续；← → 翻题`
- `QuizView.tsx:145`：`A–D 选择 · Enter 继续 · ← → 翻题`
  → `A、B、C、D 选择；Enter 继续；← → 翻题`
- `SettingsDialog.tsx:211`：`打乱 A–D 的位置，避免死记选项`
  → `打乱选项顺序，避免死记选项`
- `HomeView.tsx:61` 的 `已作答 … · 正确率 …`、`:48` 的收藏计数等属单中圆点分隔，可保留；渲染报告只点名了 `HomeView.tsx:140` 的挑战模式复合 meta（由 `:145-146` 等 span 拼接），建议把「题 · 10 分钟」改为「10 题，10 分钟」这类逗号分隔。

### P1-5 删除/改写 eyebrow

- `AchievementsView.tsx:34` `<p className="eyebrow">成就</p>` → 删除（`h1` 已是「已解锁 x / y」）
- `FavoritesView.tsx:45` `<p className="eyebrow">收藏夹</p>` → 删除（`h1` 已说明）
- `FavoritesView.tsx:103-106`「第01章 … · 原题 42」 → 改为普通 meta 小字，去掉字母间距和 eyebrow 类
- `HomeView.tsx:58`「信息系统项目管理师 · 综合知识」 → 品牌 kicker，可保留；若保留，至少由 P1-3 去掉字距
- `HomeView.tsx:68` `eyebrow accent`（准备开始 / 未完成练习）未被 gate 点名，但同类，建议一并降级为普通小标签

### P1-6 暗色表面未显式指定文字色

以下规则设置深色/浅色 `background` 后未设 `color`，依赖继承。建议补 `color: var(--ink)`：

- `styles.css:450` `.continue-card`
- `styles.css:506` `.panel`
- `styles.css:610` `.chapters-panel`
- `styles.css:827` `.question-card`
- `styles.css:2204` `.device-panel`

---

## P2 · 可选 / 可豁免

- **4px 栅格（118 条 REFLEX 24b）**：整体豁免。项目使用 2px 取整的紧密节奏，不建议为此重构间距。
- `text-wrap: balance`（F3）：可加到 `h1` / 页面标题，低成本。
- `.toast-icon` 彩色圆底（F5）、`.answer-sheet` 边框+阴影并用（F24）：可保持现状。
- 两个 `dialog::backdrop` 的 `backdrop-filter: blur(4px)`（WARN 29）：属设计选择，建议书面豁免而非移除。
- `.empty-state p` `max-width: 40ch`（WARN 25）：可放宽到 `48ch`。

---

## 验证

1. `pnpm typecheck`
2. `pnpm test`（本次只动 Web 层，core 预期不受影响）
3. `pnpm build`
4. 静态复检：
    ```bash
    node ~/.claude/skills/hallmark/scripts/sloplint.mjs apps/web/src --scope app
    ```
    目标：FAIL 从 33 降到 1（仅剩 Hallmark stamp，属 N/A）。
5. 渲染复检（需先 `pnpm dev`，端口以输出为准）：
    ```bash
    HALLMARK_PUPPETEER=/tmp/hallmark-tools \
      node ~/.claude/skills/hallmark/scripts/sloplint.mjs \
      --url http://localhost:<port>/ --scope app --render
    ```
    目标：渲染 FAIL 从 7 降到 0。
6. 手工检查：
    - 亮/暗两种系统主题下看首页、答题页、收藏详情、设置、成就页
    - 键盘 Tab 走一遍，确认 `:focus-visible` 可见
    - 1280×800 与 375 宽下确认无横向滚动
    - 答题页确认选项字母在两种主题下都可读（P0-2）
7. 清理审计产物：决定删除 `.hallmark/` 或加入 `.gitignore`。

---

## 关键文件

- `apps/web/src/styles.css`（绝大多数修复）
- `apps/web/src/App.tsx`
- `apps/web/src/views/QuizView.tsx`
- `apps/web/src/views/HomeView.tsx`
- `apps/web/src/views/FavoritesView.tsx`
- `apps/web/src/views/AchievementsView.tsx`
- `apps/web/src/views/SettingsDialog.tsx`

不改：`packages/core`、`packages/storage`、`apps/server`。
