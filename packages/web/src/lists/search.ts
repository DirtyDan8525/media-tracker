import type { Category, Entry } from '@media-tracker/shared';
import { matchesFilter } from './filter';
import { sortEntries } from './sort';

/**
 * Global search over already-loaded lists: the list filter's matcher (title, typed title, creator,
 * album, genres; accent- and case-insensitive), per list in the order of `lists`, each group sorted
 * by rating with unrated last. An empty query finds nothing; lists with no match are left out.
 */
export function searchEntries(
  byCategory: Partial<Record<Category, Entry[]>>,
  lists: Category[],
  q: string,
): { category: Category; rows: Entry[] }[] {
  const filter = { q, status: '' as const, genre: '' };
  if (!q.trim()) return [];
  const out: { category: Category; rows: Entry[] }[] = [];
  for (const category of lists) {
    const rows = sortEntries((byCategory[category] ?? []).filter((e) => matchesFilter(e, filter)), 'rating');
    if (rows.length) out.push({ category, rows });
  }
  return out;
}
