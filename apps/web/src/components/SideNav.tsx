import { useEffect, useRef } from 'react';
import type { IconName } from './Icon';
import { Icon } from './Icon';

export interface SideNavItem<T extends string | number = string> {
  id: T;
  label: string;
  hint?: string;
  icon: IconName;
}

interface SideNavProps<T extends string | number> {
  ariaLabel: string;
  items: SideNavItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /**
   * 移动端形态：
   * - chips：单行横向滚动的胶囊，适合 4-6 个分类；
   * - picker：收成一个当前范围按钮，点开用系统选择器，适合几十个章节。
   */
  mobile?: 'chips' | 'picker';
  pickerLabel?: string;
}

const MOBILE_QUERY = '(max-width: 720px)';

/**
 * 收藏 / 设置 / 成就共用的分类导航。
 * 桌面端是左侧竖排；移动端按分类数量选择胶囊或选择器。
 */
export function SideNav<T extends string | number>({
  ariaLabel,
  items,
  active,
  onChange,
  mobile = 'chips',
  pickerLabel = '选择分类',
}: SideNavProps<T>) {
  const navRef = useRef<HTMLElement>(null);

  // 胶囊横滚时把当前项滚进可视区，避免进入页面时 active 在屏幕外
  useEffect(() => {
    if (mobile !== 'chips') return;
    if (!window.matchMedia(MOBILE_QUERY).matches) return;
    const el = navRef.current?.querySelector<HTMLElement>('.side-nav-item.active');
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [active, mobile]);

  const select = (id: T) => {
    if (id === active) return;
    onChange(id);
    // 移动端切换分类后回到页面顶部，否则会停在上一段正文中间
    if (window.matchMedia(MOBILE_QUERY).matches) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  };

  return (
    <>
      <nav
        ref={navRef}
        className={`side-nav${mobile === 'picker' ? ' side-nav--picker' : ''}`}
        aria-label={ariaLabel}
      >
        {items.map((item) => (
          <button
            key={item.id}
            className={`side-nav-item${active === item.id ? ' active' : ''}`}
            onClick={() => select(item.id)}
            aria-current={active === item.id ? 'page' : undefined}
            title={item.label}
          >
            <Icon name={item.icon} size={17} />
            <span className="side-nav-copy">
              <strong>{item.label}</strong>
              {item.hint && <small>{item.hint}</small>}
            </span>
            <Icon name="chevron-right" size={14} className="chev" />
          </button>
        ))}
      </nav>

      {mobile === 'picker' && (
        <div className="side-nav-picker">
          <label className="side-nav-picker-label">
            <span className="visually-hidden">{pickerLabel}</span>
            <select
              value={String(active)}
              onChange={(e) => {
                const next = items.find((item) => String(item.id) === e.target.value);
                if (next) select(next.id);
              }}
            >
              {items.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.label}
                  {item.hint ? ` · ${item.hint}` : ''}
                </option>
              ))}
            </select>
            <Icon name="chevron-right" size={15} className="chev" />
          </label>
        </div>
      )}
    </>
  );
}