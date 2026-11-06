/**
 * 本机主题偏好：system 跟随系统，light/dark 固定。
 * 只存 localStorage，不进入进度同步，各设备可以不同。
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'megrez_theme_v1';
const THEME_EVENT = 'megrez:theme';

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
  } catch {
    // 隐私模式等场景读不到，退回跟随系统
  }
  return 'system';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

/** 把解析后的主题写到 <html data-theme>，CSS 变量与浏览器控件随之切换 */
export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0f0f0f' : '#ffffff';

  // 水光 canvas 需要知道深浅色，重新绘制一遍
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: resolved }));
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // 存不了也先让当前会话生效
  }
  applyTheme(mode);
}

/** 应用启动时调用一次；system 模式下跟随系统切换 */
export function initTheme(): void {
  applyTheme(loadThemeMode());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (loadThemeMode() === 'system') applyTheme('system');
  });
}

export { THEME_EVENT };