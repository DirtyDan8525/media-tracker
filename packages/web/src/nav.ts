import {
  BUILTIN_CATEGORIES, BUILTIN_LABEL, BUILTIN_NOUN, isBuiltinCategory, isCustomCategory, listTitle,
  type BuiltinCategory, type Category, type CustomList, type ListsSetting, type UserSettings,
} from '@media-tracker/shared';

/** The built-in list tabs in nav order. Season tabs (animeSeasons, tvSeasons) are settings, not lists. Custom lists: `orderedLists`. */
export const LIST_ORDER: readonly BuiltinCategory[] = BUILTIN_CATEGORIES;

/** Built-in names only; any list key: lists/registry `listLabel` / `listName`. */
export const LIST_LABEL: Record<BuiltinCategory, string> = BUILTIN_LABEL;

/** Every switch on the Settings Tabs card, in the Sheet's order. */
export const TAB_SWITCHES: { key: string; label: string; custom?: boolean }[] = [
  ...LIST_ORDER.map((c) => ({ key: c, label: LIST_LABEL[c] })),
  { key: 'animeSeasons', label: 'Anime Seasons' },
  { key: 'tvSeasons', label: 'TV Seasons' },
];

/** A built-in key, or the key of one of `custom` (yours). Without `custom`: any custom-shaped key. */
export const isCategory = (s: string | undefined, custom?: readonly CustomList[]): s is Category =>
  isBuiltinCategory(s) || (isCustomCategory(s) && (custom === undefined || custom.some((l) => l.key === s)));

type OrderSettings = { listOrder?: Category[] };

/**
 * Every list the admin has not hidden for everyone, plus your custom lists, in the order this person sees them: their own
 * `listOrder` first (the Reorder lists sheet), then any list it does not name: built-in lists in the admin's order, then custom
 * lists oldest first (a new list lands at the end). Includes lists the person turned off.
 */
export function orderedLists(settings: OrderSettings, lists?: ListsSetting, custom: readonly CustomList[] = []): Category[] {
  const builtin: Category[] = (lists ? lists.order.filter((c) => LIST_ORDER.includes(c)) : [...LIST_ORDER]).filter((c) => !lists?.hidden.includes(c as BuiltinCategory));
  const base: Category[] = [...builtin, ...custom.map((l) => l.key)];
  const own = (settings.listOrder ?? []).filter((c) => base.includes(c));
  return [...own, ...base.filter((c) => !own.includes(c))];
}

/**
 * The lists a person sees, in order. The admin's `lists` setting (AD11) sets the order and hides lists for everyone, a person's
 * own `listOrder` reorders what is left, and their Settings can turn lists off (but not back on if the admin hid them).
 * Custom lists (yours) come in the same way, on unless turned off.
 */
export function enabledLists(settings: Pick<UserSettings, 'tabs'> & OrderSettings, lists?: ListsSetting, custom: readonly CustomList[] = []): Category[] {
  return orderedLists(settings, lists, custom).filter((c) => settings.tabs[c] !== false);
}

/** Settings → Tabs: the lists in the order the person sees them, without the lists hidden for everyone; the season switches follow. */
export function tabSwitches(lists?: ListsSetting, listOrder?: Category[], custom: readonly CustomList[] = []): { key: string; label: string; custom?: boolean }[] {
  return [
    ...orderedLists({ listOrder }, lists, custom).map((c) => (isCustomCategory(c) ? { key: c as string, label: listTitle(c, custom), custom: true } : { key: c as string, label: LIST_LABEL[c as BuiltinCategory] })),
    ...TAB_SWITCHES.slice(LIST_ORDER.length),
  ];
}

/** Where `/` lands: the first enabled list, or Settings if every list is off. */
export function homePath(settings: Pick<UserSettings, 'tabs'> & OrderSettings, lists?: ListsSetting, custom: readonly CustomList[] = []): string {
  const first = enabledLists(settings, lists, custom)[0];
  return first ? `/list/${first}` : '/settings';
}

/** The Settings → Tabs switch that turns a category's seasons on and off (null: the category has no seasons). */
export function seasonsTabKey(category: Category): 'animeSeasons' | 'tvSeasons' | null {
  return category === 'anime' ? 'animeSeasons' : category === 'tv' ? 'tvSeasons' : null;
}

/** Seasons (the editor and the Season Avg column) show only for categories with seasons whose tab is on. */
export function seasonsEnabled(settings: Pick<UserSettings, 'tabs'>, category: Category): boolean {
  const key = seasonsTabKey(category);
  return key !== null && settings.tabs[key] !== false;
}

/** "Add anime", "Add TV show": built-in nouns; any list key: lists/registry `addNoun`. */
export const ADD_NOUN: Record<BuiltinCategory, string> = BUILTIN_NOUN;

/**
 * B3: the bottom bar's Add opens the current list's Add sheet through this URL (ListScreen strips `add`).
 * `keep`: the list's own query (Status, Genre, …) when Add is used on that list, so its filters survive.
 */
export function addPath(c: Category, keep?: URLSearchParams | string): string {
  const p = new URLSearchParams(keep);
  p.delete('add');
  p.append('add', '1');
  return `/list/${c}?${p.toString()}`;
}

/** Global search (`/search?q=`). */
export const SEARCH_PATH = '/search';

/** The floating Add bubble shows on the lists, Activity and Search only: not on Profile, More, Compare, Settings (and their sub-pages), Admin, Friends, friend profiles, entries... */
export function showsAddBubble(pathname: string): boolean {
  return pathname.startsWith('/list/') || pathname === '/activity' || pathname === '/search';
}
