/**
 * 桌面/移动端可用的进度导出导入（零后端"同步"：手动文件同步）。
 * Web 端已有 localStorage + 导出/导入 JSON；此文件提供跨端通用的文件同步辅助。
 */

import { PersistedState } from '@quiz/core';

/** 将进度序列化为可移植的 JSON 字符串（带版本与时间戳元信息） */
export function serializeForSync(state: PersistedState): string {
  return JSON.stringify(
    { ...state, _meta: { exportedAt: new Date().toISOString() } },
    null,
    2,
  );
}

/** 解析同步文件，容错返回 null */
export function parseFromSync(text: string): PersistedState | null {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.answers && typeof obj.answers === 'object') {
      // 剥离 _meta 等扩展字段，仅保留核心结构
      return {
        schemaVersion: obj.schemaVersion ?? 1,
        answers: obj.answers,
        wrong: obj.wrong ?? {},
        settings: obj.settings ?? {},
      };
    }
    return null;
  } catch {
    return null;
  }
}