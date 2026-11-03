import { useEffect, useState } from 'react';
import { useQuiz } from '../store/QuizStore';
import { isFavorite, qkey, type SessionItem } from '@quiz/core';
import { Icon } from '../components/Icon';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function QuizView() {
  const {
    app,
    state,
    settings,
    pick,
    next,
    prev,
    jump,
    quit,
    toggleSheet,
    setAutoPending,
    toggleFavorite,
  } = useQuiz();
  const sess = app.session;
  const it = sess?.list[sess.idx];

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sess || !it) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      // Enter 交给获得焦点的按钮自身处理，避免与全局快捷键重复触发
      if (e.key === 'Enter' && target?.tagName === 'BUTTON') return;
      if (document.querySelector('dialog[open]')) return;

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
  }, [sess, it, pick, next, prev, settings.instant]);

  if (!sess || !it) return null;
  const done = sess.list.filter((x) => x.done).length;
  const isLast = sess.idx === sess.list.length - 1;
  const fav = isFavorite(state, it.q);

  return (
    <div className="quiz-page">
      <div className="quiz-bar">
        <div className="quiz-bar-row">
          <button className="btn ghost sm" onClick={quit}>
            <Icon name="arrow-left" size={16} />
            退出
          </button>
          <div className="quiz-title">
            <strong>{sess.title}</strong>
            <span className="count">
              {sess.idx + 1} / {sess.list.length}
            </span>
          </div>
          <button className="btn ghost sm" onClick={toggleSheet}>
            <Icon name="grid" size={16} />
            {app.sheetOpen ? '收起' : '答题卡'}
          </button>
        </div>
        <div className="progress thin accent">
          <i style={{ width: `${(done / sess.list.length) * 100}%` }} />
        </div>
        {app.sheetOpen && <AnswerSheet />}
      </div>

      <article className="question-card" key={sess.idx}>
        <div className="q-head">
          <p className="q-meta">
            {sess.title} · 原题 {it.q.n}
          </p>
          <button
            className={`fav-btn${fav ? ' active' : ''}`}
            onClick={() => toggleFavorite(it.q)}
            aria-pressed={fav}
            aria-label={fav ? '取消收藏' : '收藏题目'}
            title={fav ? '取消收藏' : '收藏题目'}
          >
            <Icon name="star" size={16} />
            <span>{fav ? '已收藏' : '收藏'}</span>
          </button>
        </div>
        <h2 className="stem">{it.q.s}</h2>
        <Options item={it} />

        {!it.done && settings.instant === 0 && it.pick != null && (
          <div className="submit-row">
            <button className="btn primary" onClick={() => pick(it.pick!)}>
              确认答案
            </button>
          </div>
        )}

        {it.done && <Reveal item={it} />}

        <div className="quiz-nav">
          <button className="btn ghost" disabled={sess.idx === 0} onClick={prev}>
            上一题
          </button>
          <button className="btn primary" onClick={next}>
            {isLast ? '完成' : '下一题'}
            <Icon name="arrow-right" size={16} />
          </button>
        </div>

        <p className="shortcut-hint">A–D 选择 · Enter 继续 · ← → 翻题</p>
      </article>
    </div>
  );
}

function Options({ item }: { item: SessionItem }) {
  const { settings, pick } = useQuiz();
  return (
    <div className="options">
      {item.map.map((origIdx, dispIdx) => {
        let cls = 'option';
        let mark: { icon: 'check' | 'x'; text: string } | null = null;
        if (item.done) {
          cls += ' done';
          // 解析页：标出正确答案（绿）与自己选错的那项（红），其余淡化
          if (origIdx === item.q.a) {
            cls += ' correct';
            mark = { icon: 'check', text: '正确答案' };
          } else if (dispIdx === item.lastPick) {
            cls += ' wrong';
            mark = { icon: 'x', text: '你的选择' };
          } else {
            cls += ' dim';
          }
        } else if (settings.instant === 0 && item.pick === dispIdx) {
          cls += ' picked';
        }
        return (
          <div
            key={dispIdx}
            className={cls}
            onClick={item.done ? undefined : () => pick(dispIdx)}
          >
            <span className="letter">{LETTERS[dispIdx]}</span>
            <span className="text">{item.q.o[origIdx]}</span>
            {mark && (
              <span className="mark">
                <Icon name={mark.icon} size={13} />
                {mark.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 百词斩式解析卡片 + 答对倒计时自动跳转 */
function Reveal({ item }: { item: SessionItem }) {
  const { settings, next, setAutoPending } = useQuiz();
  const pickedOrig = item.map[item.lastPick];
  const ok = pickedOrig === item.q.a;

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
  const R = 8;
  const C = 2 * Math.PI * R;
  // 乱序模式下 q.a 是原始下标，需换算为当前屏幕上显示的字母位置
  const correctDispIdx = item.map.indexOf(item.q.a);

  return (
    <div className={`reveal ${ok ? 'ok' : 'bad'}`}>
      <div className="reveal-head">
        <span className="reveal-status">
          <Icon name={ok ? 'check' : 'x'} size={16} />
          {ok ? '回答正确' : '回答错误'}
        </span>
        {ok && shouldAuto ? (
          <span className="countdown">
            <svg className="cd-ring" viewBox="0 0 24 24">
              <circle
                cx="12"
                cy="12"
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="cd-track"
              />
              <circle
                cx="12"
                cy="12"
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={C.toFixed(1)}
                strokeDashoffset={(C * (1 - progress)).toFixed(1)}
                transform="rotate(-90 12 12)"
              />
            </svg>
            {secs}s
            <button className="chip" onClick={() => setPaused(true)}>
              暂停
            </button>
          </span>
        ) : ok && paused ? (
          <span className="countdown">
            已暂停
            <button className="chip" onClick={() => next()}>
              下一题
            </button>
          </span>
        ) : (
          <span className="answer-ref">正确答案 {LETTERS[correctDispIdx] ?? ''}</span>
        )}
      </div>
      <div className="reveal-body">
        <span className="label">解析</span>
        <p>{item.q.e || '（本题原书无解析）'}</p>
      </div>
      {!ok && (
        <p className="reveal-hint">读懂解析后，点「下一题」或按 Enter 继续</p>
      )}
    </div>
  );
}

function AnswerSheet() {
  const { app, state, jump, toggleSheet } = useQuiz();
  const sess = app.session;
  if (!sess) return null;
  const done = sess.list.filter((it) => it.done).length;

  return (
    <div className="answer-sheet">
      <div className="answer-sheet-head">
        <span>答题卡</span>
        <span>
          已答 {done} / {sess.list.length}
        </span>
      </div>
      <div className="sheet-grid">
        {sess.list.map((it, i) => {
          const r = state.answers[qkey(it.q)];
          let cls = 'dot';
          if (it.done && r) cls += r.ok ? ' ok' : ' bad';
          if (i === sess.idx) cls += ' cur';
          return (
            <button
              type="button"
              key={i}
              className={cls}
              onClick={() => {
                jump(i);
                toggleSheet();
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}