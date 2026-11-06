import { useEffect, useRef, useState } from 'react';
import { EXAM_PASS_SCORE, scoreSession, type SessionMode } from '@megrez/core';
import { useQuiz } from '../store/QuizStore';
import { emitResultFeedback, type ResultFeedback } from '../feedback';

const MODE_LABEL: Record<SessionMode, string> = {
  practice: '练习',
  daily: '每日一练',
  timed: '限时挑战',
  exam: '模拟考',
};

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 分数从 0 滚到位；减少动态效果时直接显示终值 */
function useCountUp(target: number, duration = 620): number {
  const [value, setValue] = useState(REDUCED_MOTION ? target : 0);

  useEffect(() => {
    if (REDUCED_MOTION) {
      setValue(target);
      return;
    }
    setValue(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export function ResultView() {
  const { app, quit, reviewWrong, redoSession, settings } = useQuiz();
  const sess = app.session;

  const done = sess ? sess.list.filter((it) => it.done).length : 0;
  const { score, total } = sess ? scoreSession(sess) : { score: 0, total: 0 };
  const wrong = done - score;
  const pct = total ? Math.round((score / total) * 100) : 0;
  const mode = sess?.mode ?? 'practice';
  const isExam = mode === 'exam';
  const passed = isExam && score >= EXAM_PASS_SCORE;

  const target = isExam ? score : pct;
  const shown = useCountUp(target);
  const tone: ResultFeedback = isExam
    ? passed
      ? 'great'
      : 'low'
    : pct >= 80
      ? 'great'
      : pct >= 60
        ? 'good'
        : 'low';

  // StrictMode 会重复执行 effect，用 ref 保证一轮结算只响一次
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    emitResultFeedback(tone, settings);
  }, [tone, settings]);

  if (!sess) return null;

  const msg =
    mode === 'daily'
      ? '今天的每日一练完成，记得回来保持连续打卡。'
      : isExam
        ? passed
          ? `达到及格线 ${EXAM_PASS_SCORE} 分，继续保持。`
          : `距离及格线 ${EXAM_PASS_SCORE} 分还差 ${Math.max(0, EXAM_PASS_SCORE - score)} 分，重点回看错题。`
        : mode === 'timed'
          ? pct >= 80
            ? '节奏和准确率都不错。'
            : '限时下先保证会做的题不丢分。'
          : pct >= 80
            ? '掌握得很好，继续保持。'
            : pct >= 60
              ? '基础不错，再巩固一下错题。'
              : '建议回看教材相关章节。';

  return (
    <div className="result-page">
      <header className="result-meta">
        <span>{MODE_LABEL[mode]}</span>
        <h1 className="result-meta-title">{sess.title}</h1>
      </header>

      {isExam ? (
        <div className={`result-score${passed ? ' pass' : ''}`}>
          {shown}
          <small>/ {total}</small>
        </div>
      ) : (
        <div className="result-score">
          {shown}
          <small>%</small>
        </div>
      )}

      {isExam && (
        <p className={`result-badge${passed ? ' pass' : ' fail'}`}>
          {passed ? '通过' : '未通过'}，及格线 {EXAM_PASS_SCORE} 分
        </p>
      )}

      <p className="result-msg">{msg}</p>

      <div className="result-bar" aria-hidden="true">
        <i className="r" style={{ width: `${total ? (score / total) * 100 : 0}%` }} />
        <i className="w" style={{ width: `${total ? (wrong / total) * 100 : 0}%` }} />
      </div>

      <div className="result-stats">
        <div className="result-stat">
          <b>{done}</b>
          <span>作答</span>
        </div>
        <div className="result-stat">
          <b>{score}</b>
          <span>正确</span>
        </div>
        <div className="result-stat">
          <b>{wrong}</b>
          <span>错误</span>
        </div>
      </div>

      <div className="result-actions">
        {wrong > 0 && (
          <button className="btn ghost" onClick={quit}>
            返回首页
          </button>
        )}
        <button className="btn ghost" onClick={redoSession}>
          重做本轮
        </button>
        {wrong > 0 ? (
          <button className="btn primary" onClick={reviewWrong}>
            重做本轮错题
          </button>
        ) : (
          <button className="btn primary" onClick={quit}>
            返回首页
          </button>
        )}
      </div>
    </div>
  );
}