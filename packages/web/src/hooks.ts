import { useEffect, useState, useSyncExternalStore } from 'react';

/** True while the media query matches; follows changes (rotation, window resize). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** PC layout (side nav) at 768 px and wider; phone layout (bottom tabs) below. */
export const WIDE_QUERY = '(min-width: 768px)';
export const useIsWide = (): boolean => useMediaQuery(WIDE_QUERY);

/**
 * The current time, refreshed every `everyMs` while the page is visible (and at once when it
 * becomes visible again), so relative times such as "5 min ago" keep up while a screen stays open.
 */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => { if (timer === undefined) timer = setInterval(() => setNow(new Date()), everyMs); };
    const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else { setNow(new Date()); start(); }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [everyMs]);
  return now;
}
