import type { Settings } from '@quiz/core';

export type AnswerFeedback = 'ok' | 'bad';

let audio: AudioContext | null = null;
let master: GainNode | null = null;

function audioContext(): AudioContext | null {
  if (audio) return audio;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    audio = new Ctor();
  } catch {
    return null;
  }
  // 主输出串一级轻压缩：音量提上来后不会削波，短促的音头也更有力度
  const comp = audio.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const gain = audio.createGain();
  gain.gain.value = 1.6;
  gain.connect(comp).connect(audio.destination);
  master = gain;
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
  osc.connect(amp).connect(master ?? ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function scheduleAnswerSound(ctx: AudioContext, kind: AnswerFeedback): void {
  const t = ctx.currentTime + 0.01;
  if (kind === 'ok') {
    tone(ctx, { freq: 660, at: t, dur: 0.14, gain: 0.16 });
    tone(ctx, { freq: 990, at: t + 0.09, dur: 0.2, gain: 0.13 });
    tone(ctx, { freq: 1320, at: t + 0.16, dur: 0.16, gain: 0.06, type: 'sine' });
  } else {
    tone(ctx, { freq: 220, at: t, dur: 0.18, gain: 0.18, type: 'triangle' });
    tone(ctx, { freq: 165, at: t + 0.1, dur: 0.24, gain: 0.14, type: 'triangle' });
  }
}

/** 答对：上行三音；答错：下行两音 */
export function playAnswerSound(kind: AnswerFeedback): void {
  const ctx = audioContext();
  if (!ctx) return;
  // 浏览器可能在用户手势之外挂起上下文；恢复成功后再调度，避免音被静默丢弃
  if (ctx.state === 'running') {
    scheduleAnswerSound(ctx, kind);
    return;
  }
  void ctx
    .resume()
    .then(() => {
      if (ctx.state === 'running') scheduleAnswerSound(ctx, kind);
    })
    .catch(() => {});
}

/**
 * iOS 要求音频上下文在用户手势的同步调用栈内恢复，否则后续播放可能一直无声。
 * 在首个 pointerdown / keydown / touchstart 中同步唤醒，并播一个 0 振幅预热音。
 */
function unlockAudio(): void {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const silent = ctx.createGain();
  silent.gain.value = 0.0001;
  const osc = ctx.createOscillator();
  osc.connect(silent).connect(master ?? ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.01);
}

if (typeof document !== 'undefined') {
  const opts = { capture: true, passive: true } as const;
  const onFirstGesture = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', onFirstGesture, opts);
    document.removeEventListener('touchstart', onFirstGesture, opts);
    document.removeEventListener('keydown', onFirstGesture, opts);
  };
  document.addEventListener('pointerdown', onFirstGesture, opts);
  document.addEventListener('touchstart', onFirstGesture, opts);
  document.addEventListener('keydown', onFirstGesture, opts);
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