import { useSyncExternalStore } from 'react';

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
