import { useEffect, useRef } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

interface StartPoint {
  x: number;
  y: number;
  id: number;
}

/** 手势中禁止误触的区域 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, dialog[open], .celebrate-layer'))
  );
}

interface TouchPoint {
  clientX: number;
  clientY: number;
  identifier: number;
}

function firstTouch(e: TouchEvent | ReactTouchEvent): TouchPoint | null {
  const touches = e.touches.length === 1 ? e.touches[0] : null;
  return touches ? { clientX: touches.clientX, clientY: touches.clientY, identifier: touches.identifier } : null;
}

/**
 * 左缘右滑返回（仅触屏）。
 * 用 touch 事件而非 pointer：移动端浏览器在判定滚动时会派发 pointercancel。
 * 只从左边缘 40px 内起手，避免与页面内横向滚动、文本选择冲突。
 */
export function useEdgeSwipeBack(enabled: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    let start: StartPoint | null = null;

    const down = (e: TouchEvent) => {
      const t = firstTouch(e);
      if (!t || t.clientX > 40) {
        start = null;
        return;
      }
      start = { x: t.clientX, y: t.clientY, id: t.identifier };
    };
    const up = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      const t = Array.from(e.changedTouches).find((item) => item.identifier === s.id);
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (dx > 70 && Math.abs(dy) < 60 && dx > Math.abs(dy) * 1.3) onBack();
    };
    const cancel = () => {
      start = null;
    };

    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [enabled, onBack]);
}

/**
 * 横向滑动：向左滑触发 onLeft，向右滑触发 onRight。
 * 返回可直接展开到元素上的 touch 事件处理器。
 */
export function useHorizontalSwipe({
  enabled = true,
  onLeft,
  onRight,
}: {
  enabled?: boolean;
  onLeft: () => void;
  onRight: () => void;
}) {
  const startRef = useRef<StartPoint | null>(null);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (!enabled || isInteractiveTarget(e.target)) return;
    const t = firstTouch(e);
    startRef.current = t ? { x: t.clientX, y: t.clientY, id: t.identifier } : null;
  };
  const finish = (e: ReactTouchEvent) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const t = Array.from(e.changedTouches).find((item) => item.identifier === start.id);
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 横向位移要足够大且明显大于纵向，避免和上下滚动、轻点冲突
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (document.querySelector('dialog[open], .celebrate-layer')) return;
    if (dx < 0) onLeft();
    else onRight();
  };

  return {
    onTouchStart,
    onTouchEnd: finish,
    onTouchCancel: () => {
      startRef.current = null;
    },
  };
}

/**
 * 弹窗下滑关闭（仅触屏）：内容在顶部时，从头部 96px 内向下拖动超过 80px 触发。
 */
export function useSwipeDownToClose(
  element: HTMLElement | null,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!element) return;
    let start: StartPoint | null = null;

    const down = (e: TouchEvent) => {
      const t = firstTouch(e);
      if (!t) {
        start = null;
        return;
      }
      if (element.scrollTop > 0) return;
      const rect = element.getBoundingClientRect();
      if (t.clientY - rect.top > 96) return;
      start = { x: t.clientX, y: t.clientY, id: t.identifier };
    };
    const up = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      const t = Array.from(e.changedTouches).find((item) => item.identifier === s.id);
      if (!t) return;
      const dy = t.clientY - s.y;
      const dx = Math.abs(t.clientX - s.x);
      if (dy > 80 && dy > dx * 1.4) onClose();
    };
    const cancel = () => {
      start = null;
    };

    element.addEventListener('touchstart', down, { passive: true });
    element.addEventListener('touchend', up, { passive: true });
    element.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      element.removeEventListener('touchstart', down);
      element.removeEventListener('touchend', up);
      element.removeEventListener('touchcancel', cancel);
    };
  }, [element, onClose]);
}