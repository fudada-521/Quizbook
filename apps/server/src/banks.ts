/**
 * 题库服务：导入（写草稿）→ 发布（生成不可变版本包）→ 查询。
 *
 * 编辑只碰 `bank_chapters` / `bank_questions`，客户端永远只读 `bank_releases` 里的完整包，
 * 因此编辑到一半的内容不会被用户看到，任意历史版本都可回滚、可下载。
 * 校验统一走 `@megrez/core` 的 validateBank()，服务端不另写一套。
 */
import { BUILTIN_BANK_ID, validateBank, type Question, type QuizData } from '@megrez/core';
import { db, transaction } from './db';

export type BankStatus = 'draft' | 'published' | 'archived';

export interface BankMeta {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  status: BankStatus;
  /** 最近一次发布的版本号，0 表示从未发布 */
  currentVersion: number;
  questionCount: number;
  chapterCount: number;
  createdAt: number;
  updatedAt: number;
}

interface BankRow {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  status: string;
  current_version: number;
  question_count: number;
  chapter_count: number;
  created_at: number;
  updated_at: number;
}

function toMeta(row: BankRow): BankMeta {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    status: row.status as BankStatus,
    currentVersion: row.current_version,
    questionCount: row.question_count,
    chapterCount: row.chapter_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 读 ----------

export function getBankMeta(bankId: string): BankMeta | null {
  const row = db.prepare('SELECT * FROM banks WHERE id = ?').get(bankId) as BankRow | undefined;
  return row ? toMeta(row) : null;
}

/** 已发布题库（当前版本号 > 0）的元数据，全员可见 */
export function listPublishedBanks(): BankMeta[] {
  const rows = db
    .prepare("SELECT * FROM banks WHERE current_version > 0 AND status != 'archived' ORDER BY updated_at DESC")
    .all() as unknown as BankRow[];
  return rows.map(toMeta);
}

export interface BankBundle extends Omit<QuizData, 'questions'> {
  questions: Array<Question & { src?: string }>;
}

/** 读取某个已发布版本；version 缺省时取当前版本 */
export function getPublishedBank(
  bankId: string,
  version?: number,
): { version: number; publishedAt: number; bundle: BankBundle } | null {
  const row = version
    ? (db
        .prepare('SELECT version, bundle, published_at FROM bank_releases WHERE bank_id = ? AND version = ?')
        .get(bankId, version) as { version: number; bundle: string; published_at: number } | undefined)
    : (db
        .prepare(
          'SELECT version, bundle, published_at FROM bank_releases WHERE bank_id = ? ORDER BY version DESC LIMIT 1',
        )
        .get(bankId) as { version: number; bundle: string; published_at: number } | undefined);

  if (!row) return null;
  return { version: row.version, publishedAt: row.published_at, bundle: JSON.parse(row.bundle) as BankBundle };
}

/** 草稿态题目（后台编辑用），按章节与题号排序 */
export function readBankQuestions(bankId: string): BankBundle['questions'] {
  const rows = db
    .prepare(
      'SELECT id, c, n, stem, options, answer, explanation, source_tag FROM bank_questions WHERE bank_id = ? ORDER BY c, n',
    )
    .all(bankId) as Array<{
    id: string;
    c: number;
    n: number;
    stem: string;
    options: string;
    answer: number;
    explanation: string;
    source_tag: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    c: row.c,
    n: row.n,
    s: row.stem,
    o: JSON.parse(row.options) as [string, string, string, string],
    a: row.answer,
    e: row.explanation,
    ...(row.source_tag ? { src: row.source_tag } : {}),
  }));
}

// ---------- 写 ----------

function replaceBankContent(bankId: string, data: QuizData): void {
  const now = Date.now();

  db.prepare('DELETE FROM bank_chapters WHERE bank_id = ?').run(bankId);
  db.prepare('DELETE FROM bank_questions WHERE bank_id = ?').run(bankId);

  const insertChapter = db.prepare(
    'INSERT INTO bank_chapters (bank_id, c, title, sort) VALUES (?, ?, ?, ?)',
  );
  let sort = 0;
  for (const [key, title] of Object.entries(data.chapters)) {
    insertChapter.run(bankId, Number(key), title, sort);
    sort += 1;
  }

  const insertQuestion = db.prepare(
    `INSERT INTO bank_questions (id, bank_id, c, n, stem, options, answer, explanation, source_tag, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const question of data.questions) {
    const src = (question as Question & { src?: string }).src ?? '';
    insertQuestion.run(
      question.id,
      bankId,
      question.c,
      question.n,
      question.s,
      JSON.stringify(question.o),
      question.a,
      question.e ?? '',
      src,
      now,
    );
  }

  db.prepare(
    `UPDATE banks
        SET name = ?, subtitle = ?, question_count = ?, chapter_count = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    data.name,
    data.subtitle ?? '',
    data.questions.length,
    Object.keys(data.chapters).length,
    now,
    bankId,
  );
}

