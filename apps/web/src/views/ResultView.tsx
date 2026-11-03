import { useQuiz } from '../store/QuizStore';
import { qkey } from '@quiz/core';

export function ResultView() {
  const { app, state, quit, reviewWrong } = useQuiz();
  const sess = app.session;
  if (!sess) {
    return null;
  }
  const done = sess.list.filter((it) => it.done).length;
  const right = sess.list.filter((it) => {
    const r = state.answers[qkey(it.q)];
    return r && r.ok;
  }).length;
  const pct = done ? Math.round((right / done) * 100) : 0;
  const msg = pct >= 80 ? '，非常棒！' : pct >= 60 ? '，继续加油！' : '，建议回看教材相关章节 💪';

  return (
    <div className="result-hero">
      <div className="ring">{pct}%</div>
      <p>{sess.title} · 作答 {done}/{sess.list.length} 题，正确 {right} 题{msg}</p>
      <div className="actions">
        <button className="btn" onClick={quit}>返回首页</button>
        <button className="btn primary" onClick={reviewWrong}>回顾错题</button>
      </div>
    </div>
  );
}