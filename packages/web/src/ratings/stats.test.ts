import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { computeStats, ratingDistribution } from './stats';

const anime = () => [
  makeEntry({ category: 'anime', rating: 9, status: 'Watching / In Progress' }),
  makeEntry({ category: 'anime', rating: 8, status: 'Watching / In Progress' }),
  makeEntry({ category: 'anime', rating: null, status: 'Completed' }),
];

describe('computeStats', () => {
  it('counts, averages and finds the highest per list and overall', () => {
    const movies = [makeEntry({ category: 'albums', rating: 7 })];
    const s = computeStats({ anime: anime(), albums: movies }, ['anime', 'albums']);
    expect(s.lists.map((l) => l.category)).toEqual(['anime', 'albums']);
    expect(s.lists[0]).toMatchObject({ entries: 3, rated: 2, average: 8.5, completed: 1, highest: 9 });
    expect(s.lists[1]).toMatchObject({ entries: 1, rated: 1, average: 7, completed: null, highest: 7 });
    expect(s.all).toEqual({ entries: 4, rated: 3, average: 8, completed: 1, highest: 9 });
  });

  it('averages over every rated entry, not a mean of the lists', () => {
    const s = computeStats({
      anime: [makeEntry({ rating: 10 }), makeEntry({ rating: 10 }), makeEntry({ rating: 10 })],
      albums: [makeEntry({ category: 'albums', rating: 6 })],
    }, ['anime', 'albums']);
    expect(s.all.average).toBe(9);
  });

  it('only counts enabled lists, in the order given, and treats a missing list as empty', () => {
    const s = computeStats({ anime: anime(), albums: [makeEntry({ category: 'albums', rating: 1 })] }, ['games', 'anime']);
    expect(s.lists.map((l) => l.category)).toEqual(['games', 'anime']);
    expect(s.lists[0]).toEqual({ category: 'games', entries: 0, rated: 0, average: null, completed: 0, highest: null, tiers: [0, 0, 0, 0] });
    expect(s.all.entries).toBe(3);
  });

  it('has nulls, not zeros, when nothing is rated; completed stays null with no Status list', () => {
    const s = computeStats({ albums: [makeEntry({ category: 'albums', rating: null })] }, ['albums']);
    expect(s.all).toEqual({ entries: 1, rated: 0, average: null, completed: null, highest: null });
  });

  it('groups anime by genre: once per entry, case-insensitive, first spelling wins, sorted', () => {
    const s = computeStats({
      anime: [
        makeEntry({ genres: 'Action, Drama', rating: 9 }),
        makeEntry({ genres: 'action,  Comedy', rating: 7 }),
        makeEntry({ genres: '' }),
        makeEntry({ genres: 'Drama, drama, , Zen', rating: null }),
      ],
    }, ['anime']);
    expect(s.animeGenres).toEqual([
      { genre: 'Action', count: 2, average: 8 },
      { genre: 'Drama', count: 2, average: 9 },
      { genre: 'Comedy', count: 1, average: 7 },
      { genre: 'Zen', count: 1, average: null },
    ]);
  });

  it('has no genres when Anime is off', () => {
    expect(computeStats({ anime: [makeEntry({ genres: 'Action', rating: 9 })] }, ['albums']).animeGenres).toEqual([]);
  });
});

describe('ratingDistribution', () => {
  it('buckets by whole part, clamped to 1..10', () => {
    const d = ratingDistribution({ anime: [10, 9.5, 9.99, 9, 8, 0.5, null].map((rating) => makeEntry({ rating })) }, ['anime']);
    expect(d).toEqual([1, 0, 0, 0, 0, 0, 0, 1, 3, 1]);
  });
});

describe('tier counts', () => {
  it('stats count titles per tier per list; unrated and pre-3c rows count in none; All media has none', () => {
    const rows = [
      makeEntry({ category: 'anime', rating: 9.5, tier: 3 }),
      makeEntry({ category: 'anime', rating: 9.1, tier: 3 }),
      makeEntry({ category: 'anime', rating: 8, tier: 2 }),
      makeEntry({ category: 'anime', rating: 2, tier: 0 }),
      makeEntry({ category: 'anime', rating: null, tier: null }),
      makeEntry({ category: 'anime', rating: 7 }),
    ];
    delete (rows[5] as { tier?: unknown }).tier; // a pre-3c cached row
    const s = computeStats({ anime: rows, albums: [makeEntry({ category: 'albums', rating: 6, tier: 1 })] }, ['anime', 'albums']);
    expect(s.lists[0]!.tiers).toEqual([1, 0, 1, 2]);
    expect(s.lists[1]!.tiers).toEqual([0, 1, 0, 0]);
    expect('tiers' in s.all).toBe(false);
  });
});
