import type { Category } from '@media-tracker/shared';
import { useMemo, useSyncExternalStore } from 'react';
import { isCategory } from '../nav';
import { useEnabledLists } from './useLists';
import { useSessionMe } from './SessionGate';

export const CURRENT_LIST_KEY = 'mt-current-list';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function read(): string | null {
  try { return localStorage.getItem(CURRENT_LIST_KEY); } catch { return null; }
}

/** The list screen last shown, kept on the device so Add / Lists / Search know where "here" is. */
export function rememberList(c: Category): void {
  if (read() === c) return;
  try { localStorage.setItem(CURRENT_LIST_KEY, c); } catch { /* storage unavailable: the fallback applies */ }
  notify();
}

export function forgetCurrentList(): void {
  try { localStorage.removeItem(CURRENT_LIST_KEY); } catch { /* nothing to forget */ }
  notify();
}

/** A stored list that is still on, else the first enabled list, else null (every list is off). */
export function resolveCurrentList(stored: string | null, enabled: Category[]): Category | null {
  if (isCategory(stored ?? undefined) && enabled.includes(stored as Category)) return stored as Category;
  return enabled[0] ?? null;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => { if (e.key === CURRENT_LIST_KEY || e.key === null) onChange(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(onChange); window.removeEventListener('storage', onStorage); };
}

/** B4: never a list that is turned off, so nothing navigates to a list that redirects. */
export function useCurrentList(): Category | null {
  const me = useSessionMe();
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const key = useEnabledLists().join(',');
  return useMemo(() => resolveCurrentList(stored, key ? (key.split(',') as Category[]) : []), [stored, key]);
}
