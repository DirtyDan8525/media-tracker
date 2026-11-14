import { describe, expect, it } from 'vitest';
import { COMPARE_ASK, COMPARE_ROOM, COMPARE_STYLE, DEFAULT_USER_SETTINGS } from '../src/index';

describe('DEFAULT_USER_SETTINGS', () => {
  it('has every Sheet tab switch, including the season tabs', () => {
    expect(DEFAULT_USER_SETTINGS.tabs).toEqual({
      anime: true, movies: true, tv: true, albums: true, songs: true, games: true, books: true,
      animeSeasons: true, tvSeasons: true,
    });
  });
  it('defaults are members of the compare option lists', () => {
    expect(COMPARE_ASK).toContain(DEFAULT_USER_SETTINGS.compareAsk);
    expect(COMPARE_STYLE).toContain(DEFAULT_USER_SETTINGS.compareStyle);
    expect(COMPARE_ROOM).toContain(DEFAULT_USER_SETTINGS.compareRoom);
  });
});
