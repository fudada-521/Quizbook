import type { ReactNode } from 'react';
import type { SessionItem } from '@megrez/core';
import { AnswerOptions } from './AnswerParts';

export interface QuestionCardProps {
  item: SessionItem;
  /** 题头信息：章节、原题号 */
  meta: ReactNode;
  /** 题头右侧操作，通常是收藏星标 */
  action?: ReactNode;
  /** 传入则可作答；只读回看不传 */
  onPick?: (dispIdx: number) => void;
  showPicked?: boolean;
  /** 选项下方、解析上方的附加内容，如「确认答案」 */
  beforeReveal?: ReactNode;
  /** 解析区 */
  reveal?: ReactNode;
  /** 卡片底部提示 */
  footer?: ReactNode;
  /** 弹窗内用 h3，独立页面用 h2 */
  headingLevel?: 'h2' | 'h3';
}

/**
 * 题目主体：题头、题干、选项与解析的统一排版。
 * 答题页与收藏详情的题目展示都走这里，避免两边各写一套。
 */
export function QuestionCard({
  item,
  meta,
  action,
  onPick,
  showPicked,
  beforeReveal,
  reveal,
  footer,
  headingLevel = 'h2',
}: QuestionCardProps) {
  const Heading = headingLevel;
  return (
    <>
      <div className="q-head">
        <p className="q-meta">{meta}</p>
        {action}
      </div>
      <Heading className="stem">{item.q.s}</Heading>
      <AnswerOptions item={item} onPick={onPick} showPicked={showPicked} />
      {beforeReveal}
      {reveal}
      {footer}
    </>
  );
}