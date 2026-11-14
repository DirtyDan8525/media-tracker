import type { Entry } from '@media-tracker/shared';
import { sortEntries } from '../lists/sort';

/** The five best-rated rows of a list: rating high to low, ties by title; unrated rows never count. */
export function topFive(rows: Entry[]): Entry[] {
  return sortEntries(rows.filter((e) => e.rating !== null), 'rating').slice(0, 5);
}
