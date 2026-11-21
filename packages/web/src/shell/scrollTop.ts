import type { MouseEvent } from 'react';

/** Reduced motion asked for: jump instead of gliding. */
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Scrolls the page (and the content column, if that is what scrolls) back to the top: smooth, or at once under reduced motion. */
export function scrollPageToTop(): void {
  const behavior: ScrollBehavior = reduced() ? 'auto' : 'smooth';
  window.scrollTo?.({ top: 0, behavior });
  const main = document.querySelector<HTMLElement>('.frame__main');
  if (main && main.scrollTop > 0) main.scrollTo?.({ top: 0, behavior });
}

/**
 * A nav item's click: when it is the screen you are already on (`same`), scroll to the top instead of navigating.
 * Anything else (another screen, or Ctrl/Cmd/Shift/middle-click to open elsewhere) navigates as usual.
 */
export function topOnSameScreen(same: boolean) {
  return (e: MouseEvent<HTMLElement>) => {
    if (!same || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    scrollPageToTop();
  };
}
