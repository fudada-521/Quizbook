/**
 * 服务端题库：同步后校验成就需要知道每章有哪些题。
 * 题库仍是构建期资源，server 只读取仓库里的 data/questions.json；
 * 读不到时成就校验跳过，不影响同步本身。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QuizData } from '@megrez/core';

function loadQuestions(): QuizData | null {
  const candidates = [
    process.env.QUESTIONS_PATH,
    // cwd = apps/server
    resolve(process.cwd(), '../../data/questions.json'),
    resolve(process.cwd(), '../data/questions.json'),
  ].filter((path): path is string => Boolean(path));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as QuizData;
      if (Array.isArray(data.questions) && data.chapters) return data;
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return null;
}

export const quizData = loadQuestions();