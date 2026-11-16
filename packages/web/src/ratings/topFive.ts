import type { Category, Entry } from '@media-tracker/shared';
import { sortEntries } from '../lists/sort';

/** What ranking needs of a row: your own `Entry` and a friend's `FriendEntry` both have it. */
export type Ranked = Pick<Entry, 'rating' | 'title' | 'releaseDate'> & Partial<Pick<Entry, 'id' | 'tier' | 'strength'>>;

/** The five best-rated rows of a list: rating high to low, ties by title; unrated rows never count. */
export function topFive<T extends Ranked>(rows: T[]): T[] {
  return sortEntries(rows.filter((e) => e.rating !== null), 'rating').slice(0, 5);
}

/** The #1 of each list in `lists` (their order, the nav order): lists with nothing rated are skipped. */
export function numberOnes<T extends Ranked>(byCategory: Partial<Record<Category, T[]>>, lists: Category[]): T[] {
  return lists.flatMap((c) => {
    const first = topFive(byCategory[c] ?? [])[0];
    return first ? [first] : [];
  });
}
