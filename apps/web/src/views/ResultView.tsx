import { useQuiz } from '../store/QuizStore';
import { qkey } from '@quiz/core';

export function ResultView() {
  const { app, state, quit, reviewWrong } = useQuiz();
  const sess = app.session;
  if (!sess) return null;

  const done = sess.list.filter((it) => it.done).length;
  const right = sess.list.filter((it) => {
    const r = state.answers[qkey(it.q)];
    return r && r.ok;
  }).length;
  const wrong = done - right;
  const pct = done ? Math.round((right / done) * 100) : 0;
  const msg =
    pct >= 80 ? '掌握得很好，继续保持。' : pct >= 60 ? '基础不错，再巩固一下错题。' : '建议回看教材相关章节。';

  return (
    <div className="result-page">
      <p className="eyebrow">{sess.title}</p>
      <div className="result-score">
        {pct}
        <small>%</small>
      </div>
      <p className="result-msg">{msg}</p>

      <div className="result-bar" aria-hidden="true">
        <i className="r" style={{ width: `${done ? (right / done) * 100 : 0}%` }} />
        <i className="w" style={{ width: `${done ? (wrong / done) * 100 : 0}%` }} />
      </div>

      <div className="result-stats">
        <div className="result-stat">
          <b>{done}</b>
          <span>作答</span>
        </div>
        <div className="result-stat">
          <b>{right}</b>
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
        {wrong > 0 ? (
          <button className="btn primary" onClick={reviewWrong}>
            回顾本轮错题
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