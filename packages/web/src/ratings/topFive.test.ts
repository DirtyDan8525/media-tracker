import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { topFive } from './topFive';

describe('topFive', () => {
  it('keeps the five best rated rows, ties in title order, no unrated', () => {
    const rows = [
      makeEntry({ title: 'Zeta', rating: 9.5 }),
      makeEntry({ title: 'Unrated', rating: null }),
      makeEntry({ title: 'Alpha', rating: 9.5 }),
      makeEntry({ title: 'C', rating: 7 }),
      makeEntry({ title: 'D', rating: 8 }),
      makeEntry({ title: 'E', rating: 6 }),
      makeEntry({ title: 'F', rating: 5 }),
    ];
    const top = topFive(rows);
    expect(top.map((e) => e.title)).toEqual(['Alpha', 'Zeta', 'D', 'C', 'E']);
  });

  it('returns fewer than five when fewer are rated, and nothing for no ratings', () => {
    expect(topFive([makeEntry({ rating: 3 }), makeEntry({ rating: null })])).toHaveLength(1);
    expect(topFive([makeEntry({ rating: null })])).toEqual([]);
    expect(topFive([])).toEqual([]);
  });

  it('does not change its input', () => {
    const rows = [makeEntry({ title: 'B', rating: 1 }), makeEntry({ title: 'A', rating: 2 })];
    topFive(rows);
    expect(rows.map((e) => e.title)).toEqual(['B', 'A']);
  });
});
