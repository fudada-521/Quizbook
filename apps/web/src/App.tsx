import { useEffect, useMemo } from 'react';
import { achievementById, QuizData } from '@quiz/core';
import { createLocalStorageStore, DEFAULT_SYNC_BACKEND } from '@quiz/storage/web';
import { QuizProvider, useQuiz } from './store/QuizStore';
import { HomeView } from './views/HomeView';
import { QuizView } from './views/QuizView';
import { ResultView } from './views/ResultView';
import { FavoritesView } from './views/FavoritesView';
import { AchievementsView } from './views/AchievementsView';
import { SettingsDialog } from './views/SettingsDialog';
import { Icon } from './components/Icon';
import rawData from '../../../data/questions.json';

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
    <QuizProvider data={data} store={store} sync={sync}>
      <Shell />
    </QuizProvider>
  );
}

function openSettings() {
  (document.getElementById('settings') as HTMLDialogElement | null)?.showModal();
}

function Shell() {
  const { app, setView, cloud } = useQuiz();
  const inQuiz = app.view === 'quiz';

  return (
    <div className="app-shell">
      {!inQuiz && (
        <header className="app-head">
          <button className="brand" onClick={() => setView('home')} aria-label="返回首页">
            <span className="brand-mark">Q</span>
            <span className="brand-name">题本</span>
            <span className="brand-rule" />
            <span className="brand-sub">综合知识</span>
          </button>
          <div className="header-actions">
            <button
              className={`icon-btn${app.view === 'achievements' ? ' active' : ''}`}
              onClick={() => setView('achievements')}
              aria-label="成就"
              title="成就"
            >
              <Icon name="trophy" />
            </button>
            <button
              className={`icon-btn${app.view === 'favorites' ? ' active' : ''}`}
              onClick={() => setView('favorites')}
              aria-label="收藏夹"
              title="收藏夹"
            >
              <Icon name="star" />
            </button>
            <button
              className={`icon-btn cloud-btn${cloud.user ? ' active' : ''}`}
              onClick={openSettings}
              aria-label="账号与同步"
              title={cloud.user ? `已登录 ${cloud.user.login}` : '未登录 · 点击设置'}
            >
              <Icon name="cloud" />
              <span className={`cloud-dot ${cloud.phase}`} />
            </button>
            <button className="icon-btn" onClick={openSettings} aria-label="设置与数据" title="设置与数据">
              <Icon name="settings" />
            </button>
          </div>
        </header>
      )}

      <main className={`app-main${inQuiz ? ' quiz-main' : ''}`}>
        {app.view === 'home' && <HomeView />}
        {app.view === 'quiz' && <QuizView />}
        {app.view === 'result' && <ResultView />}
        {app.view === 'favorites' && <FavoritesView />}
        {app.view === 'achievements' && <AchievementsView />}
      </main>

      {app.view === 'home' && <Footer />}
      <SettingsDialog />
      <AchievementToast />
    </div>
  );
}

function AchievementToast() {
  const { newAchievements, dismissAchievements } = useQuiz();

  useEffect(() => {
    if (!newAchievements.length) return;
    const timer = window.setTimeout(dismissAchievements, 5000);
    return () => window.clearTimeout(timer);
  }, [newAchievements, dismissAchievements]);

  if (!newAchievements.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {newAchievements.map((id) => {
        const def = achievementById(id);
        if (!def) return null;
        return (
          <button className="toast" key={id} onClick={dismissAchievements}>
            <span className="toast-icon">
              <Icon name="trophy" size={18} />
            </span>
            <span className="toast-copy">
              <strong>解锁成就 · {def.title}</strong>
              <span>{def.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Footer() {
  return (
    <footer className="app-foot">
      <p className="shortcut-hint">
        快捷键 <kbd>A</kbd>–<kbd>D</kbd> 选择 · <kbd>Enter</kbd> 确认/继续 · <kbd>←</kbd>
        <kbd>→</kbd> 翻题
      </p>
      <p>题目文字由扫描版教材经 OCR 识别生成，个别字词可能存在误差，请以官方教材为准。</p>
    </footer>
  );
}