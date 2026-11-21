import type { Category } from '@media-tracker/shared';
import { useSyncExternalStore } from 'react';
import { isCategory } from '../nav';

export const LAST_ADD_KEY = 'mt-last-add-list';

/** The list you last added to on this device (any list key), or null. localStorage may be unavailable (private mode): then null. */
export function readLastAddList(): string | null {
  try { return localStorage.getItem(LAST_ADD_KEY); } catch { return null; }
}

/** Remembers the list a title was just added to. Per device; a failed write just means the default applies next time. */
export function rememberAddList(c: Category): void {
  if (readLastAddList() === c) return;
  try { localStorage.setItem(LAST_ADD_KEY, c); } catch { /* storage unavailable: the fallback applies */ }
  notify();
}

export function forgetAddList(): void {
  try { localStorage.removeItem(LAST_ADD_KEY); } catch { /* nothing to forget */ }
  notify();
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => { if (e.key === LAST_ADD_KEY || e.key === null) onChange(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(onChange); window.removeEventListener('storage', onStorage); };
}

/** The stored last-added list, kept fresh (another tab, or an add just made). Resolve it with `resolveAddList`. */
export const useLastAddList = (): string | null => useSyncExternalStore(subscribe, readLastAddList, () => null);

/**
 * Which list Add opens on when it is not opened from inside a list: the last list added to, if it is still on (never a list that
 * is off, deleted or hidden), else `fallback` (the current default list), else the first enabled list, else null (every list is off).
 */
export function resolveAddList(stored: string | null, enabled: Category[], fallback: Category | null): Category | null {
  if (isCategory(stored ?? undefined) && enabled.includes(stored as Category)) return stored as Category;
  return fallback && enabled.includes(fallback) ? fallback : enabled[0] ?? null;
}
