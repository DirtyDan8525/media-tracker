import { describe, expect, it } from 'vitest';
import { sortEntries } from './sort';

const row = (title: string, rating: number | null, releaseDate = '') => ({ title, rating, releaseDate });

describe('sortEntries', () => {
  it('rating: highest first, unrated last, then by title', () => {
    const rows = [row('A', null), row('C', 7), row('B', 9.5), row('D', 7)];
    expect(sortEntries(rows, 'rating').map((r) => r.title)).toEqual(['B', 'C', 'D', 'A']);
  });
  it('rating: ties and unrated compare titles case-insensitively', () => {
    const rows = [row('b', null), row('A', null), row('c', 8), row('B', 8)];
    expect(sortEntries(rows, 'rating').map((r) => r.title)).toEqual(['B', 'c', 'A', 'b']);
  });
  it('release date: newest first, a bare year counts as that year, undated last', () => {
    const rows = [row('Old', 5, '1998'), row('None', 9), row('New', 5, '2023-09-29'), row('Mid', 5, '2010-04-01')];
    expect(sortEntries(rows, 'release').map((r) => r.title)).toEqual(['New', 'Mid', 'Old', 'None']);
  });
  it('release date: same year orders by the full date, bare year as 1 January', () => {
    const rows = [row('Y', 1, '2023'), row('Late', 1, '2023-11-02'), row('Early', 1, '2023-03-01')];
    expect(sortEntries(rows, 'release').map((r) => r.title)).toEqual(['Late', 'Early', 'Y']);
  });
  it('title: alphabetical, ignoring case, and does not mutate the input', () => {
    const rows = [row('b', 1), row('C', 2), row('a', 3)];
    expect(sortEntries(rows, 'title').map((r) => r.title)).toEqual(['a', 'b', 'C']);
    expect(rows.map((r) => r.title)).toEqual(['b', 'C', 'a']);
  });
});
