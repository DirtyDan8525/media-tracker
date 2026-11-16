import type { Category, Entry } from '@media-tracker/shared';
import { sortEntries } from '../lists/sort';

/** The five best-rated rows of a list: rating high to low, ties by title; unrated rows never count. */
export function topFive(rows: Entry[]): Entry[] {
  return sortEntries(rows.filter((e) => e.rating !== null), 'rating').slice(0, 5);
}

/** The #1 of each list in `lists` (their order, the nav order): lists with nothing rated are skipped. */
export function numberOnes(byCategory: Partial<Record<Category, Entry[]>>, lists: Category[]): Entry[] {
  return lists.flatMap((c) => {
    const first = topFive(byCategory[c] ?? [])[0];
    return first ? [first] : [];
  });
}