export interface ImportOutcome {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** 被剔除的题数 */
  removed: number;
  bank: BankMeta | null;
}

/**
 * 导入一份题库 JSON（解析后的对象）。
 * 校验不通过时整体拒绝；通过则写成草稿，不自动发布。
 * 已存在同 id 的题库时覆盖其草稿内容，已发布的历史版本保持不变。
 */
export function importBank(input: unknown, operatorId: string | null): ImportOutcome {
  const validation = validateBank(input);
  if (!validation.ok || !validation.bank) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      removed: validation.removed,
      bank: null,
    };
  }

  const data = validation.bank;
  const now = Date.now();

  transaction(() => {
    db.prepare(
      `INSERT INTO banks (id, name, subtitle, description, status, current_version, question_count, chapter_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, '', 'draft', 0, 0, 0, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         subtitle = excluded.subtitle,
         updated_at = excluded.updated_at`,
    ).run(data.id, data.name, data.subtitle ?? '', operatorId, now, now);

    replaceBankContent(data.id, data);
  });

  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    removed: validation.removed,
    bank: getBankMeta(data.id),
  };
}

export interface PublishResult {
  version: number;
  publishedAt: number;
  bundle: BankBundle;
}

/**
 * 把当前草稿发布为一个不可变版本：序列化完整包写入 bank_releases，current_version + 1。
 * 从未发布的题库得到 v1；重复发布得到 v2、v3……
 */
export function publishBank(bankId: string, note = '', operatorId: string | null = null): PublishResult {
  const meta = getBankMeta(bankId);
  if (!meta) throw new Error(`题库不存在：${bankId}`);
  if (meta.questionCount === 0) throw new Error('题库没有题目，不能发布');

  const chapters = db
    .prepare('SELECT c, title FROM bank_chapters WHERE bank_id = ? ORDER BY sort, c')
    .all(bankId) as Array<{ c: number; title: string }>;
  const questions = readBankQuestions(bankId);

  const nextVersion = meta.currentVersion + 1;
  const now = Date.now();
  const bundle: BankBundle = {
    schema: 1,
    id: meta.id,
    name: meta.name,
    subtitle: meta.subtitle || undefined,
    version: nextVersion,
    chapters: Object.fromEntries(chapters.map((row) => [String(row.c), row.title])),
    questions,
  };
  const payload = JSON.stringify(bundle);

  transaction(() => {
    db.prepare(
      `INSERT INTO bank_releases (bank_id, version, bundle, note, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(bankId, nextVersion, payload, note, operatorId, now);

    db.prepare("UPDATE banks SET current_version = ?, status = 'published', updated_at = ? WHERE id = ?").run(
      nextVersion,
      now,
      bankId,
    );
  });

  return { version: nextVersion, publishedAt: now, bundle };
}

// ---------- 内置题库 ----------

/**
 * 内置题库幂等 seed：已有题目就跳过，绝不覆盖。
 * 首次启动时把仓库里的 data/questions.json 导入为 builtin 并发布 v1。
 */
export function seedBuiltinBank(builtin: QuizData | null): { seeded: boolean; questionCount: number } {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM bank_questions WHERE bank_id = ?')
    .get(BUILTIN_BANK_ID) as { total: number };

  if (row.total > 0 || !builtin) {
    return { seeded: false, questionCount: row.total };
  }

  transaction(() => {
    replaceBankContent(BUILTIN_BANK_ID, builtin);
    db.prepare("UPDATE banks SET status = 'published', subtitle = ? WHERE id = ?").run(
      builtin.subtitle ?? '',
      BUILTIN_BANK_ID,
    );
  });
  publishBank(BUILTIN_BANK_ID, '内置题库初始导入', null);

  const after = db
    .prepare('SELECT question_count FROM banks WHERE id = ?')
    .get(BUILTIN_BANK_ID) as { question_count: number };
  return { seeded: true, questionCount: after.question_count };
}