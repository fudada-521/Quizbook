import { useEffect, useRef } from 'react';

/**
 * Refract 主题的生成式水光：一组互相穿过的波形线，模拟泳池水面
 * 投在白墙上的焦散。只作背景；静止帧同样好看，离屏与减弱动效时停笔。
 */
export function WaterLight({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    let width = 0;
    let height = 0;
    let phase = 4.7;
    let raf = 0;
    let last = 0;
    let onScreen = true;

    const draw = () => {
      if (!width || !height) return;
      const night = dark.matches;
      ctx.clearRect(0, 0, width, height);

      const wash = ctx.createLinearGradient(0, 0, width, height);
      if (night) {
        wash.addColorStop(0, 'rgba(255, 255, 255, 0.025)');
        wash.addColorStop(0.55, 'rgba(255, 255, 255, 0.045)');
        wash.addColorStop(1, 'rgba(255, 255, 255, 0.015)');
      } else {
        wash.addColorStop(0, 'rgba(15, 15, 15, 0.03)');
        wash.addColorStop(0.55, 'rgba(15, 15, 15, 0.05)');
        wash.addColorStop(1, 'rgba(15, 15, 15, 0.02)');
      }
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      // 浅色用正片叠底留下灰阶墨影，深色用加光留下银灰反光
      ctx.globalCompositeOperation = night ? 'lighter' : 'multiply';

      const rows = 22;
      const rowStep = Math.max(14, Math.min(26, width / 26));
      for (let i = 0; i < rows; i += 1) {
        const base = ((i + 0.5) / rows) * height;
        ctx.beginPath();
        for (let x = -rowStep; x <= width + rowStep; x += rowStep / 2) {
          const y =
            base +
            Math.sin(x * 0.012 + phase * 0.55 + i * 0.62) * 16 +
            Math.sin(x * 0.021 - phase * 0.8 + i * 1.31) * 9 +
            Math.cos(x * 0.006 + phase * 0.33 + i * 0.2) * 22;
          if (x <= -rowStep) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = i % 4 === 0 ? 1.6 : 0.8;
        ctx.strokeStyle = night
          ? 'rgba(255, 255, 255, 0.07)'
          : 'rgba(0, 0, 0, 0.07)';
        ctx.stroke();
      }

      const cols = 16;
      const colStep = Math.max(18, Math.min(34, width / 22));
      for (let j = 0; j < cols; j += 1) {
        const base = ((j + 0.5) / cols) * width;
        ctx.beginPath();
        for (let y = -colStep; y <= height + colStep; y += colStep / 2) {
          const x =
            base +
            Math.sin(y * 0.016 + phase * 0.7 + j * 0.9) * 13 +
            Math.sin(y * 0.026 - phase * 0.52 + j * 0.4) * 7;
          if (y <= -colStep) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = night
          ? 'rgba(215, 215, 215, 0.045)'
          : 'rgba(0, 0, 0, 0.035)';
        ctx.stroke();
      }

      // 最亮的接缝处一点点色散，不做彩虹
      const seams = night
        ? ['rgba(255, 255, 255, 0.05)', 'rgba(230, 230, 230, 0.045)', 'rgba(205, 205, 205, 0.055)']
        : ['rgba(0, 0, 0, 0.05)', 'rgba(0, 0, 0, 0.04)', 'rgba(0, 0, 0, 0.06)'];
      ctx.lineWidth = 2.4;
      for (let k = 0; k < 7; k += 1) {
        const cx = width * (0.18 + 0.12 * k) + Math.sin(phase * 0.6 + k) * 18;
        const cy = height * (0.3 + 0.09 * ((k * 3) % 5)) + Math.cos(phase * 0.4 + k) * 14;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 26 + k * 3, 12 + k * 2, 0.5 + k * 0.2, 0, Math.PI * 2);
        ctx.strokeStyle = seams[k % seams.length];
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 42) return;
      last = now;
      phase += 0.045;
      draw();
    };

    const start = () => {
      if (raf || reduce.matches || !onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    measure();

    const resize = new ResizeObserver(measure);
    resize.observe(canvas);

    const seen = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) start();
        else stop();
      },
      { threshold: 0 },
    );
    seen.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const onMoodChange = () => {
      draw();
      if (reduce.matches) stop();
      else start();
    };

    document.addEventListener('visibilitychange', onVisibility);
    reduce.addEventListener('change', onMoodChange);
    dark.addEventListener('change', onMoodChange);
    start();

    return () => {
      stop();
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduce.removeEventListener('change', onMoodChange);
      dark.removeEventListener('change', onMoodChange);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}