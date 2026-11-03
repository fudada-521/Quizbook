import { useQuiz } from '../store/QuizStore';

export function HomeView() {
  const { data, state, startChapter, startRandom, startUnanswered, startWrong } = useQuiz();

  const total = data.questions.length;
  const answered = Object.keys(state.answers).length;
  const right = Object.values(state.answers).filter((a) => a.ok).length;
  const acc = answered ? Math.round((right / answered) * 100) + '%' : '--';

  const byCh: Record<number, typeof data.questions> = {};
  data.questions.forEach((q) => {
    (byCh[q.c] = byCh[q.c] || []).push(q);
  });

  const openSettings = () => {
    (document.getElementById('settings') as HTMLDialogElement | null)?.showModal();
  };

  return (
    <div>
      <div className="stats-row">
        <div className="stat"><b>{total.toLocaleString()}</b><span>题库总题数</span></div>
        <div className="stat"><b>{answered.toLocaleString()}</b><span>已作答</span></div>
        <div className="stat"><b>{acc}</b><span>总体正确率</span></div>
        <div className="stat"><b>{Object.keys(state.wrong).length}</b><span>错题本</span></div>
      </div>

      <div className="section-title">练习模式</div>
      <div className="modes">
        <div className="mode-card" onClick={startRandom}>
          <div className="ico">🔀</div><div className="t">随机练习</div><div className="d">全库随机抽题，默认 20 题</div>
        </div>
        <div className="mode-card" onClick={startWrong}>
          <div className="ico">📕</div><div className="t">错题重练</div><div className="d">只刷答错过的题目</div>
        </div>
        <div className="mode-card" onClick={startUnanswered}>
          <div className="ico">🧭</div><div className="t">智能推进</div><div className="d">优先做从未答过的题</div>
        </div>
        <div className="mode-card" onClick={openSettings}>
          <div className="ico">⚙️</div><div className="t">设置 / 数据</div><div className="d">题量、乱序、导出记录</div>
        </div>
      </div>

      <div className="section-title">按章节练习（顺序模式）</div>
      <div className="chapters">
        {Object.keys(byCh).map(Number).sort((a, b) => a - b).map((c) => {
          const qs = byCh[c];
          const done = qs.filter((q) => state.answers[`${q.c}-${q.n}`]).length;
          const r = qs.filter((q) => state.answers[`${q.c}-${q.n}`]?.ok).length;
          return (
            <div className="chap-card" key={c} onClick={() => startChapter(c)}>
              <div className="name">第{String(c).padStart(2, '0')}章 {data.chapters[String(c)] ?? ''}</div>
              <div className="meta">
                <span>{qs.length} 题</span>
                <span>{done ? `已做 ${done} · 正确率 ${Math.round((r / done) * 100)}%` : '未开始'}</span>
              </div>
              <div className="bar"><i style={{ width: qs.length ? (done / qs.length) * 100 + '%' : '0%' }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}