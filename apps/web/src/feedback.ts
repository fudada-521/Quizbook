import type { Settings } from '@megrez/core';

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

/** 关掉并丢弃当前上下文，下次调用时重建（iOS 的 interrupted 无法 resume） */
function resetAudio(): void {
  const ctx = audio;
  audio = null;
  master = null;
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
}

/** 确保上下文可发声；挂起时尝试恢复，interrupted 或恢复失败则重建 */
function ensureAudio(): AudioContext | null {
  let ctx = audioContext();
  if (!ctx) return null;
  if (ctx.state === 'running') return ctx;
  if ((ctx.state as string) === 'interrupted') {
    resetAudio();
    ctx = audioContext();
    if (!ctx) return null;
  }
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  return ctx;
}

/**
 * 在上下文可用后调度一段音；浏览器可能在用户手势之外挂起上下文，
 * 恢复成功再调度，避免音被静默丢弃。
 */
function playWithContext(schedule: (ctx: AudioContext) => void): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === 'running') {
    schedule(ctx);
    return;
  }
  void ctx
    .resume()
    .then(() => {
      if (ctx.state === 'running') {
        schedule(ctx);
      } else {
        // resume 无效时上下文已经不可用，丢弃以便下次手势重建
        resetAudio();
      }
    })
    .catch(() => {});
}

/** 答对：上行三音；答错：下行两音 */
export function playAnswerSound(kind: AnswerFeedback): void {
  playWithContext((ctx) => scheduleAnswerSound(ctx, kind));
}

/** 收藏：上行两音；取消收藏：下行两音 */
function scheduleFavoriteSound(ctx: AudioContext, added: boolean): void {
  const t = ctx.currentTime + 0.005;
  if (added) {
    tone(ctx, { freq: 740, at: t, dur: 0.1, gain: 0.12 });
    tone(ctx, { freq: 1108, at: t + 0.06, dur: 0.16, gain: 0.1 });
  } else {
    tone(ctx, { freq: 620, at: t, dur: 0.09, gain: 0.1 });
    tone(ctx, { freq: 415, at: t + 0.05, dur: 0.13, gain: 0.09 });
  }
}

export function emitFavoriteFeedback(added: boolean, settings: Settings): void {
  if (settings.sound !== 1) return;
  playWithContext((ctx) => scheduleFavoriteSound(ctx, added));
}

export type ResultFeedback = 'great' | 'good' | 'low';

/** 结算：高分上行琶音，中间两音，低分温和下行 */
function scheduleResultSound(ctx: AudioContext, kind: ResultFeedback): void {
  const t = ctx.currentTime + 0.02;
  if (kind === 'great') {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone(ctx, { freq, at: t + i * 0.1, dur: 0.24, gain: 0.13 });
    });
  } else if (kind === 'good') {
    tone(ctx, { freq: 523.25, at: t, dur: 0.18, gain: 0.12 });
    tone(ctx, { freq: 783.99, at: t + 0.11, dur: 0.22, gain: 0.1 });
  } else {
    tone(ctx, { freq: 392, at: t, dur: 0.2, gain: 0.1, type: 'triangle' });
    tone(ctx, { freq: 329.63, at: t + 0.12, dur: 0.26, gain: 0.09, type: 'triangle' });
  }
}

export function emitResultFeedback(kind: ResultFeedback, settings: Settings): void {
  if (settings.sound !== 1) return;
  playWithContext((ctx) => scheduleResultSound(ctx, kind));
}

/**
 * iOS 要求音频上下文在用户手势的同步调用栈内恢复，否则后续播放可能一直无声。
 * 在 pointerdown / keydown / touchstart 中同步唤醒，并播一个 0 振幅预热音。
 */
function unlockAudio(): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state !== 'running') void ctx.resume();
  const silent = ctx.createGain();
  silent.gain.value = 0.0001;
  const osc = ctx.createOscillator();
  osc.connect(silent).connect(master ?? ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.01);
}

const GESTURE_OPTS = { capture: true, passive: true } as const;
let unlockBound = false;

/** 回前台后上下文可能已被系统挂起，需要重新等待下一次手势解锁 */
function bindUnlock(): void {
  if (unlockBound || typeof document === 'undefined') return;
  unlockBound = true;
  document.addEventListener('pointerdown', onFirstGesture, GESTURE_OPTS);
  document.addEventListener('touchstart', onFirstGesture, GESTURE_OPTS);
  document.addEventListener('keydown', onFirstGesture, GESTURE_OPTS);
}

function onFirstGesture(): void {
  unlockAudio();
  document.removeEventListener('pointerdown', onFirstGesture, GESTURE_OPTS);
  document.removeEventListener('touchstart', onFirstGesture, GESTURE_OPTS);
  document.removeEventListener('keydown', onFirstGesture, GESTURE_OPTS);
  unlockBound = false;
}

/** 从后台回到前台：上下文失效时重建，并重新绑定首次手势解锁 */
function recoverAudio(): void {
  const ctx = audio;
  if (!ctx) {
    bindUnlock();
    return;
  }
  if ((ctx.state as string) === 'interrupted') {
    resetAudio();
    bindUnlock();
    return;
  }
  if (ctx.state === 'running') return;
  void ctx
    .resume()
    .then(() => {
      if (ctx.state !== 'running') {
        resetAudio();
        bindUnlock();
      }
    })
    .catch(() => {
      resetAudio();
      bindUnlock();
    });
}

if (typeof document !== 'undefined') {
  bindUnlock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recoverAudio();
  });
  // 从 bfcache 恢复时也要重新检查
  window.addEventListener('pageshow', recoverAudio);
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