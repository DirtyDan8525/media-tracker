import type { Entry } from '@media-tracker/shared';

export type SortKey = 'rating' | 'release' | 'title';
export const SORT_KEYS: readonly SortKey[] = ['rating', 'release', 'title'];
export const SORT_LABEL: Record<SortKey, string> = { rating: 'Rating', release: 'Release date', title: 'Title' };

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
/** Title, then id (Ruling P2), so equal titles keep one order whatever order the rows arrive in. */
const byTitle = (a: { title: string; id?: string }, b: { title: string; id?: string }): number =>
  collator.compare(a.title, b.title) || (a.id ?? '').localeCompare(b.id ?? '');

/** 'YYYY-MM-DD' or 'YYYY' (as 1 January of that year) as a sortable number; null when undated. */
function dateKey(d: string): number | null {
  const m = /^(\d{4})(?:-(\d{2})-(\d{2}))?$/.exec(d);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2] ?? 1) * 100 + Number(m[3] ?? 1);
}

/** A sorted copy. Rating: high to low, unrated last. Release: newest first, undated last. Ties by title. */
export function sortEntries<T extends Pick<Entry, 'rating' | 'title' | 'releaseDate'> & { id?: string }>(rows: T[], key: SortKey): T[] {
  const out = [...rows];
  if (key === 'title') return out.sort(byTitle);
  if (key === 'rating') {
    return out.sort((a, b) => {
      if (a.rating === b.rating) return byTitle(a, b);
      if (a.rating === null) return 1;
      if (b.rating === null) return -1;
      return b.rating - a.rating;
    });
  }
  return out.sort((a, b) => {
    const ka = dateKey(a.releaseDate);
    const kb = dateKey(b.releaseDate);
    if (ka === kb) return byTitle(a, b);
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka;
  });
}
