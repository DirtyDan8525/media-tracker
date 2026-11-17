import { describe, expect, it } from 'vitest';
import { CATEGORY_CONFIG, COMPARE_ASK, DEFAULT_USER_SETTINGS, ORIGIN_LABEL } from '../src/index';

describe('DEFAULT_USER_SETTINGS', () => {
  it('has every Sheet tab switch, including the season tabs', () => {
    expect(DEFAULT_USER_SETTINGS.tabs).toEqual({
      anime: true, movies: true, tv: true, albums: true, songs: true, games: true, books: true, manga: true,
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

describe('manga category', () => {
  it('is series-level: Author, a status, no seasons, a 2:3 cover', () => {
    expect(CATEGORY_CONFIG.manga).toEqual({
      titleLabel: 'Title', creatorLabel: 'Author', hasStatus: true, creatorIsSearchHint: false, square: false, hasSeasons: false,
    });
    expect(ORIGIN_LABEL.manga).toBe('Format');
  });
});
