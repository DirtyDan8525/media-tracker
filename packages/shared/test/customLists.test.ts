import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CATEGORIES, CATEGORY_CONFIG, NEW_LIST_DEFAULTS, customKey, findDuplicate, isCategoryKey, isCustomCategory, isLinkUrl,
  isOneEmoji, listConfig, listTitle, parseCustomListsJson, showsProgress, statusLabel, validateCustomList, type CustomList,
} from '../src';

const list = (over: Partial<CustomList> = {}): CustomList => ({
  ...NEW_LIST_DEFAULTS, id: 'abc123defg', key: customKey('abc123defg'), name: 'Restaurants', noun: 'restaurant', icon: '🍜',
  creatorLabel: 'Cuisine', statusWords: 'try', showLink: true, createdAt: '2026-11-20T00:00:00Z', ...over,
});

describe('list keys', () => {
  it('tells built-in and custom keys apart', () => {
    expect(isCustomCategory('c_abc123defg')).toBe(true);
    expect(isCustomCategory('c_AB')).toBe(false);
    expect(isCustomCategory('anime')).toBe(false);
    expect(isCategoryKey('anime')).toBe(true);
    expect(isCategoryKey('c_abc123')).toBe(true);
    expect(isCategoryKey('restaurants')).toBe(false);
  });
});

describe('listConfig', () => {
  it('built-in lists keep their config', () => {
    for (const c of BUILTIN_CATEGORIES) expect(listConfig(c)).toMatchObject({ ...CATEGORY_CONFIG[c], custom: false, key: c, lookup: c });
    expect(listConfig('tv')).toMatchObject({ label: 'TV Shows', noun: 'TV show', hasProgress: true, originLabel: 'Network' });
  });

  it('a custom list resolves from the lists given', () => {
    const l = list();
    const cfg = listConfig(l.key, [l]);
    expect(cfg).toMatchObject({
      custom: true, label: 'Restaurants', noun: 'restaurant', icon: '🍜', titleLabel: 'Name', creatorLabel: 'Cuisine',
      hasStatus: true, hasSeasons: false, hasProgress: false, showLink: true, lookup: null, statusWords: 'try',
    });
    expect(listConfig(l.key, new Map([[l.key, l]])).label).toBe('Restaurants');
    expect(listTitle(l.key, [l])).toBe('🍜 Restaurants');
    expect(listTitle('anime')).toBe('Anime');
  });

  it('a search source borrows that list\'s lookup and cover shape', () => {
    expect(listConfig(customKey('m1m1m1'), [list({ id: 'm1m1m1', key: 'c_m1m1m1', searchSource: 'music' })])).toMatchObject({ lookup: 'albums', square: true, creatorIsSearchHint: true });
    expect(listConfig(customKey('b1b1b1'), [list({ id: 'b1b1b1', key: 'c_b1b1b1', searchSource: 'books' })])).toMatchObject({ lookup: 'books', square: false, originLabel: 'Publisher' });
  });

  it('an unknown custom key is a plain list', () => {
    expect(listConfig('c_gone123', [])).toMatchObject({ label: 'List', custom: true, hasStatus: false, lookup: null });
  });

  it('progress shows on a custom list only with its Progress column', () => {
    const e = { category: 'c_abc123defg' as const, status: 'Watching / In Progress' as const };
    expect(showsProgress(e)).toBe(false);
    expect(showsProgress(e, true)).toBe(true);
    expect(showsProgress({ category: 'anime', status: 'Watching / In Progress' })).toBe(true);
  });
});

describe('statusLabel on custom lists', () => {
  it('uses the chosen words; the stored value never changes', () => {
    const lists = [list(), list({ id: 'r2r2r2', key: 'c_r2r2r2', statusWords: 'read' }), list({ id: 'w2w2w2', key: 'c_w2w2w2', statusWords: 'watch' })];
    expect(statusLabel('Plan to watch', 'c_abc123defg', lists)).toBe('Want to try');
    expect(statusLabel('Watching / In Progress', 'c_abc123defg', lists)).toBe('Trying');
    expect(statusLabel('Completed', 'c_abc123defg', lists)).toBe('Been');
    expect(statusLabel('Dropped', 'c_abc123defg', lists)).toBe('Dropped');
    expect(statusLabel('Plan to watch', 'c_r2r2r2', lists)).toBe('Plan to read');
    expect(statusLabel('Completed', 'c_w2w2w2', lists)).toBe('Completed');
    expect(statusLabel('Plan to watch', 'games')).toBe('Plan to play');
  });
});

