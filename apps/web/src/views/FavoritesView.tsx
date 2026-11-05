import { useEffect, useRef, useState } from 'react';
import {
  chapterTitle,
  favoriteQuestions,
  qkey,
  type Question,
  type SessionItem,
} from '@quiz/core';
import { useQuiz } from '../store/QuizStore';
import { Icon } from '../components/Icon';
import { QuestionNotes } from '../components/QuestionNotes';
import { AnswerOptions, RevealCard } from '../components/AnswerParts';
import { useSwipeDownToClose } from '../gestures';

/** 收藏详情没有乱序，显示顺序即原始顺序 */
const READONLY_MAP: [number, number, number, number] = [0, 1, 2, 3];

/** 目录的当前范围：全部收藏，或某一章 */
type Scope = 'all' | number;

interface ChapterEntry {
  c: number;
  items: Question[];
}

/** 按章节归档，章节号升序；章内保持收藏时间从新到旧 */
function groupByChapter(list: Question[]): ChapterEntry[] {
  const map = new Map<number, Question[]>();
  for (const q of list) {
    const bucket = map.get(q.c);
    if (bucket) bucket.push(q);
    else map.set(q.c, [q]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, items]) => ({ c, items }));
}

export function FavoritesView() {
  const { data, state, startFavorites, startUnanswered, toggleFavorite } = useQuiz();
  const favorites = favoriteQuestions(data, state);
  const [detail, setDetail] = useState<Question | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const dlgRef = useRef<HTMLDialogElement>(null);

  const chapters = groupByChapter(favorites);
  // 取消收藏可能让当前章节清空，此时自动回到「全部收藏」
  const active: Scope =
    scope === 'all' || chapters.some((entry) => entry.c === scope) ? scope : 'all';
  const visible =
    active === 'all' ? favorites : (chapters.find((entry) => entry.c === active)?.items ?? []);

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

  // 手机上从弹窗头部向下滑动即可关闭
  useSwipeDownToClose(dlgRef.current, closeDetail);

  // 只读会话项：数据已判分、无选中记录，交给答题页组件按「正确答案」渲染
  const readonlyItem: SessionItem | null = detail
    ? { q: detail, map: READONLY_MAP, done: true, pick: null, lastPick: -1 }
    : null;

  const scopeLabel =
    active === 'all'
      ? '全部收藏'
      : `第${String(active).padStart(2, '0')}章 ${chapterTitle(data, active)}`;

  return (
    <div className="view-page">
      <header className="view-head">
        <div className="view-head-copy">
          <h1>收藏的题目</h1>
          <p className="page-sub">
            {favorites.length === 0
              ? '共 0 道'
              : active === 'all'
                ? `共 ${favorites.length} 道，按收藏时间从新到旧`
                : `${scopeLabel}，${visible.length} 道`}
          </p>
        </div>
        {favorites.length > 0 && (
          <button
            className="btn primary"
            onClick={() => startFavorites(active === 'all' ? undefined : active)}
          >
            {active === 'all' ? '开始收藏练习' : `练习本章 ${visible.length} 道`}
            <Icon name="arrow-right" size={16} />
          </button>
        )}
      </header>

      {favorites.length > 0 ? (
        <div className="side-layout">
          <nav className="side-nav" aria-label="收藏章节目录">
            <button
              className={`side-nav-item${active === 'all' ? ' active' : ''}`}
              onClick={() => setScope('all')}
              aria-current={active === 'all' ? 'page' : undefined}
            >
              <Icon name="star" size={17} />
              <span className="side-nav-copy">
                <strong>全部收藏</strong>
                <small>{favorites.length} 道</small>
              </span>
              <Icon name="chevron-right" size={14} className="chev" />
            </button>
            {chapters.map(({ c, items }) => {
              const title = chapterTitle(data, c);
              return (
                <button
                  key={c}
                  className={`side-nav-item${active === c ? ' active' : ''}`}
                  onClick={() => setScope(c)}
                  aria-current={active === c ? 'page' : undefined}
                  title={title}
                >
                  <Icon name="book" size={17} />
                  <span className="side-nav-copy">
                    <strong>{title}</strong>
                    <small>
                      第{String(c).padStart(2, '0')}章，{items.length} 道
                    </small>
                  </span>
                  <Icon name="chevron-right" size={14} className="chev" />
                </button>
              );
            })}
          </nav>

          <div
            className="fav-list side-content"
            key={String(active)}
            role="region"
            aria-label={scopeLabel}
          >
            {visible.map((q) => (
              <button className="fav-row" key={qkey(q)} onClick={() => setDetail(q)}>
                <span className="fav-main">
                  <span className="fav-chapter">
                    第{String(q.c).padStart(2, '0')}章 {chapterTitle(data, q.c)}，原题 {q.n}
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
        </div>
      ) : (
        <div className="empty-state">
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
        {detail && readonlyItem && (
          <>
            <div className="dialog-head">
              <div>
                <h2 id="fav-detail-title">题目详情</h2>
                <p className="fav-dialog-meta">
                  第{String(detail.c).padStart(2, '0')}章 {chapterTitle(data, detail.c)}，原题{' '}
                  {detail.n}
                </p>
              </div>
              <button className="icon-btn" onClick={closeDetail} aria-label="关闭">
                <Icon name="x" size={17} />
              </button>
            </div>

            <div className="fav-dialog-body">
              <h3 className="stem">{detail.s}</h3>
              <AnswerOptions item={readonlyItem} />
              <RevealCard item={readonlyItem} ok reference />
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
  if (!ts) return '时间未知';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}