import { compareRated, type Entry } from '@media-tracker/shared';

export type SortKey = 'rating' | 'release' | 'title';
export const SORT_KEYS: readonly SortKey[] = ['rating', 'release', 'title'];
export const SORT_LABEL: Record<SortKey, string> = { rating: 'Rating', release: 'Release date', title: 'Title' };

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
/** Title, then id (Ruling P2), so equal titles keep one order whatever order the rows arrive in. */
const byTitle = (a: { title: string; id?: string }, b: { title: string; id?: string }): number =>
  collator.compare(a.title, b.title) || (a.id ?? '').localeCompare(b.id ?? '');

/** Pre-3c cached rows have no tier/strength at all (undefined): they sort as unrated-tier, never throw. */
const ratedKey = (e: Pick<Entry, 'rating' | 'title'> & Partial<Pick<Entry, 'id' | 'tier' | 'strength'>>) =>
  ({ id: e.id ?? '', title: e.title, rating: e.rating ?? null, tier: e.tier ?? null, strength: e.strength ?? null });

/** 'YYYY-MM-DD' or 'YYYY' (as 1 January of that year) as a sortable number; null when undated. */
function dateKey(d: string): number | null {
  const m = /^(\d{4})(?:-(\d{2})-(\d{2}))?$/.exec(d);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2] ?? 1) * 100 + Number(m[3] ?? 1);
}

/** A sorted copy. Rating: shown score high to low (unrated last), then tier, then strength, then title (spec §5.1). Release: newest first, undated last. Ties by title. */
export function sortEntries<T extends Pick<Entry, 'rating' | 'title' | 'releaseDate'> & Partial<Pick<Entry, 'id' | 'tier' | 'strength'>>>(rows: T[], key: SortKey): T[] {
  const out = [...rows];
  if (key === 'title') return out.sort(byTitle);
  if (key === 'rating') {
    return out.sort((a, b) => compareRated(ratedKey(a), ratedKey(b)));
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
