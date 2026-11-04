import { useEffect, useRef, useState } from 'react';
import { chapterTitle, favoriteQuestions, qkey, type Question } from '@quiz/core';
import { useQuiz } from '../store/QuizStore';
import { Icon } from '../components/Icon';
import { QuestionNotes } from '../components/QuestionNotes';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function FavoritesView() {
  const { data, state, setView, startFavorites, startUnanswered, toggleFavorite } = useQuiz();
  const favorites = favoriteQuestions(data, state);
  const [detail, setDetail] = useState<Question | null>(null);
  const dlgRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (detail && dlg && !dlg.open) {
      dlg.showModal();
      dlg.scrollTop = 0;
      // 焦点放在弹窗容器上，避免打开瞬间选中关闭按钮
      dlg.focus();
    }
  }, [detail]);

  const closeDetail = () => {
    dlgRef.current?.close();
    setDetail(null);
  };

  const removeDetail = () => {
    if (!detail) return;
    toggleFavorite(detail);
    closeDetail();
  };

  return (
    <div className="favorites-page">
      <button className="back-link" onClick={() => setView('home')}>
        <Icon name="arrow-left" size={15} />
        返回首页
      </button>

      <header className="fav-head">
        <div>
          <h1>收藏的题目</h1>
          <p className="page-sub">
            共 {favorites.length} 道 · 按收藏时间从新到旧
          </p>
        </div>
        {favorites.length > 0 && (
          <button className="btn primary" onClick={startFavorites}>
            开始收藏练习
            <Icon name="arrow-right" size={16} />
          </button>
        )}
      </header>

      {favorites.length > 0 ? (
        <div className="fav-list">
          {favorites.map((q) => (
            <button className="fav-row" key={qkey(q)} onClick={() => setDetail(q)}>
              <span className="fav-main">
                <span className="fav-chapter">
                  第{String(q.c).padStart(2, '0')}章 {chapterTitle(data, q.c)} · 原题 {q.n}
                </span>
                <span className="fav-stem">{q.s}</span>
                <span className="fav-date">
                  收藏于 {formatDate(state.favorites[qkey(q)])}
                </span>
              </span>
              <Icon name="chevron-right" size={16} className="chev" />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name="star" size={22} />
          </span>
          <h2>还没有收藏题目</h2>
          <p>答题时点题卡右上角的星标，题目就会出现在这里。</p>
          <button className="btn" onClick={startUnanswered}>
            去练习
          </button>
        </div>
      )}

      <dialog
        ref={dlgRef}
        className="fav-dialog"
        tabIndex={-1}
        aria-labelledby="fav-detail-title"
        onClose={() => setDetail(null)}
        onMouseDown={(e) => {
          if (e.target === dlgRef.current) closeDetail();
        }}
      >
        {detail && (
          <>
            <div className="dialog-head">
              <div>
                <h2 id="fav-detail-title">题目详情</h2>
                <p className="fav-dialog-meta">
                  第{String(detail.c).padStart(2, '0')}章 {chapterTitle(data, detail.c)} · 原题{' '}
                  {detail.n}
                </p>
              </div>
              <button className="icon-btn" onClick={closeDetail} aria-label="关闭">
                <Icon name="x" size={17} />
              </button>
            </div>

            <div className="fav-dialog-body">
              <h3 className="fav-stem-full">{detail.s}</h3>
              <div className="options">
                {detail.o.map((text, i) => (
                  <div className={`option done${i === detail.a ? ' correct' : ''}`} key={i}>
                    <span className="letter">{LETTERS[i]}</span>
                    <span className="text">{text}</span>
                    {i === detail.a && (
                      <span className="mark">
                        <Icon name="check" size={13} />
                        正确答案
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="fav-explain">
                <span className="label">解析</span>
                <p>{detail.e || '（本题原书无解析）'}</p>
              </div>
              <QuestionNotes question={detail} />
            </div>

            <div className="dialog-foot">
              <button className="text-btn danger" onClick={removeDetail}>
                <Icon name="star" size={14} fill="currentColor" />
                取消收藏
              </button>
              <button className="btn primary sm" onClick={closeDetail}>
                关闭
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

function formatDate(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}