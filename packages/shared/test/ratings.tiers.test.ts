import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TIERS, PRIOR_CLAMP, PRIOR_SD, RATING_SETS, listOfSet, priorFromScore, round1, round2, scoreOf, seasonSetOf, sigmoid,
  tierFor, tierRange, tiersFor, validateTierSet, type Tier, type TierSet,
} from '../src/ratings';
import { DEFAULT_USER_SETTINGS, RATINGS_SAVE_MAX_DONE, RATINGS_SAVE_MAX_MOVES, RATINGS_SAVE_MAX_PICKS } from '../src/index';

describe('tiers', () => {
  test('DEFAULT_TIERS are the confirmed defaults', () => {
    expect(DEFAULT_TIERS).toEqual({ names: ["Didn't like", 'Fine', 'Liked', 'Loved'], bounds: [6, 7.5, 9] });
  });
  test('tierFor: boundaries belong to the higher tier', () => {
    expect([0, 5.99, 6, 7.49, 7.5, 8.99, 9, 9.97, 10].map((s) => tierFor(s, DEFAULT_TIERS))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
  });
  test('tierRange', () => {
    expect([0, 1, 2, 3].map((t) => tierRange(DEFAULT_TIERS, t as Tier))).toEqual([[0, 6], [6, 7.5], [7.5, 9], [9, 10]]);
  });
  test('priorFromScore inverts scoreOf inside 3-97%', () => {
    for (const s of [9.5, 9.03, 9.97, 8.25]) {
      const range = tierRange(DEFAULT_TIERS, tierFor(s, DEFAULT_TIERS));
      expect(scoreOf(priorFromScore(s, range), range)).toBeCloseTo(s, 12);
    }
  });
  test('priorFromScore clamps to 3-97%', () => {
    expect(scoreOf(priorFromScore(10, [9, 10]), [9, 10])).toBeCloseTo(9.97, 12);
    expect(scoreOf(priorFromScore(9, [9, 10]), [9, 10])).toBeCloseTo(9.03, 12);
    expect(scoreOf(priorFromScore(0, [0, 6]), [0, 6])).toBeCloseTo(0.18, 12);
  });
  test('validateTierSet', () => {
    expect(validateTierSet({ names: [' Meh ', 'Ok', 'Good', 'Great'], bounds: [5, 7, 8.5] })).toEqual({ names: ['Meh', 'Ok', 'Good', 'Great'], bounds: [5, 7, 8.5] });
    expect(validateTierSet(DEFAULT_TIERS)).toEqual(DEFAULT_TIERS);
    for (const bad of [
      { names: ['a', 'A', 'b', 'c'], bounds: [6, 7.5, 9] },      // duplicate ignoring case
      { names: ['', 'b', 'c', 'd'], bounds: [6, 7.5, 9] },       // empty name
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 6.4, 9] },      // tier narrower than 0.5
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.55, 9] },     // two decimals
      { names: ['a', 'b', 'c', 'd'], bounds: [0, 7.5, 9] },      // b1 must be > 0
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 9.6, 9] },      // not increasing
    ]) expect(validateTierSet(bad)).toBeNull();
  });
  test('validateTierSet rejects malformed input', () => {
    for (const bad of [
      null, undefined, 'x', 3, [], {},
      { names: ['a', 'b', 'c'], bounds: [6, 7.5, 9] },                 // three names
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.5] },               // two bounds
      { names: ['a', 'b', 'c', 1], bounds: [6, 7.5, 9] },              // not a string
      { names: ['a', 'b', 'c', 'd'], bounds: [6, '7.5', 9] },          // not a number
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.5, NaN] },
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.5, 9.6] },          // top tier narrower than 0.5
      { names: ['a', 'b', 'c', 'd'], bounds: [0.4, 7.5, 9] },          // bottom tier narrower than 0.5
      { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.5, 10] },           // b3 must be < 10
      { names: ['a', 'b', 'c', 'x'.repeat(21)], bounds: [6, 7.5, 9] }, // name over 20 characters
      { names: ['a', 'b', 'c', '   '], bounds: [6, 7.5, 9] },          // blank after trimming
    ]) expect(validateTierSet(bad)).toBeNull();
    // Exactly 0.5 wide everywhere and 20-character names are allowed.
    expect(validateTierSet({ names: ['a', 'b', 'c', 'x'.repeat(20)], bounds: [0.5, 1, 9.5] })).not.toBeNull();
    expect(validateTierSet({ names: ['a', 'b', 'c', 'd'], bounds: [0.6, 1.1, 1.6] })).not.toBeNull();
  });
  test('tiersFor: per list, seasons use the parent list, defaults when unset', () => {
    const mine: TierSet = { names: ['a', 'b', 'c', 'd'], bounds: [5, 7, 8.5] };
    expect(tiersFor({ tiers: { anime: mine } }, 'anime_seasons')).toBe(mine);
    expect(tiersFor({ tiers: { anime: mine } }, 'anime')).toBe(mine);
    expect(tiersFor({ tiers: { anime: mine } }, 'movies')).toBe(DEFAULT_TIERS);
    expect(tiersFor({ tiers: { tv: mine } }, 'tv_seasons')).toBe(mine);
    expect(tiersFor(DEFAULT_USER_SETTINGS, 'books')).toBe(DEFAULT_TIERS);
    // Pre-3c settings have no tiers key at all.
    expect(tiersFor({} as never, 'books')).toBe(DEFAULT_TIERS);
  });
  test('rating sets: every list plus the two season tabs', () => {
    expect(RATING_SETS).toEqual(['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga', 'youtube', 'anime_seasons', 'tv_seasons']);
    expect(RATING_SETS.map(listOfSet)).toEqual(['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga', 'youtube', 'anime', 'tv']);
    expect(seasonSetOf('anime')).toBe('anime_seasons');
    expect(seasonSetOf('tv')).toBe('tv_seasons');
    expect(seasonSetOf('movies')).toBeNull();
  });
  test('DEFAULT_USER_SETTINGS has empty tiers (every list on defaults)', () => {
    expect(DEFAULT_USER_SETTINGS.tiers).toEqual({});
  });
});

describe('score helpers', () => {
  test('constants', () => {
    expect(PRIOR_SD).toBe(1.0);
    expect(PRIOR_CLAMP).toBe(0.03);
    expect([RATINGS_SAVE_MAX_PICKS, RATINGS_SAVE_MAX_MOVES, RATINGS_SAVE_MAX_DONE]).toEqual([1000, 1000, 50]);
  });
  test('sigmoid and scoreOf', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(scoreOf(0, [7.5, 9])).toBe(8.25);
    expect(scoreOf(1000, [9, 10])).toBe(10);
    expect(scoreOf(-1000, [9, 10])).toBe(9);
  });
  test('round1 and round2', () => {
    expect([round1(9.96), round1(9.04), round1(8.25), round2(9.976), round2(8.624)]).toEqual([10, 9, 8.3, 9.98, 8.62]);
  });
});
