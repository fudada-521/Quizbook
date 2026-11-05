/** @format */

import {
    favoriteQuestions,
    achievementProgress,
    achievementStats,
    dailyCompletedOn,
    dateKey,
    DAILY_COUNT,
    TIMED_COUNT,
    EXAM_COUNT,
} from "@quiz/core";
import { useQuiz } from "../store/QuizStore";
import { Icon } from "../components/Icon";

export function HomeView() {
    const {
        data,
        state,
        settings,
        resume,
        savedSessions,
        resumeSession,
        restartResume,
        startChapter,
        startRandom,
        startUnanswered,
        startWrong,
        startFavorites,
        startDaily,
        startTimed,
        startExam,
        setView,
    } = useQuiz();

    const stats = achievementStats(state, data);
    const achievements = achievementProgress(state, data);
    const unlockedCount = achievements.filter((a) => a.unlocked).length;
    const dailyDone = dailyCompletedOn(state, dateKey());

    const total = data.questions.length;
    const answered = Object.keys(state.answers).length;
    const right = Object.values(state.answers).filter((a) => a.ok).length;
    const wrongCount = Object.keys(state.wrong).length;
    const favCount = favoriteQuestions(data, state).length;
    const acc = answered ? Math.round((right / answered) * 100) + "%" : "暂无";

    const byCh: Record<number, typeof data.questions> = {};
    data.questions.forEach((q) => {
        (byCh[q.c] = byCh[q.c] || []).push(q);
    });

    // 按练习来源索引未完成会话，入口上显示「继续，第 N/M 题」
    const resumeByOrigin = new Map(savedSessions.map((s) => [s.origin, s]));
    const pendingLabel = (origin: string, fallback: string) => {
        const p = resumeByOrigin.get(origin);
        return p ? `继续，第 ${p.idx + 1}/${p.list.length} 题` : fallback;
    };

    return (
        <div className="home">
            <header className="page-head">
                <h1>保持节奏，继续推进。</h1>
                <p className="page-sub">
                    已作答 {answered.toLocaleString()} / {total.toLocaleString()} 题，正确率 {acc}
                </p>
            </header>

            <div className="home-grid">
                <section className="continue-card home-hero">
                    <div className="continue-main">
                        <div className="continue-head">
                            <h2 className="continue-title">{resume ? resume.title : "智能推进，新题优先"}</h2>
                            <span className="continue-status">{resume ? "未完成练习" : "准备开始"}</span>
                        </div>
                        <p className="continue-meta">
                            {resume
                                ? `第 ${resume.idx + 1} / ${resume.total} 题，已完成 ${resume.done} 题`
                                : `优先未做过的题，每组 ${settings.count} 题`}
                        </p>
                        <div className="progress">
                            <i
                                style={{
                                    transform: `scaleX(${
                                        resume ? resume.done / resume.total : total ? answered / total : 0
                                    })`,
                                }}
                            />
                        </div>
                        <div className="continue-actions">
                            <button
                                className="btn primary lg"
                                onClick={resume ? () => resumeSession(resume.origin) : startUnanswered}>
                                {resume ? "继续练习" : "开始练习"}
                                <Icon
                                    name="arrow-right"
                                    size={16}
                                />
                            </button>
                            {resume && (
                                <button
                                    className="btn ghost"
                                    onClick={restartResume}>
                                    重新开始一组
                                </button>
                            )}
                        </div>
                    </div>
                    {answered > 0 && (
                        <div className="continue-side">
                            <b>{acc}</b>
                            <span>总体正确率</span>
                        </div>
                    )}
                </section>
                <aside className="home-aside">
                    <section className="panel">
                        <div className="panel-head">
                            <h2>学习概览</h2>
                        </div>
                        <div className="stat-grid">
                            <div className="stat-cell">
                                <b>{answered.toLocaleString()}</b>
                                <span>已作答</span>
                            </div>
                            <div className="stat-cell">
                                <b>{acc}</b>
                                <span>正确率</span>
                            </div>
                            <div className="stat-cell">
                                <b>{wrongCount}</b>
                                <span>错题</span>
                            </div>
                            <div className="stat-cell">
                                <b>{stats.currentStreak}</b>
                                <span>连续打卡</span>
                            </div>
                        </div>
                    </section>

                    <section className="panel achievement-teaser">
                        <button
                            className="achievement-link"
                            onClick={() => setView("achievements")}>
                            <span className={`achievement-badge${unlockedCount === achievements.length ? " all" : ""}`}>
                                <Icon
                                    name="trophy"
                                    size={20}
                                />
                            </span>
                            <span className="achievement-copy">
                                <strong>
                                    成就 {unlockedCount} / {achievements.length}
                                </strong>
                                <span className="progress thin">
                                    <i style={{ transform: `scaleX(${unlockedCount / achievements.length})` }} />
                                </span>
                            </span>
                            <Icon
                                name="chevron-right"
                                size={15}
                                className="chev"
                            />
                        </button>
                    </section>

                    <section className="panel">
                        <div className="panel-head">
                            <h2>挑战模式</h2>
                        </div>
                        <div className="mode-list">
                            <button
                                className="mode-row"
                                onClick={startDaily}>
                                <span className="mode-icon">
                                    <Icon
                                        name="calendar"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">每日一练</span>
                                <span className="mode-desc">
                                    {pendingLabel(`daily:${dateKey()}`, dailyDone ? "今日已完成" : `${DAILY_COUNT} 题`)}
                                </span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                            <button
                                className="mode-row"
                                onClick={startTimed}>
                                <span className="mode-icon">
                                    <Icon
                                        name="clock"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">限时挑战</span>
                                <span className="mode-desc">{pendingLabel("timed", `${TIMED_COUNT} 题，10 分钟`)}</span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                            <button
                                className="mode-row"
                                onClick={startExam}>
                                <span className="mode-icon">
                                    <Icon
                                        name="target"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">模拟考</span>
                                <span className="mode-desc">{pendingLabel("exam", `${EXAM_COUNT} 题，150 分钟`)}</span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                        </div>
                    </section>

                    <section className="panel">
                        <div className="panel-head">
                            <h2>练习方式</h2>
                        </div>
                        <div className="mode-list">
                            <button
                                className="mode-row"
                                onClick={startRandom}>
                                <span className="mode-icon">
                                    <Icon
                                        name="shuffle"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">随机练习</span>
                                <span className="mode-desc">{pendingLabel("random", `${settings.count} 题`)}</span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                            <button
                                className="mode-row"
                                onClick={startUnanswered}>
                                <span className="mode-icon">
                                    <Icon
                                        name="compass"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">智能推进</span>
                                <span className="mode-desc">{pendingLabel("unanswered", "未做优先")}</span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                            <button
                                className="mode-row"
                                onClick={startWrong}>
                                <span className="mode-icon">
                                    <Icon
                                        name="book"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">错题重练</span>
                                <span className="mode-desc">
                                    {pendingLabel("wrong", wrongCount ? `${wrongCount} 道` : "暂无")}
                                </span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                            <button
                                className="mode-row"
                                onClick={() => startFavorites()}>
                                <span className="mode-icon">
                                    <Icon
                                        name="star"
                                        size={17}
                                    />
                                </span>
                                <span className="mode-label">收藏练习</span>
                                <span className="mode-desc">
                                    {pendingLabel("favorites", favCount ? `${favCount} 道` : "暂无")}
                                </span>
                                <Icon
                                    name="chevron-right"
                                    size={15}
                                    className="chev"
                                />
                            </button>
                        </div>
                    </section>
                </aside>

                <section className="chapters-panel home-chapters">
                    <div className="section-head">
                        <h2>按章节练习</h2>
                        <span>
                            {Object.keys(byCh).length} 章，共 {total.toLocaleString()} 题
                        </span>
                    </div>
                    <div className="chapter-list">
                        {Object.keys(byCh)
                            .map(Number)
                            .sort((a, b) => a - b)
                            .map((c) => {
                                const qs = byCh[c];
                                const done = qs.filter((q) => state.answers[`${q.c}-${q.n}`]).length;
                                const r = qs.filter((q) => state.answers[`${q.c}-${q.n}`]?.ok).length;
                                const pct = done ? Math.round((r / done) * 100) : 0;
                                const pending = resumeByOrigin.get(`chapter:${c}`);
                                return (
                                    <button
                                        className={`chapter-row${pending ? " resumable" : ""}`}
                                        key={c}
                                        onClick={() => startChapter(c)}>
                                        <span className="chapter-index">{String(c).padStart(2, "0")}</span>
                                        <span className="chapter-main">
                                            <span className="chapter-name">
                                                {data.chapters[String(c)] ?? `第${c}章`}
                                            </span>
                                            <span className="chapter-meta">
                                                <span>{qs.length} 题</span>
                                                <span>
                                                    {pending
                                                        ? `继续，第 ${pending.idx + 1}/${pending.list.length} 题`
                                                        : done
                                                          ? `已做 ${done}`
                                                          : "未开始"}
                                                </span>
                                            </span>
                                            {done > 0 && (
                                                <span className="progress thin">
                                                    <i
                                                        style={{
                                                            transform: `scaleX(${qs.length ? done / qs.length : 0})`,
                                                        }}
                                                    />
                                                </span>
                                            )}
                                        </span>
                                        <span className="chapter-pct">{done ? `${pct}%` : ""}</span>
                                        <Icon
                                            name="chevron-right"
                                            size={15}
                                            className="chev"
                                        />
                                    </button>
                                );
                            })}
                    </div>
                </section>
            </div>
        </div>
    );
}
