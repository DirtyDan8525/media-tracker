import { describe, expect, it } from 'vitest';
import { enabledLists, homePath, LIST_ORDER, tabSwitches } from './nav';

const tabs = (off: string[] = []) => ({ tabs: Object.fromEntries(off.map((k) => [k, false])) as Record<string, boolean> });
const lists = (order: typeof LIST_ORDER, hidden: typeof LIST_ORDER = []) => ({ order: [...order], hidden: [...hidden] });

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