describe('validateCustomList', () => {
  it('fills defaults on create and trims text', () => {
    const v = validateCustomList({ name: '  Wine   bars ', noun: ' bar ' }, 'create');
    expect(v).toEqual({ ok: true, value: { ...NEW_LIST_DEFAULTS, name: 'Wine bars', noun: 'bar' } });
  });

  it('a patch carries only what was sent', () => {
    expect(validateCustomList({ showYear: true, creatorLabel: '' }, 'patch')).toEqual({ ok: true, value: { showYear: true, creatorLabel: null } });
  });

  it('names what is wrong', () => {
    expect(validateCustomList({ noun: 'x' }, 'create')).toEqual({ ok: false, error: 'name' });
    expect(validateCustomList({ name: 'x' }, 'create')).toEqual({ ok: false, error: 'noun' });
    expect(validateCustomList({ name: 'x'.repeat(41), noun: 'x' }, 'create')).toEqual({ ok: false, error: 'name' });
    expect(validateCustomList({ icon: '🍜🍣' }, 'patch')).toEqual({ ok: false, error: 'icon' });
    expect(validateCustomList({ statusWords: 'eat' }, 'patch')).toEqual({ ok: false, error: 'statusWords' });
    expect(validateCustomList({ searchSource: 'anime' }, 'patch')).toEqual({ ok: false, error: 'searchSource' });
    expect(validateCustomList({ hasStatus: 1 }, 'patch')).toEqual({ ok: false, error: 'invalid' });
    expect(validateCustomList(null, 'patch')).toEqual({ ok: false, error: 'invalid' });
  });

  it('accepts one emoji, including joined and flag emoji', () => {
    for (const ok of ['', '🍜', '👩🏽‍🍳', '🇯🇵', '❤️']) expect(isOneEmoji(ok)).toBe(true);
    for (const bad of ['a', '🍜🍣', ':)', '🍜 ']) expect(isOneEmoji(bad)).toBe(false);
  });

  it('links are http(s) only', () => {
    expect(isLinkUrl('')).toBe(true);
    expect(isLinkUrl('https://maps.example.com/x')).toBe(true);
    expect(isLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isLinkUrl('not a url')).toBe(false);
  });
});

describe('parseCustomListsJson', () => {
  it('reads server rows (0/1 switches, NULL icon) and drops junk', () => {
    const json = JSON.stringify([
      { id: 'abc123defg', name: 'Restaurants', noun: 'restaurant', icon: null, creator_label: null, has_status: 1, status_words: 'try', show_tags: 1, show_year: 0, show_genres: 0, show_progress: 0, show_link: 1, search_source: null, created_at: 'x' },
      { nope: true },
    ]);
    expect(parseCustomListsJson(json)).toEqual([list({ icon: '', creatorLabel: null, createdAt: 'x' })]);
    expect(parseCustomListsJson('oops')).toEqual([]);
    expect(parseCustomListsJson(null)).toEqual([]);
  });
});

describe('findDuplicate on custom lists', () => {
  it('compares names, and the second line only when one was typed', () => {
    const rows = [{ id: '1', title: "Joe's Pho", creator: 'Vietnamese' }];
    expect(findDuplicate(rows, { title: "joe's pho", creator: '' }, 'c_abc123defg')).toBe('1');
    expect(findDuplicate(rows, { title: "Joe's Pho", creator: 'Thai' }, 'c_abc123defg')).toBeNull();
  });
});

describe('admin Defaults leave custom lists alone', () => {
  it('applyDefaults keeps a custom list switch; the lists patch names built-in lists only', async () => {
    const { APP_SETTING_DEFAULTS, DEFAULT_USER_SETTINGS, applyDefaults, defaultPatch, legacyCustomized, validateAppSetting } = await import('../src');
    const stored = { ...DEFAULT_USER_SETTINGS, tabs: { ...DEFAULT_USER_SETTINGS.tabs, c_abc123defg: false }, listOrder: ['c_abc123defg' as const, 'anime' as const] };
    const d = { ...APP_SETTING_DEFAULTS.defaults, lists: ['anime' as const] };
    const out = applyDefaults(stored, legacyCustomized(stored), d);
    expect(out.tabs.c_abc123defg).toBe(false);
    expect(out.tabs.movies).toBe(false);
    expect(Object.keys((defaultPatch('lists', d) as { tabs: object }).tabs)).toEqual([...BUILTIN_CATEGORIES]);
    // A custom key can't be an admin default.
    expect(validateAppSetting('defaults', { ...d, listOrder: ['c_abc123defg'] }).ok).toBe(false);
  });
});
