import type { Settings } from '@quiz/core';

export type AnswerFeedback = 'ok' | 'bad';

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (audio) return audio;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  audio = new Ctor();
  return audio;
}

/** 用振荡器合成一个带包络的短音，不引入任何音频资源，单文件产物依旧离线可用 */
function tone(
  ctx: AudioContext,
  opts: { freq: number; at: number; dur: number; gain: number; type?: OscillatorType },
): void {
  const { freq, at, dur, gain, type = 'sine' } = opts;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** 答对：两声上行；答错：两声下行 */
export function playAnswerSound(kind: AnswerFeedback): void {
  const ctx = audioContext();
  if (!ctx) return;
  // 浏览器可能在用户手势之外挂起上下文，判分发生在点击/键盘事件里，可以安全恢复
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime + 0.01;
  if (kind === 'ok') {
    tone(ctx, { freq: 660, at: t, dur: 0.13, gain: 0.06 });
    tone(ctx, { freq: 990, at: t + 0.09, dur: 0.18, gain: 0.05 });
  } else {
    tone(ctx, { freq: 220, at: t, dur: 0.16, gain: 0.07, type: 'triangle' });
    tone(ctx, { freq: 165, at: t + 0.1, dur: 0.22, gain: 0.055, type: 'triangle' });
  }
}

type HapticsModule = typeof import('@capacitor/haptics');
let hapticsModule: Promise<HapticsModule | null> | null = null;

/** 按需加载原生触觉插件；Web 端插件自带的实现会退化为 navigator.vibrate */
function loadHaptics(): Promise<HapticsModule | null> {
  hapticsModule ??= import('@capacitor/haptics').catch(() => null);
  return hapticsModule;
}

/** 答错时的一次错误震动；不支持触觉的平台静默忽略 */
export function hapticWrong(): void {
  void loadHaptics().then((mod) => {
    if (!mod) return;
    void mod.Haptics.notification({ type: mod.NotificationType.Error }).catch(() => {});
  });
}

/** 判分后的统一反馈入口，按设置开关决定是否发声 / 震动 */
export function emitAnswerFeedback(kind: AnswerFeedback, settings: Settings): void {
  if (settings.sound === 1) playAnswerSound(kind);
  if (kind === 'bad' && settings.haptics === 1) hapticWrong();
}