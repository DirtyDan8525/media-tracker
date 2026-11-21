/**
 * Custom lists in the web app (Phase 7). Every per-list question goes through `listCfg` (shared `listConfig`), for
 * built-in and custom keys alike. Custom keys are unique across everyone (`c_<id>`), so one registry holds yours and
 * any friend's or public profile's lists the app has been shown: data hooks register them as they arrive (your own
 * from /api/me, a friend's from their profile header, a feed page's from `lists`), before anything renders them.
 */
import {
  BUILTIN_CATEGORIES, isCustomCategory, listConfig, listTitle, statusLabel, statusSentence, type Category, type CustomList, type ListConfig, type Status,
} from '@media-tracker/shared';
import { useSyncExternalStore } from 'react';

const registry = new Map<string, CustomList>();
const listeners = new Set<() => void>();
let version = 0;

const same = (a: CustomList, b: CustomList) => JSON.stringify(a) === JSON.stringify(b);

/** Adds (or updates) lists the app was shown. Re-renders subscribers only when something changed. */
export function registerLists(lists: readonly CustomList[] | Record<string, CustomList> | null | undefined): void {
  if (!lists) return;
  let changed = false;
  for (const l of Array.isArray(lists) ? lists : Object.values(lists)) {
    const had = registry.get(l.key);
    if (!had || !same(had, l)) { registry.set(l.key, l); changed = true; }
  }
  if (changed) { version++; listeners.forEach((f) => f()); }
}

/** Tests: start from nothing. */
export function resetListRegistry(): void {
  registry.clear();
  version++;
  listeners.forEach((f) => f());
}

/** Re-renders when a list is registered or changed (a rename shows at once). */
export function useListRegistry(): number {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => version, () => version);
}

/** The config of any list key (built-in, yours, or one the app has been shown). */
export const listCfg = (c: Category): ListConfig => listConfig(c, registry);
/** "Anime", "Restaurants": a list's plain name (sentences, aria labels). */
export const listLabel = (c: Category): string => listCfg(c).label;
/** "🍜 Restaurants": with a custom list's emoji (nav rows, menus, headings). */
export const listName = (c: Category): string => listTitle(c, registry);
/** "anime", "TV show", "restaurant": the singular on Add buttons. */
export const addNoun = (c: Category): string => listCfg(c).noun;
/** A stored status in the list's own words (shared statusLabel with custom lists' words). */
export const statusText = (s: Status, c: Category): string => statusLabel(s, c, registry);
/** A feed line's words for a status change, in the list's own words ("started", "finished", "wants to read"). */
export const statusPhrase = (s: Status, c: Category, own: boolean) => statusSentence(s, c, own, registry);
/** A custom list the app knows, by key. */
export const knownList = (c: Category): CustomList | undefined => registry.get(c);

/**
 * The lists that `present` names, in the order lists show: the built-in ones in their usual order, then custom lists oldest
 * first (by what the registry knows; unknown ones last). For someone else's rows (a friend's or a public profile).
 */
export function presentLists(present: Iterable<Category>): Category[] {
  const set = new Set(present);
  const builtin = BUILTIN_CATEGORIES.filter((c) => set.has(c));
  const custom = [...set].filter((c) => isCustomCategory(c))
    .sort((a, b) => (registry.get(a)?.createdAt ?? '￿').localeCompare(registry.get(b)?.createdAt ?? '￿') || a.localeCompare(b));
  return [...builtin, ...custom];
}
