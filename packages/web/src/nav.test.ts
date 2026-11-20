import { describe, expect, it } from 'vitest';
import { NEW_LIST_DEFAULTS, type CustomList } from '@media-tracker/shared';
import { enabledLists, homePath, isCategory, LIST_ORDER, orderedLists, tabSwitches } from './nav';

const tabs = (off: string[] = []) => ({ tabs: Object.fromEntries(off.map((k) => [k, false])) as Record<string, boolean> });
const lists = (order: readonly (typeof LIST_ORDER)[number][], hidden: readonly (typeof LIST_ORDER)[number][] = []) => ({ order: [...order], hidden: [...hidden] });

describe('enabledLists with the admin lists setting (AD11)', () => {
  it('is the built-in order without one', () => {
    expect(enabledLists(tabs())).toEqual(LIST_ORDER);
  });

  it('follows the admin order and drops lists hidden for everyone and lists the person turned off', () => {
    const order = ['games', 'anime', 'movies', 'tv', 'albums', 'songs', 'books', 'manga', 'youtube'] as const;
    expect(enabledLists(tabs(['tv']), lists(order, ['movies']))).toEqual(['games', 'anime', 'albums', 'songs', 'books', 'manga', 'youtube']);
  });

  it('a hidden list stays off even when the person has it on', () => {
    expect(enabledLists(tabs(), lists(LIST_ORDER, ['anime']))).not.toContain('anime');
  });

  it('Home lands on the first list shown', () => {
    expect(homePath(tabs(), lists(['games', ...LIST_ORDER.filter((c) => c !== 'games')]))).toBe('/list/games');
  });

  it('Settings tab switches follow the order, skip hidden lists, and end with the season tabs', () => {
    const keys = tabSwitches(lists(['games', ...LIST_ORDER.filter((c) => c !== 'games')], ['anime'])).map((s) => s.key);
    expect(keys[0]).toBe('games');
    expect(keys).not.toContain('anime');
    expect(keys.slice(-2)).toEqual(['animeSeasons', 'tvSeasons']);
  });
});

describe('custom lists in the nav (Phase 7)', () => {
  const mk = (id: string, name: string, createdAt: string): CustomList => ({ ...NEW_LIST_DEFAULTS, id, key: `c_${id}`, name, noun: 'thing', icon: '🍜', createdAt });
  const custom = [mk('aaaaaa1', 'Restaurants', '2026-11-20T01:00:00Z'), mk('bbbbbb2', 'Bars', '2026-11-20T02:00:00Z')];

  it('come after the built-in lists, oldest first, unless your own order places them', () => {
    expect(orderedLists({}, undefined, custom)).toEqual([...LIST_ORDER, 'c_aaaaaa1', 'c_bbbbbb2']);
    expect(orderedLists({ listOrder: ['c_bbbbbb2', 'anime'] }, undefined, custom).slice(0, 3)).toEqual(['c_bbbbbb2', 'anime', 'movies']);
    // A deleted list named in your order is ignored.
    expect(orderedLists({ listOrder: ['c_gone999'] }, undefined, custom)).not.toContain('c_gone999');
  });

  it('are on unless turned off, and the admin hiding a built-in list does not touch them', () => {
    expect(enabledLists(tabs(['c_aaaaaa1']), lists(LIST_ORDER, ['anime']), custom)).toEqual([...LIST_ORDER.filter((c) => c !== 'anime'), 'c_bbbbbb2']);
  });

  it('show in Settings → Tabs with their emoji, marked as custom, before the season switches', () => {
    const rows = tabSwitches(undefined, [], custom);
    expect(rows.slice(LIST_ORDER.length, LIST_ORDER.length + 2)).toEqual([
      { key: 'c_aaaaaa1', label: '🍜 Restaurants', custom: true }, { key: 'c_bbbbbb2', label: '🍜 Bars', custom: true },
    ]);
    expect(rows.slice(-2).map((r) => r.key)).toEqual(['animeSeasons', 'tvSeasons']);
  });

  it('a custom key is a list only when it is yours', () => {
    expect(isCategory('c_aaaaaa1', custom)).toBe(true);
    expect(isCategory('c_zzzzzz9', custom)).toBe(false);
    expect(isCategory('anime', [])).toBe(true);
    expect(homePath(tabs([...LIST_ORDER]), undefined, custom)).toBe('/list/c_aaaaaa1');
  });
});
