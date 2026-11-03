import { useEffect, useRef, useState } from 'react';
import { useQuiz } from '../store/QuizStore';
import { qkey, type SessionItem } from '@quiz/core';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function QuizView() {
  const { app, state, settings, pick, next, prev, jump, quit, toggleSheet, setAutoPending, tickNow } = useQuiz();
  const sess = app.session;
  const it = sess?.list[sess.idx];

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sess || !it) return;
      const k = e.key.toUpperCase();
      if ('ABCD'.includes(k) && !it.done) pick('ABCD'.indexOf(k));
      else if (e.key === 'Enter') {
        if (!it.done && settings.instant === 0 && it.pick != null) pick(it.pick);
        else if (it.done) next();
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sess, it, pick, next, prev, settings.instant, setAutoPending, tickNow]);

  if (!sess || !it) return null;
  const done = sess.list.filter((x) => x.done).length;
  const isLast = sess.idx === sess.list.length - 1;

  return (
    <div>
      <div className="quiz-top">
        <div className="row">
          <button className="btn" onClick={quit}>← 退出</button>
          <div className="progress-info">{sess.title} · 第 {sess.idx + 1} / {sess.list.length} 题</div>
          <button className="btn" onClick={toggleSheet}>{app.sheetOpen ? '收起答题卡' : '答题卡'}</button>
        </div>
        <div className="qbar"><i style={{ width: (done / sess.list.length) * 100 + '%' }} /></div>
        {app.sheetOpen && <AnswerSheet />}
      </div>

      <div className="qcard in" key={sess.idx}>
        <span className="qtag">{sess.title} · 原题号 {it.q.n}</span>
        <div className="stem">{it.q.s}</div>
        {!it.done && <Options item={it} />}
        {!it.done && settings.instant === 0 && it.pick != null && (
          <div className="submit-row">
            <button className="btn primary" style={{ width: '100%', padding: 11 }} onClick={() => pick(it.pick!)}>
              确 认 答 案
            </button>
          </div>
        )}
        {it.done && <Reveal item={it} />}

        <div className="nav-row">
          <button className="btn" disabled={sess.idx === 0} onClick={prev}>上一题</button>
          <button className="btn primary" onClick={next}>
            {isLast ? '完成 ✓' : '继续 →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Options({ item }: { item: SessionItem }) {
  const { settings, pick } = useQuiz();
  return (
    <div>
      {item.map.map((origIdx, dispIdx) => {
        let cls = 'opt';
        if (settings.instant === 0 && item.pick === dispIdx) cls += ' picked';
        return (
          <div key={dispIdx} className={cls} onClick={() => pick(dispIdx)}>
            <span className="letter">{LETTERS[dispIdx]}</span>
            <span>{item.q.o[origIdx]}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 百词斩式解析卡片 + 答对倒计时自动跳转 */
function Reveal({ item }: { item: SessionItem }) {
  const { settings, next, setAutoPending, app } = useQuiz();
  const pickedOrig = item.map[item.lastPick];
  const ok = pickedOrig === item.q.a;
  const right = item.q.o[item.q.a];

  const [remainMs, setRemainMs] = useState(settings.autoNext);
  const [paused, setPaused] = useState(false);

  const shouldAuto = ok && settings.autoNext > 0 && !paused;
  const total = settings.autoNext;

  useEffect(() => {
    if (!shouldAuto) return;
    setRemainMs(total);
    const start = Date.now();
    const end = start + total;
    let raf: number;
    const tick = () => {
      const left = end - Date.now();
      setRemainMs(Math.max(0, left));
      setAutoPending(left > 0);
      if (left > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        next();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setAutoPending(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, shouldAuto, total, paused]);

  const secs = (remainMs / 1000).toFixed(1);
  const progress = total > 0 ? remainMs / total : 0;
  const R = 9;
  const C = 2 * Math.PI * R;

  return (
    <div className="reveal-wrap">
      <div className={`reveal-head ${ok ? 'ok' : 'bad'}`}>
        <span>{ok ? '✅ 回答正确！' : `❌ 答错了，正确答案 ${LETTERS[item.q.a]}`}</span>
        {ok && shouldAuto ? (
          <span className="countdown">
            <svg className="cd-ring" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="3" />
              <circle
                cx="12" cy="12" r={R} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - progress)).toFixed(1)}
                transform="rotate(-90 12 12)"
              />
            </svg>
            {secs}s 后自动下一题
            <button className="cancel-cd" onClick={() => setPaused(true)}>暂停</button>
          </span>
        ) : ok && paused ? (
          <span className="countdown">
            已暂停 · <button className="cancel-cd" onClick={() => next()}>继续 →</button>
          </span>
        ) : ok ? (
          <span className="countdown">{truncate(right)}</span>
        ) : (
          <span className="countdown">{truncate(right)}</span>
        )}
      </div>
      <div className="reveal-body">
        <b>解析：</b>{item.q.e || '（本题原书无解析）'}
      </div>
      {!ok && <div className="reveal-hint">答错了也别急，读懂解析后点「继续」或按 Enter ↵</div>}
    </div>
  );
}

function AnswerSheet() {
  const { app, state, jump, toggleSheet } = useQuiz();
  const sess = app.session;
  if (!sess) return null;
  return (
    <div className="answer-sheet">
      {sess.list.map((it, i) => {
        const r = state.answers[qkey(it.q)];
        let cls = 'dot';
        if (it.done && r) cls += r.ok ? ' ok' : ' bad';
        if (i === sess.idx) cls += ' cur';
        return (
          <div key={i} className={cls} onClick={() => { jump(i); toggleSheet(); }}>
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

function truncate(s: string, n = 42): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}