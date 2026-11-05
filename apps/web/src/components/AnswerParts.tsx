import type { ReactNode } from 'react';
import type { SessionItem } from '@megrez/core';
import { Icon } from './Icon';

export const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * 选项列表：答题页与收藏详情共用。
 * 传入 onPick 时可选择；不传则为只读回看。
 */
export function AnswerOptions({
  item,
  onPick,
  showPicked = true,
}: {
  item: SessionItem;
  onPick?: (dispIdx: number) => void;
  /** 手动判分模式下才需要高亮「已选未提交」的选项 */
  showPicked?: boolean;
}) {
  return (
    <div className="options">
      {item.map.map((origIdx, dispIdx) => {
        let cls = 'option';
        let mark: { icon: 'check' | 'x'; text: string } | null = null;
        if (item.done) {
          cls += ' done';
          // 解析态：标出正确答案（绿）与自己选错的那项（红），其余淡化
          if (origIdx === item.q.a) {
            cls += ' correct';
            mark = { icon: 'check', text: '正确答案' };
          } else if (dispIdx === item.lastPick) {
            cls += ' wrong';
            mark = { icon: 'x', text: '你的选择' };
          } else {
            cls += ' dim';
          }
        } else if (showPicked && item.pick === dispIdx) {
          cls += ' picked';
        }
        return (
          <div
            key={dispIdx}
            className={cls}
            onClick={item.done || !onPick ? undefined : () => onPick(dispIdx)}
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

/**
 * 解析卡片：答题页与收藏详情共用。
 * reference 为只读回看：头部显示「正确答案 X」，不显示对错结论。
 */
export function RevealCard({
  item,
  ok,
  reference = false,
  right,
  footer,
}: {
  item: SessionItem;
  ok: boolean;
  reference?: boolean;
  right?: ReactNode;
  footer?: ReactNode;
}) {
  const correctDispIdx = item.map.indexOf(item.q.a);
  return (
    <div className={`reveal ${reference || ok ? 'ok' : 'bad'}`}>
      <div className="reveal-head">
        <span className="reveal-status">
          <Icon name={reference || ok ? 'check' : 'x'} size={16} />
          {reference
            ? `正确答案 ${LETTERS[correctDispIdx] ?? ''}`
            : ok
              ? '回答正确'
              : '回答错误'}
        </span>
        {right}
      </div>
      <div className="reveal-body">
        <span className="label">解析</span>
        <p>{item.q.e || '（本题原书无解析）'}</p>
      </div>
      {footer}
    </div>
  );
}