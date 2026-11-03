import { useEffect, useMemo, useState } from 'react';
import { QuizData, normalizeState } from '@quiz/core';
import { createLocalStorageStore, DEFAULT_SYNC_BACKEND } from '@quiz/storage/web';
import { QuizProvider, useQuiz } from './store/QuizStore';
import { HomeView } from './views/HomeView';
import { QuizView } from './views/QuizView';
import { ResultView } from './views/ResultView';
import { SettingsDialog } from './views/SettingsDialog';
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

function Shell() {
  const { app } = useQuiz();
  return (
    <div className="wrap">
      <header>
        <h1>🎯 高项千题闯关 · 答题练习</h1>
        <p>基于《江山老师题库 · 千题闯关》整理 · 选择后立即判分并显示解析</p>
      </header>
      {app.view === 'home' && <HomeView />}
      {app.view === 'quiz' && <QuizView />}
      {app.view === 'result' && <ResultView />}
      <SettingsDialog />
      <footer>
        快捷键：<kbd>A</kbd>-<kbd>D</kbd> 选择选项 · <kbd>Enter</kbd> 确认/继续 ·{' '}
        <kbd>←</kbd>/<kbd>→</kbd> 翻题 · 进度自动保存在本机
        <br />
        题目文字由扫描版 PDF 经 OCR 识别生成，个别字词可能存在识别误差，请以官方教材为准。
      </footer>
    </div>
  );
}