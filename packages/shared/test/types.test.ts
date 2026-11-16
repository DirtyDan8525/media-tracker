import { describe, expect, it } from 'vitest';
import { COMPARE_ASK, DEFAULT_USER_SETTINGS } from '../src/index';

describe('DEFAULT_USER_SETTINGS', () => {
  it('has every Sheet tab switch, including the season tabs', () => {
    expect(DEFAULT_USER_SETTINGS.tabs).toEqual({
      anime: true, movies: true, tv: true, albums: true, songs: true, games: true, books: true,
      animeSeasons: true, tvSeasons: true,
    });
  });
  it('the default is a member of the compare option list', () => {
    expect(COMPARE_ASK).toContain(DEFAULT_USER_SETTINGS.compareAsk);
  });
  it('has no Sheet compare-engine settings (Ruling Q1)', () => {
    for (const k of ['compareStyle', 'compareRoom', 'compareWindow']) expect(k in DEFAULT_USER_SETTINGS).toBe(false);
  });
});
