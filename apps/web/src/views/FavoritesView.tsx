import { useState } from 'react';
import {
  chapterTitle,
  favoriteQuestions,
  qkey,
  type Question,
  type SessionItem,
} from '@megrez/core';
import { useQuiz } from '../store/QuizStore';
import { emitFavoriteFeedback } from '../feedback';
import { Icon } from '../components/Icon';
import { SideNav } from '../components/SideNav';
import { QuestionNotes } from '../components/QuestionNotes';
import { RevealCard } from '../components/AnswerParts';
import { QuestionCard } from '../components/QuestionCard';

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
  const {
    data,
    state,
    settings,
    app,
    savedSessions,
    setView,
    startFavorites,
    startUnanswered,
    toggleFavorite,
  } = useQuiz();
  const favorites = favoriteQuestions(data, state);
  const [detail, setDetail] = useState<Question | null>(null);
  const [scope, setScope] = useState<Scope>('all');

  const chapters = groupByChapter(favorites);
  // 取消收藏可能让当前章节清空，此时自动回到「全部收藏」
  const active: Scope =
    scope === 'all' || chapters.some((entry) => entry.c === scope) ? scope : 'all';
  const visible =
    active === 'all' ? favorites : (chapters.find((entry) => entry.c === active)?.items ?? []);

  const openDetail = (q: Question) => {
    setDetail(q);
    setView('favorite-detail');
  };

  const closeDetail = () => setView('favorites');

  const removeDetail = () => {
    if (!detail) return;
    toggleFavorite(detail);
    emitFavoriteFeedback(false, settings);
    setDetail(null);
    setView('favorites');
  };

  // 只读会话项：数据已判分、无选中记录，交给答题页组件按「正确答案」渲染
  const readonlyItem: SessionItem | null = detail
    ? { q: detail, map: READONLY_MAP, done: true, pick: null, lastPick: -1 }
    : null;

  const scopeLabel =
    active === 'all'
      ? '全部收藏'
      : `第${String(active).padStart(2, '0')}章 ${chapterTitle(data, active)}`;

  // 该范围是否有未完成的收藏练习；有则可选择重新开始而不是续做
  const favoriteOrigin = active === 'all' ? 'favorites' : `favorites:${active}`;
  const hasSaved = savedSessions.some((s) => s.origin === favoriteOrigin);
  const scopeArg = active === 'all' ? undefined : active;

  // 收藏详情与答题页同一套结构：吸顶返回栏 + 题卡 + 心得，不再用弹窗
  if (app.view === 'favorite-detail' && detail && readonlyItem) {
    return (
      <div className="quiz-page fav-detail-page">
        <div className="quiz-bar">
          <div className="quiz-bar-row">
            <button className="btn ghost sm" onClick={closeDetail}>
              <Icon name="arrow-left" size={16} />
              返回
            </button>
            <div className="quiz-title">
              <h1 className="quiz-title-name">题目详情</h1>
              <span className="count">收藏</span>
            </div>
            <span className="fav-detail-spacer" aria-hidden="true" />
          </div>
        </div>

        <article className="question-card">
          <QuestionCard
            item={readonlyItem}
            meta={`第${String(detail.c).padStart(2, '0')}章 ${chapterTitle(data, detail.c)}，原题 ${detail.n}`}
            action={
              <button
                className="fav-btn active"
                onClick={removeDetail}
                aria-pressed={true}
                aria-label="取消收藏"
                title="取消收藏"
              >
                <Icon name="star" size={17} />
              </button>
            }
            reveal={<RevealCard item={readonlyItem} ok reference />}
          />
        </article>

        <QuestionNotes className="notes-card" question={detail} />
      </div>
    );
  }

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
          <div className="view-head-actions">
            {hasSaved && (
              <button className="btn ghost" onClick={() => startFavorites(scopeArg, true)}>
                <Icon name="rotate" size={16} />
                重新开始
              </button>
            )}
            <button className="btn primary" onClick={() => startFavorites(scopeArg)}>
              {active === 'all'
                ? hasSaved
                  ? '继续收藏练习'
                  : '开始收藏练习'
                : hasSaved
                  ? `继续练习本章 ${visible.length} 道`
                  : `练习本章 ${visible.length} 道`}
              <Icon name="arrow-right" size={16} />
            </button>
          </div>
        )}
      </header>

      {favorites.length > 0 ? (
        <div className="side-layout">
          <SideNav<Scope>
            ariaLabel="收藏章节目录"
            pickerLabel="选择收藏范围"
            mobile="picker"
            items={[
              { id: 'all', label: '全部收藏', hint: `${favorites.length} 道`, icon: 'star' },
              ...chapters.map(({ c, items }) => ({
                id: c,
                label: chapterTitle(data, c),
                hint: `第${String(c).padStart(2, '0')}章，${items.length} 道`,
                icon: 'book' as const,
              })),
            ]}
            active={active}
            onChange={setScope}
          />

          <div
            className="fav-list side-content"
            key={String(active)}
            role="region"
            aria-label={scopeLabel}
          >
            {visible.map((q) => (
              <button className="fav-row" key={qkey(q)} onClick={() => openDetail(q)}>
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

      </div>
  );
}

function formatDate(ts: number | undefined): string {
  if (!ts) return '时间未知';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}