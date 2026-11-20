import { useSyncExternalStore } from 'react';

/** The PC side bar's width: dragged to any width in this range, saved on this device only (like the table column widths). */
export const NAV_MIN_W = 200;
export const NAV_MAX_W = 360;
export const NAV_DEFAULT_W = 240;
export const NAV_NUDGE_PX = 16;
export const NAV_WIDTH_KEY = 'mt-side-nav-w';

export const clampNavWidth = (w: number): number => Math.min(NAV_MAX_W, Math.max(NAV_MIN_W, Math.round(w)));

function read(): number | null {
  try {
    const n = Number(JSON.parse(localStorage.getItem(NAV_WIDTH_KEY) ?? 'null'));
    return Number.isFinite(n) && n > 0 ? clampNavWidth(n) : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let current: number | null | undefined;
const get = (): number | null => (current === undefined ? (current = read()) : current);

/** Saves (or, with null, forgets) the width. Best-effort: a blocked localStorage keeps the width for this visit only. */
export function setNavWidth(w: number | null): void {
  current = w === null ? null : clampNavWidth(w);
  try {
    if (current === null) localStorage.removeItem(NAV_WIDTH_KEY);
    else localStorage.setItem(NAV_WIDTH_KEY, JSON.stringify(current));
  } catch {
    // keep it in memory
  }
  listeners.forEach((l) => l());
}

/** Re-reads storage (tests, and another tab's change). */
export function reloadNavWidth(): void {
  current = undefined;
  listeners.forEach((l) => l());
}

/** The saved width (null = the default). */
export function useNavWidth(): number | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, get, () => null);
}
