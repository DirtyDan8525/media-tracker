import { formatRating } from '@media-tracker/shared';
import { useEffect, useRef, useState } from 'react';

const DURATION = 900;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** True only when the person has no motion preference (so jsdom and reduced motion get no animation). */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

/**
 * A rating that counts up from `from` (default 0) to `value` when motion is allowed; when `value`
 * later changes it counts on from the number it last showed (an edit moves 8.0 → 9.0, not 0 → 9.0).
 * Under reduced motion it shows `formatRating(value)` at once. Screen readers always get the real
 * value (visually hidden); the moving digits are aria-hidden.
 */
export function CountUp({ value, from = 0 }: { value: number; from?: number }) {
  const final = formatRating(value);
  const decimals = final.split('.')[1]?.length ?? 1;
  const [shown, setShown] = useState<string>(() => (motionAllowed() ? from.toFixed(decimals) : final));
  // The number on screen right now: where the next count starts.
  const last = useRef<number>(motionAllowed() ? from : value);

  useEffect(() => {
    if (!motionAllowed()) { last.current = value; setShown(final); return; }
    const start0 = last.current;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / DURATION);
      const n = t >= 1 ? value : start0 + (value - start0) * easeOut(t);
      last.current = n;
      setShown(t >= 1 ? final : n.toFixed(decimals));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, final, decimals]);

  return (
    <span className="count-up">
      <span className="sr-only">{final}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
