import type { Category, UserSettings } from '@media-tracker/shared';

/** List tabs in nav order. Season tabs (animeSeasons, tvSeasons) are settings, not lists. */
export const LIST_ORDER: readonly Category[] = ['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books'];

export const LIST_LABEL: Record<Category, string> = {
  anime: 'Anime', movies: 'Movies', tv: 'TV Shows', albums: 'Albums', songs: 'Songs', games: 'Games', books: 'Books',
};

/** Bottom-tab labels (11 px under a 22 px icon, so short). */
export const TAB_LABEL: Record<Category, string> = { ...LIST_LABEL, tv: 'TV' };

/** Every switch on the Settings Tabs card, in the Sheet's order. */
export const TAB_SWITCHES: { key: string; label: string }[] = [
  ...LIST_ORDER.map((c) => ({ key: c, label: LIST_LABEL[c] })),
  { key: 'animeSeasons', label: 'Anime Seasons' },
  { key: 'tvSeasons', label: 'TV Seasons' },
];

/** How many lists the phone bottom bar holds before "More". */
export const PHONE_TAB_COUNT = 4;

export const isCategory = (s: string | undefined): s is Category => LIST_ORDER.includes(s as Category);

export function enabledLists(settings: Pick<UserSettings, 'tabs'>): Category[] {
  return LIST_ORDER.filter((c) => settings.tabs[c] !== false);
}

/** Phone: the first 4 enabled lists sit in the bottom bar, the rest under More. */
export function splitForPhone(lists: Category[]): { tabs: Category[]; more: Category[] } {
  return { tabs: lists.slice(0, PHONE_TAB_COUNT), more: lists.slice(PHONE_TAB_COUNT) };
}

/** Where `/` lands: the first enabled list, or Settings if every list is off. */
export function homePath(settings: Pick<UserSettings, 'tabs'>): string {
  const first = enabledLists(settings)[0];
  return first ? `/list/${first}` : '/settings';
}
