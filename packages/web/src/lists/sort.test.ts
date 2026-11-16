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

  it('equal shown score: higher tier first, then stronger first', () => {
    const r = (id: string, tier: 0 | 1 | 2 | 3 | null, strength: number | null, rating = 9) => ({ id, title: 'T', rating, releaseDate: '', tier, strength });
    const rows = [r('weak', 3, 0.1), r('low-tier', 2, 5), r('strong', 3, 1.2), r('none', null, null)];
    expect(sortEntries(rows, 'rating').map((x) => x.id)).toEqual(['strong', 'weak', 'low-tier', 'none']);
  });
  it('a different shown score still wins over tier and strength', () => {
    const rows = [
      { id: 'a', title: 'A', rating: 8.9, releaseDate: '', tier: 3 as const, strength: 9 },
      { id: 'b', title: 'B', rating: 9.1, releaseDate: '', tier: 2 as const, strength: -3 },
    ];
    expect(sortEntries(rows, 'rating').map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('a pre-3c cached row (no tier fields) sorts as unrated tier without throwing', () => {
    const old = { id: 'old', title: 'Old', rating: 9, releaseDate: '' }; // no tier/strength at all
    const fresh = { id: 'new', title: 'New', rating: 9, releaseDate: '', tier: 3 as const, strength: 0.5 };
    const rows = [old, fresh, { ...old, id: 'old2', title: 'Old2' }];
    expect(() => sortEntries(rows, 'rating')).not.toThrow();
    expect(sortEntries(rows, 'rating').map((x) => x.id)).toEqual(['new', 'old', 'old2']);
    expect(sortEntries([...rows].reverse(), 'rating').map((x) => x.id)).toEqual(['new', 'old', 'old2']);
  });
});
