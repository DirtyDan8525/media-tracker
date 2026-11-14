import { formatRating } from '@media-tracker/shared';
import { useEffect, useState } from 'react';

const DURATION = 900;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** True only when the person has no motion preference (so jsdom and reduced motion get no animation). */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

/**
 * A rating that counts up from `from` (default 0) to `value` once, when motion is allowed.
 * Under reduced motion it shows `formatRating(value)` at once. Screen readers always get the real
 * value (visually hidden); the moving digits are aria-hidden.
 */
export function CountUp({ value, from = 0 }: { value: number; from?: number }) {
  const final = formatRating(value);
  const decimals = final.split('.')[1]?.length ?? 1;
  const [shown, setShown] = useState<string>(() => (motionAllowed() ? from.toFixed(decimals) : final));

  useEffect(() => {
    if (!motionAllowed()) { setShown(final); return; }
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / DURATION);
      setShown(t >= 1 ? final : (from + (value - from) * easeOut(t)).toFixed(decimals));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, from, final, decimals]);

  return (
    <span className="count-up">
      <span className="sr-only">{final}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
