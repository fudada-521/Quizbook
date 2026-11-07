/**
 * 题库文件校验 —— 见 docs/后端与收费设计.md 第五节。
 *
 * 后台导入、命令行导入、内置题库自检都调用这一个实现，服务端不另写一套。
 * 分工：
 *   - `errors`   结构性问题，必须修好才能入库（ID 非法、ID 重复、没有题目）
 *   - `warnings` 单题问题，该题会被剔除，其余题目照常入库
 *   - `removed`  被剔除的题数
 *   - `bank`     按规范补齐元数据与题目 ID 后的题库；`ok` 为 false 时是 null
 */
import { normalizeQuizData, type Question, type QuizData, type RawQuestion, type RawQuizData } from './types';

export interface BankValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** 被剔除的题数 */
  removed: number;
  /** 校验通过后的题库（已补齐元数据与题目 ID）；不通过时为 null */
  bank: QuizData | null;
}

export const BANK_FILE_SCHEMA = 1;
export const BANK_ID_PATTERN = /^[a-z0-9-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验一份题库 JSON。
 * 传入的应当是解析后的原始对象（题目 ID 可缺省，缺省时按 `${c}-${n}` 补全再判重）。
 */
export function validateBank(input: unknown): BankValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let removed = 0;

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: ['题库必须是一个 JSON 对象'],
      warnings,
      removed,
      bank: null,
    };
  }

  // ---------- 题库级：任一不满足都直接拒绝 ----------
  if (input.schema !== BANK_FILE_SCHEMA) {
    errors.push(`schema 必须为 ${BANK_FILE_SCHEMA}，实际为 ${String(input.schema ?? '（缺失）')}`);
  }

  const id = input.id;
  if (typeof id !== 'string' || !id) {
    errors.push('缺少题库 id');
  } else if (!BANK_ID_PATTERN.test(id)) {
    errors.push(`题库 id 只能包含小写字母、数字与连字符：${id}`);
  }

  if (typeof input.name !== 'string' || !input.name.trim()) {
    errors.push('缺少题库 name');
  }

  const version = input.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    errors.push('version 必须是大于等于 1 的整数');
  }

  const chapters = input.chapters;
  if (!isPlainObject(chapters) || Object.keys(chapters).length === 0) {
    errors.push('chapters 必须是非空对象');
  }

  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    errors.push('questions 不能为空');
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, removed, bank: null };
  }

  // ---------- 题目级：有问题的题剔除，其余照常入库 ----------
  const chapterTitles = chapters as Record<string, string>;
  for (const [key, title] of Object.entries(chapterTitles)) {
    if (typeof title !== 'string' || !title.trim()) {
      warnings.push(`章节 ${key} 的标题为空，请补全`);
    }
  }

  const seen = new Set<string>();
  const kept: Question[] = [];

  (questions as unknown[]).forEach((value, index) => {
    const where = `第 ${index + 1} 题`;
    if (!isPlainObject(value)) {
      removed += 1;
      warnings.push(`${where}：不是对象，已剔除`);
      return;
    }
    const q = value as unknown as RawQuestion;

    if (!Number.isInteger(q.c) || !Number.isInteger(q.n)) {
      removed += 1;
      warnings.push(`${where}：c / n 必须是整数，已剔除`);
      return;
    }

    const questionKey = typeof q.id === 'string' && q.id ? q.id : `${q.c}-${q.n}`;

    if (seen.has(questionKey)) {
      // 题目 ID 是进度键，重复会让两份记录写到同一个键上，必须人工处理
      errors.push(`题目 id 重复：${questionKey}`);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(chapterTitles, String(q.c))) {
      removed += 1;
      warnings.push(`${where}（${questionKey}）：章节 ${q.c} 在 chapters 中不存在，已剔除`);
      return;
    }

    if (typeof q.s !== 'string' || !q.s.trim()) {
      removed += 1;
      warnings.push(`${where}（${questionKey}）：题干为空，已剔除`);
      return;
    }

    if (
      !Array.isArray(q.o) ||
      q.o.length !== 4 ||
      q.o.some((option) => typeof option !== 'string' || !option.trim())
    ) {
      removed += 1;
      warnings.push(`${where}（${questionKey}）：o 必须是 4 个非空字符串，已剔除`);
      return;
    }

    if (!Number.isInteger(q.a) || q.a < 0 || q.a >= q.o.length) {
      removed += 1;
      warnings.push(`${where}（${questionKey}）：答案下标 a 越界，已剔除`);
      return;
    }

    seen.add(questionKey);
    kept.push({ ...q, id: questionKey } as Question);
  });

  if (kept.length === 0 && errors.length === 0) {
    errors.push('没有任何可用的题目');
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, removed, bank: null };
  }

  const bank = normalizeQuizData(
    {
      ...(input as unknown as RawQuizData),
      questions: kept,
    },
    { id: id as string, name: (input.name as string).trim(), version: version as number },
  );

  return { ok: true, errors, warnings, removed, bank };
}