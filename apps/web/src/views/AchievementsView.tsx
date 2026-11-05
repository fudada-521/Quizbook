import { useState } from 'react';
import {
  achievementProgress,
  SERIES_LABEL,
  TIER_LABEL,
  type AchievementCategory,
  type AchievementStatus,
} from '@megrez/core';
import { useQuiz } from '../store/QuizStore';
import { Icon } from '../components/Icon';

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  progress: '进度',
  habit: '习惯',
  collection: '收藏与心得',
  challenge: '挑战',
  accuracy: '准确率',
  hidden: '隐藏成就',
};

const CATEGORY_ICON: Record<
  AchievementCategory,
  'compass' | 'flame' | 'star' | 'target' | 'check' | 'lock'
> = {
  progress: 'compass',
  habit: 'flame',
  collection: 'star',
  challenge: 'target',
  accuracy: 'check',
  hidden: 'lock',
};

const CATEGORY_ORDER: AchievementCategory[] = [
  'progress',
  'habit',
  'collection',
  'challenge',
  'accuracy',
  'hidden',
];

interface SeriesGroup {
  key: string;
  label: string | null;
  items: AchievementStatus[];
}

/** 同一系列的成就归为一组；无系列的成就单独成组 */
function groupBySeries(items: AchievementStatus[]): SeriesGroup[] {
  const groups: SeriesGroup[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    if (!item.series) {
      groups.push({ key: `single:${item.id}`, label: null, items: [item] });
      continue;
    }
    const existing = index.get(item.series);
    if (existing === undefined) {
      index.set(item.series, groups.length);
      groups.push({
        key: item.series,
        label: SERIES_LABEL[item.series] ?? item.series,
        items: [item],
      });
    } else {
      groups[existing].items.push(item);
    }
  }
  return groups;
}

function AchievementCard({ item }: { item: AchievementStatus }) {
  const secret = Boolean(item.hidden && !item.unlocked);
  const current = Math.min(item.current, item.target);
  const pct = item.target ? Math.min(100, (current / item.target) * 100) : 100;

  return (
    <div className={`achievement-card${item.unlocked ? ' unlocked' : ''}${secret ? ' secret' : ''}`}>
      {secret && (
        <span className="achievement-icon">
          <Icon name="lock" size={18} />
        </span>
      )}
      <span className="achievement-main">
        <span className="achievement-title">
          <strong>{secret ? '？？？' : item.title}</strong>
          {!secret && item.tier && (
            <span className={`achievement-tier tier-${item.tier}`}>{TIER_LABEL[item.tier]}</span>
          )}
          {item.unlocked && <span className="achievement-tag">已解锁</span>}
        </span>
        <span className="achievement-desc">
          {secret ? item.hint ?? '达成隐藏条件后揭晓' : item.description}
        </span>
        {!secret && current > 0 && (
          <span className="progress thin">
            <i style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
        )}
      </span>
      <span className="achievement-value">
        {secret
          ? '？？？'
          : item.unlockedAt
            ? new Date(item.unlockedAt).toLocaleDateString('zh-CN')
            : `${current} / ${item.target}${item.unit ?? ''}`}
      </span>
    </div>
  );
}

export function AchievementsView() {
  const { data, state } = useQuiz();
  const list = achievementProgress(state, data);
  const unlocked = list.filter((item) => item.unlocked).length;

  const categories = CATEGORY_ORDER.map((category) => ({
    category,
    items: list.filter((item) => item.category === category),
  })).filter((entry) => entry.items.length > 0);

  const [active, setActive] = useState<AchievementCategory>(categories[0]?.category ?? 'progress');
  const activeItems =
    categories.find((entry) => entry.category === active)?.items ?? categories[0]?.items ?? [];

  return (
    <div className="view-page">
      <header className="view-head">
        <div className="view-head-copy">
          <h1>成就</h1>
          <p className="page-sub">
            已解锁 {unlocked} / {list.length}。持续练习，把徽章一个个点亮。
          </p>
          <div className="progress achievement-overall">
            <i style={{ transform: `scaleX(${unlocked / list.length})` }} />
          </div>
        </div>
      </header>

      <div className="side-layout">
        <nav className="side-nav" aria-label="成就分类">
          {categories.map(({ category, items }) => {
            const categoryUnlocked = items.filter((item) => item.unlocked).length;
            return (
              <button
                key={category}
                className={`side-nav-item${active === category ? ' active' : ''}`}
                onClick={() => setActive(category)}
                aria-current={active === category ? 'page' : undefined}
              >
                <Icon name={CATEGORY_ICON[category]} size={17} />
                <span className="side-nav-copy">
                  <strong>{CATEGORY_LABEL[category]}</strong>
                  <small>
                    {categoryUnlocked} / {items.length} 已解锁
                  </small>
                </span>
                <Icon name="chevron-right" size={14} className="chev" />
              </button>
            );
          })}
        </nav>

        <section
          className="panel achievement-panel side-content"
          role="region"
          key={active}
          aria-label={CATEGORY_LABEL[active]}
        >
        <div className="achievement-list">
            {groupBySeries(activeItems).map((group) => {
              const groupUnlocked = group.items.filter((item) => item.unlocked).length;
              return (
                <div className="achievement-series" key={group.key}>
                  {group.label && (
                    <div className="achievement-series-head">
                      <span>{group.label}</span>
                      <span>
                        {groupUnlocked} / {group.items.length}
                      </span>
                    </div>
                  )}
                  {group.items.map((item) => (
                    <AchievementCard item={item} key={item.id} />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}