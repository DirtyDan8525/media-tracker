import type { Category, ListsSetting, UserSettings } from '@media-tracker/shared';

/** List tabs in nav order. Season tabs (animeSeasons, tvSeasons) are settings, not lists. */
export const LIST_ORDER: readonly Category[] = ['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga', 'youtube'];

export const LIST_LABEL: Record<Category, string> = {
  anime: 'Anime', movies: 'Movies', tv: 'TV Shows', albums: 'Albums', songs: 'Songs', games: 'Games', books: 'Books', manga: 'Manga', youtube: 'YouTube',
};

/** Every switch on the Settings Tabs card, in the Sheet's order. */
export const TAB_SWITCHES: { key: string; label: string }[] = [
  ...LIST_ORDER.map((c) => ({ key: c, label: LIST_LABEL[c] })),
  { key: 'animeSeasons', label: 'Anime Seasons' },
  { key: 'tvSeasons', label: 'TV Seasons' },
];

export const isCategory = (s: string | undefined): s is Category => LIST_ORDER.includes(s as Category);

type OrderSettings = { listOrder?: Category[] };

/**
 * Every list the admin has not hidden for everyone, in the order this person sees them: their own `listOrder` first (the
 * Reorder lists sheet), then any list it does not name in the admin's order. Includes lists the person turned off.
 */
export function orderedLists(settings: OrderSettings, lists?: ListsSetting): Category[] {
  const base = (lists ? lists.order.filter((c) => LIST_ORDER.includes(c)) : [...LIST_ORDER]).filter((c) => !lists?.hidden.includes(c));
  const own = (settings.listOrder ?? []).filter((c) => base.includes(c));
  return [...own, ...base.filter((c) => !own.includes(c))];
}

/**
 * The lists a person sees, in order. The admin's `lists` setting (AD11) sets the order and hides lists for everyone, a person's
 * own `listOrder` reorders what is left, and their Settings can turn lists off (but not back on if the admin hid them).
 */
export function enabledLists(settings: Pick<UserSettings, 'tabs'> & OrderSettings, lists?: ListsSetting): Category[] {
  return orderedLists(settings, lists).filter((c) => settings.tabs[c] !== false);
}

/** Settings → Tabs: the lists in the order the person sees them, without the lists hidden for everyone; the season switches follow. */
export function tabSwitches(lists?: ListsSetting, listOrder?: Category[]): { key: string; label: string }[] {
  return [...orderedLists({ listOrder }, lists).map((c) => ({ key: c as string, label: LIST_LABEL[c] })), ...TAB_SWITCHES.slice(LIST_ORDER.length)];
}

/** Where `/` lands: the first enabled list, or Settings if every list is off. */
export function homePath(settings: Pick<UserSettings, 'tabs'> & OrderSettings, lists?: ListsSetting): string {
  const first = enabledLists(settings, lists)[0];
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

/** "Add anime", "Add TV show": the singular used on the add button. */
export const ADD_NOUN: Record<Category, string> = {
  anime: 'anime', movies: 'movie', tv: 'TV show', albums: 'album', songs: 'song', games: 'game', books: 'book', manga: 'manga', youtube: 'video',
};

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
