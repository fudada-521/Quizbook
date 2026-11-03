import { useMemo } from 'react';
import { QuizData } from '@quiz/core';
import { createLocalStorageStore, DEFAULT_SYNC_BACKEND } from '@quiz/storage/web';
import { QuizProvider, useQuiz } from './store/QuizStore';
import { HomeView } from './views/HomeView';
import { QuizView } from './views/QuizView';
import { ResultView } from './views/ResultView';
import { FavoritesView } from './views/FavoritesView';
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
  const { app, setView } = useQuiz();
  const inQuiz = app.view === 'quiz';

  return (
    <div className="app-shell">
      {!inQuiz && (
        <header className="app-head">
          <button className="brand" onClick={() => setView('home')} aria-label="返回首页">
            <span className="brand-mark">知</span>
            <span className="brand-name">知题</span>
            <span className="brand-rule" />
            <span className="brand-sub">综合知识</span>
          </button>
          <div className="header-actions">
            <button
              className={`icon-btn${app.view === 'favorites' ? ' active' : ''}`}
              onClick={() => setView('favorites')}
              aria-label="收藏夹"
              title="收藏夹"
            >
              <Icon name="star" />
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
      </main>

      {app.view === 'home' && <Footer />}
      <SettingsDialog />
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