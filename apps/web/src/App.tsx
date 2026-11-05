/** @format */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { achievementById, type QuizData } from "@megrez/core";
import { createLocalStorageStore, DEFAULT_SYNC_BACKEND } from "@megrez/storage/web";
import { QuizProvider, useQuiz, type View } from "./store/QuizStore";
import { useEdgeSwipeBack } from "./gestures";
import { HomeView } from "./views/HomeView";
import { QuizView } from "./views/QuizView";
import { ResultView } from "./views/ResultView";
import { FavoritesView } from "./views/FavoritesView";
import { AchievementsView } from "./views/AchievementsView";
import { SettingsView } from "./views/SettingsView";
import { Icon } from "./components/Icon";
import { FeedbackHost } from "./components/Feedback";
import { WaterLight } from "./components/WaterLight";
import rawData from "../../../data/questions.json";

export default function App() {
    const data = useMemo<QuizData>(() => {
        const d = rawData as unknown as QuizData;
        // JSON 反序列化后 chapters 键为字符串，标准化为数字键便于索引
        const chapters: Record<string, string> = { ...d.chapters };
        const questions = d.questions.map((q) => ({ ...q }));
        return { ...d, chapters, questions };
    }, []);
    const store = useMemo(() => createLocalStorageStore(), []);
    const sync = useMemo(() => DEFAULT_SYNC_BACKEND, []);

    return (
        <QuizProvider
            data={data}
            store={store}
            sync={sync}>
            <Shell />
        </QuizProvider>
    );
}

/**
 * 任意模态 <dialog> 打开时锁住页面滚动。
 * 原生 showModal 不会阻止 iOS WKWebView 的滑动透传，这里统一在 <html> 上打标记，
 * 样式负责 overflow 锁定与 overscroll-behavior，避免弹窗内滑到底后带着首页一起滚。
 */
function useDialogScrollLock() {
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => {
            root.classList.toggle("has-open-dialog", Boolean(document.querySelector("dialog[open]")));
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["open"],
        });
        return () => {
            observer.disconnect();
            root.classList.remove("has-open-dialog");
        };
    }, []);
}

