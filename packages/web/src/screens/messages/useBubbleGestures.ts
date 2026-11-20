import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';

/** Holding a bubble this long (without moving) opens its menu. */
export const LONG_PRESS_MS = 450;
/** Dragging a bubble this far toward the middle starts a reply. */
export const SWIPE_REPLY_PX = 60;
/** The bubble follows the finger up to here. */
const SWIPE_MAX_PX = 90;
/** Movement under this is still "holding still". */
const SLOP_PX = 10;

/**
 * Touch gestures on a chat bubble (Dan, 2026-11-20):
 *  - hold still LONG_PRESS_MS: `onHold` (the message menu);
 *  - drag sideways toward the middle of the screen (`dir` 1 = right for their messages, -1 = left for mine): the bubble follows
 *    the finger and a reply arrow shows; let go past SWIPE_REPLY_PX and `onSwipe` (a reply), else it snaps back.
 * The swipe only starts when sideways movement clearly dominates, so vertical scrolling is untouched (the bubble also has
 * touch-action: pan-y). The phone's own long-press menu is held back while a hold is in progress. Mouse right-click: `onHold`.
 */
export function useBubbleGestures({ dir, onHold, onSwipe, holdEnabled, swipeEnabled }: {
  dir: 1 | -1; onHold: () => void; onSwipe: () => void; holdEnabled: boolean; swipeEnabled: boolean;
}) {
  const [dx, setDx] = useState(0);
  const g = useRef<{ x: number; y: number; mode: 'pending' | 'swipe' | 'scroll'; timer: number; held: boolean; buzzed: boolean } | null>(null);
  const lastTouch = useRef(0);
  const swallowClick = useRef(false);
  const clear = () => { if (g.current) window.clearTimeout(g.current.timer); };
  useEffect(() => clear, []);

  const onTouchStart = (e: ReactTouchEvent) => {
    lastTouch.current = Date.now();
    swallowClick.current = false;
    if (e.touches.length !== 1 || (e.target as HTMLElement).closest('[data-no-gesture], input, textarea')) return;
    const t = e.touches[0]!;
    clear();
    const s = { x: t.clientX, y: t.clientY, mode: 'pending' as 'pending' | 'swipe' | 'scroll', timer: 0, held: false, buzzed: false };
    if (holdEnabled) {
      s.timer = window.setTimeout(() => {
        if (s.mode !== 'pending') return;
        s.held = true;
        swallowClick.current = true;
        navigator.vibrate?.(10);
        onHold();
      }, LONG_PRESS_MS);
    }
    g.current = s;
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const s = g.current;
    const t = e.touches[0];
    if (!s || !t || s.held) return;
    const mx = t.clientX - s.x;
    const my = t.clientY - s.y;
    if (s.mode === 'pending') {
      if (Math.abs(mx) < SLOP_PX && Math.abs(my) < SLOP_PX) return;
      window.clearTimeout(s.timer);
      // Sideways, toward the middle, and clearly more sideways than up or down; anything else is a scroll.
      s.mode = swipeEnabled && Math.abs(mx) > Math.abs(my) * 1.5 && Math.sign(mx) === dir ? 'swipe' : 'scroll';
    }
    if (s.mode !== 'swipe') return;
    const along = Math.min(Math.max(mx * dir, 0), SWIPE_MAX_PX);
    if (along >= SWIPE_REPLY_PX && !s.buzzed) { s.buzzed = true; navigator.vibrate?.(10); }
    setDx(along * dir);
  };
  const end = (commit: boolean) => (e: ReactTouchEvent) => {
    const s = g.current;
    lastTouch.current = Date.now();
    if (!s) return;
    clear();
    g.current = null;
    if (s.mode === 'swipe') {
      const t = e.changedTouches[0];
      const along = t ? Math.min(Math.max((t.clientX - s.x) * dir, 0), SWIPE_MAX_PX) : Math.abs(dx);
      setDx(0);
      swallowClick.current = true;
      if (commit && along >= SWIPE_REPLY_PX) onSwipe();
    }
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    // A touch hold: the menu is ours, not the phone's. A mouse right-click opens the same menu.
    if (Date.now() - lastTouch.current < 1500) { e.preventDefault(); return; }
    if (!holdEnabled) return;
    if ((e.target as HTMLElement).closest('a, input, textarea')) return;
    e.preventDefault();
    onHold();
  };
  // A hold or a swipe must not also "tap" what was under the finger (a photo, a quote).
  const onClickCapture = (e: ReactMouseEvent) => {
    if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation(); }
  };
  return {
    dx,
    handlers: { onTouchStart, onTouchMove, onTouchEnd: end(true), onTouchCancel: end(false), onContextMenu, onClickCapture },
  };
}
