import { achievementProgress, type AchievementCategory } from '@quiz/core';
import { useQuiz } from '../store/QuizStore';
import { Icon } from '../components/Icon';

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  progress: '进度',
  habit: '习惯',
  collection: '收藏与心得',
  challenge: '挑战',
};

const CATEGORY_ICON: Record<AchievementCategory, 'compass' | 'flame' | 'star' | 'target'> = {
  progress: 'compass',
  habit: 'flame',
  collection: 'star',
  challenge: 'target',
};

const CATEGORY_ORDER: AchievementCategory[] = ['progress', 'habit', 'collection', 'challenge'];

export function AchievementsView() {
  const { data, state, setView } = useQuiz();
  const list = achievementProgress(state, data);
  const unlocked = list.filter((item) => item.unlocked).length;

  return (
    <div className="achievements-page">
      <button className="btn ghost sm back-btn" onClick={() => setView('home')}>
        <Icon name="arrow-left" size={16} />
        返回首页
      </button>

      <header className="page-head">
        <p className="eyebrow">成就</p>
        <h1>
          已解锁 {unlocked} / {list.length}
        </h1>
        <p className="page-sub">持续练习，把徽章一个个点亮。</p>
        <div className="progress achievement-overall">
          <i style={{ width: `${(unlocked / list.length) * 100}%` }} />
        </div>
      </header>

      <div className="achievement-groups">
        {CATEGORY_ORDER.map((category) => {
          const items = list.filter((item) => item.category === category);
          if (!items.length) return null;
          return (
            <section className="panel" key={category}>
              <div className="panel-head">
                <h2>
                  <Icon name={CATEGORY_ICON[category]} size={16} />
                  {CATEGORY_LABEL[category]}
                </h2>
                <span>
                  {items.filter((item) => item.unlocked).length} / {items.length}
                </span>
              </div>

              <div className="achievement-list">
                {items.map((item) => {
                  const current = Math.min(item.current, item.target);
                  const pct = item.target ? Math.min(100, (current / item.target) * 100) : 100;
                  return (
                    <div
                      className={`achievement-card${item.unlocked ? ' unlocked' : ''}`}
                      key={item.id}
                    >
                      <span className="achievement-icon">
                        <Icon name={CATEGORY_ICON[category]} size={18} />
                      </span>
                      <span className="achievement-main">
                        <span className="achievement-title">
                          <strong>{item.title}</strong>
                          {item.unlocked && <span className="achievement-tag">已解锁</span>}
                        </span>
                        <span className="achievement-desc">{item.description}</span>
                        <span className="progress thin">
                          <i style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                      <span className="achievement-value">
                        {item.unlockedAt
                          ? new Date(item.unlockedAt).toLocaleDateString('zh-CN')
                          : `${current} / ${item.target}${item.unit ?? ''}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}