function Shell() {
    const { app, setView, cloud } = useQuiz();
    const inQuiz = app.view === "quiz";

    const openSettings = () => setView("settings");

    useDialogScrollLock();

    // 让系统返回键 / iOS 边缘返回与应用内视图一致：进入二级页时压一条历史
    const navRef = useRef({ view: app.view, pushed: false });
    const lastNavRef = useRef(0);

    useEffect(() => {
        const nav = navRef.current;
        if (nav.view === app.view) return;
        nav.view = app.view;
        if (app.view === "home") {
            if (nav.pushed) {
                nav.pushed = false;
                window.history.back();
            }
            return;
        }
        if (!nav.pushed) {
            window.history.pushState({ megrezView: app.view }, "");
            nav.pushed = true;
        } else {
            window.history.replaceState({ megrezView: app.view }, "");
        }
    }, [app.view]);

    // 刷新后应用总是从首页开始，把可能残留的二级页历史状态重置掉
    useEffect(() => {
        window.history.replaceState({ megrezView: "home" }, "");
    }, []);

    useEffect(() => {
        const onPop = (e: PopStateEvent) => {
            lastNavRef.current = Date.now();
            const target = (e.state as { megrezView?: View } | null)?.megrezView ?? "home";
            const nav = navRef.current;
            nav.view = target;
            nav.pushed = target !== "home";
            setView(target);
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, [setView]);

    const goBack = useCallback(() => {
        // 与原生返回手势可能同时触发，500ms 内只处理一次
        if (Date.now() - lastNavRef.current < 500) return;
        lastNavRef.current = Date.now();
        if (navRef.current.pushed) window.history.back();
        else setView("home");
    }, [setView]);

    useEdgeSwipeBack(app.view !== "home" && app.view !== "quiz", goBack);

    return (
        <div
            className="app-shell"
            data-view={app.view}>
            <div
                className="light-field"
                aria-hidden="true">
                <WaterLight className="water-light" />
            </div>
            {!inQuiz && (
                <header className="app-head">
                    <button
                        className="brand"
                        onClick={() => setView("home")}
                        aria-label="返回首页">
                        <span className="brand-mark">
                            <Icon name="star" size={16} fill="currentColor" stroke="none" />
                        </span>
                        <span className="brand-name">天权</span>
                        <span className="brand-rule" />
                        <span className="brand-sub">
                            <span className="brand-sub-full">软考 · 信息系统项目管理师</span>
                            <span className="brand-sub-short">软考</span>
                        </span>
                    </button>
                    <div className="header-actions">
                        <button
                            className={`icon-btn${app.view === "achievements" ? " active" : ""}`}
                            onClick={() => setView("achievements")}
                            aria-label="成就"
                            title="成就">
                            <Icon name="trophy" />
                        </button>
                        <button
                            className={`icon-btn${app.view === "favorites" ? " active" : ""}`}
                            onClick={() => setView("favorites")}
                            aria-label="收藏夹"
                            title="收藏夹">
                            <Icon name="star" />
                        </button>
                        <button
                            className={`icon-btn cloud-btn${cloud.user ? " active" : ""}`}
                            onClick={openSettings}
                            aria-label="账号与同步"
                            title={cloud.user ? `已登录 ${cloud.user.username}` : "未登录，点击设置"}>
                            <Icon name="cloud" />
                            <span className={`cloud-dot ${cloud.phase}`} />
                        </button>
                        <button
                            className={`icon-btn${app.view === "settings" ? " active" : ""}`}
                            onClick={openSettings}
                            aria-label="设置与数据"
                            title="设置与数据">
                            <Icon name="settings" />
                        </button>
                    </div>
                </header>
            )}

            <main className={`app-main${inQuiz ? " quiz-main" : ""}`}>
                {app.view === "home" && <HomeView />}
                {app.view === "quiz" && <QuizView />}
                {app.view === "result" && <ResultView />}
                {app.view === "favorites" && <FavoritesView />}
                {app.view === "achievements" && <AchievementsView />}
                {app.view === "settings" && <SettingsView />}
            </main>

            {app.view === "home" && <Footer />}
            <AchievementToast />
            <FeedbackHost />
        </div>
    );
}

function AchievementToast() {
    const { app, newAchievements, dismissAchievements } = useQuiz();
    const confirmRef = useRef<HTMLButtonElement>(null);
    const [holding, setHolding] = useState(false);

    // 限时挑战与模拟考有真实倒计时，祝贺层不抢断答题；离开该场次后再补显示
    const timedQuiz =
        app.view === "quiz" && (app.session?.mode === "timed" || app.session?.mode === "exam");
    const visible = newAchievements.length > 0 && !timedQuiz;

    useEffect(() => {
        if (!visible) return;
        // 悬停或键盘聚焦时延后收起，但不无限停留，避免挡住答题
        const timer = window.setTimeout(dismissAchievements, holding ? 12000 : 6000);
        return () => window.clearTimeout(timer);
    }, [visible, holding, dismissAchievements]);

    useEffect(() => {
        if (!visible) return;
        confirmRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") dismissAchievements();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [visible, dismissAchievements]);

    if (!visible) return null;

    const defs = newAchievements.flatMap((id) => {
        const def = achievementById(id);
        return def ? [def] : [];
    });
    if (!defs.length) return null;

    return (
        <div
            className="celebrate-layer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="celebrate-title">
            <div
                className="celebrate-backdrop"
                aria-hidden="true"
                onClick={dismissAchievements}
            />
            <div
                className="celebrate-card"
                onMouseEnter={() => setHolding(true)}
                onMouseLeave={() => setHolding(false)}
                onFocus={() => setHolding(true)}
                onBlur={() => setHolding(false)}>
                <span className="celebrate-icon">
                    <Icon
                        name="trophy"
                        size={30}
                    />
                </span>
                <h2
                    className="celebrate-kicker"
                    id="celebrate-title">
                    成就解锁
                </h2>
                <div className="celebrate-list">
                    {defs.map((def) => (
                        <div key={def.id}>
                            <strong>{def.title}</strong>
                            <span>{def.description}</span>
                        </div>
                    ))}
                </div>
                <button
                    ref={confirmRef}
                    className="btn primary celebrate-confirm"
                    onClick={dismissAchievements}>
                    继续答题
                </button>
            </div>
        </div>
    );
}

function Footer() {
    return (
        <footer className="app-foot">
            <p className="shortcut-hint">
                快捷键 <kbd>A</kbd>、<kbd>B</kbd>、<kbd>C</kbd>、<kbd>D</kbd> 选择；<kbd>Enter</kbd> 确认或继续；
                <kbd>←</kbd>
                <kbd>→</kbd> 翻题
            </p>
        </footer>
    );
}
