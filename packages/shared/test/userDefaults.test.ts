import { describe, expect, it } from 'vitest';
import {
  APP_SETTING_DEFAULTS, APPLY_KEYS, COLUMN_IDS, DEFAULT_USER_SETTINGS, applyDefaults, clearPatch, defaultPatch, isCustomized, legacyCustomized,
  markCustomized, mergePatch, parseCustomized, publicAppSettings, resolveAppSettings, resolveDefaults, validateAppSetting,
  type NewPersonDefaults,
} from '../src/index';

const D = APP_SETTING_DEFAULTS.defaults;
const v = (x: unknown) => validateAppSetting('defaults', x);

describe('defaults validator (every per-person setting)', () => {
  it('an empty object gives the built-ins, and a partial one keeps its own values', () => {
    expect(v({})).toEqual({ ok: true, value: D });
    const r = v({ theme: 'Sakura', navSide: 'right', notify: { messages: false }, device: { navWidth: 300 } });
    expect(r.ok && r.value).toMatchObject({ theme: 'Sakura', navSide: 'right', lists: D.lists, notify: { ...D.notify, messages: false }, device: { navWidth: 300, chatTextSize: 100 } });
  });
  it.each([
    [{ theme: 'Custom' }], [{ theme: 'Nope' }], [{ lists: [] }], [{ lists: ['anime', 'anime'] }], [{ listOrder: ['bogus'] }], [{ compareAsk: 'x' }],
    [{ searchScope: 'x' }], [{ navSide: 'up' }], [{ navCollapsed: 'yes' }], [{ coverViewer: 1 }], [{ animeSeasons: null }], [{ notify: { messages: 'y' } }],
    [{ notify: { other: true } }], [{ unknown: 1 }], [{ device: { navWidth: 199 } }], [{ device: { navWidth: 361 } }], [{ device: { navWidth: 250.5 } }],
    [{ device: { chatTextSize: 90 } }], [{ device: { columnWidths: { nope: 100 } } }], [{ device: { columnWidths: { title: 10 } } }], [{ device: { extra: 1 } }],
  ])('refuses %j', (bad) => expect(v(bad)).toEqual({ ok: false }));
  it('stored junk falls back to the built-in defaults, and an old stored value (4 keys) still reads', () => {
    expect(resolveAppSettings([{ key: 'defaults', value_json: '{"theme":"Nope"}' }]).defaults).toEqual(D);
    expect(resolveDefaults('not json')).toEqual(D);
    expect(resolveDefaults(null)).toEqual(D);
    expect(resolveDefaults('{"lists":["anime"],"theme":"Ocean","privateByDefault":true,"notesPrivateByDefault":false}')).toMatchObject({ lists: ['anime'], theme: 'Ocean', privateByDefault: true, compareAsk: 'Both' });
  });
  it('device defaults are public, the rest of the defaults are not', () => {
    const pub = publicAppSettings(APP_SETTING_DEFAULTS);
    expect(pub.device).toEqual(D.device);
    expect(pub).not.toHaveProperty('defaults');
  });
  it('column ids match what the table knows (kept in step by a web test too)', () => {
    expect(new Set(COLUMN_IDS).size).toBe(COLUMN_IDS.length);
  });
});

describe('overlay', () => {
  const admin: NewPersonDefaults = { ...D, theme: 'Ocean', lists: ['anime', 'tv'], compareAsk: 'Off', navSide: 'right', notify: { ...D.notify, messages: false }, listOrder: ['tv', 'anime'] };

  it('every setting the person did not change takes the admin value; their own stay', () => {
    const stored = { ...DEFAULT_USER_SETTINGS, theme: 'Sakura', tabs: { ...DEFAULT_USER_SETTINGS.tabs, games: false } };
    const out = applyDefaults(stored, { theme: true, tabs: { games: true } }, admin);
    expect(out.theme).toBe('Sakura');
    expect(out.tabs).toMatchObject({ games: false, anime: true, tv: true, movies: false, animeSeasons: true });
    expect(out).toMatchObject({ compareAsk: 'Off', listOrder: ['tv', 'anime'], nav: { side: 'right', collapsed: false }, notify: { messages: false, comments: true } });
  });
  it('keeps tiers and colours as stored', () => {
    const stored = { ...DEFAULT_USER_SETTINGS, colors: { Background: '#000000' } };
    expect(applyDefaults(stored, {}, admin).colors).toEqual({ Background: '#000000' });
  });
  it('legacy accounts: only values that differ from the built-ins count as changed', () => {
    const stored = { ...DEFAULT_USER_SETTINGS, theme: 'Sakura', listOrder: ['tv' as const], nav: { side: 'left' as const, collapsed: true }, tabs: { ...DEFAULT_USER_SETTINGS.tabs, books: false } };
    expect(legacyCustomized(stored)).toEqual({ theme: true, listOrder: true, nav: { collapsed: true }, tabs: { books: true } });
    expect(legacyCustomized(DEFAULT_USER_SETTINGS)).toEqual({});
  });
  it('markCustomized adds touched paths only and parseCustomized drops junk', () => {
    expect(markCustomized({ theme: true }, { tabs: { anime: false }, nav: { side: 'right' }, coverViewer: false })).toEqual({ theme: true, tabs: { anime: true }, nav: { side: true }, coverViewer: true });
    expect(parseCustomized(undefined)).toBeNull();
    expect(parseCustomized([])).toBeNull();
    expect(parseCustomized({ theme: true, x: 'no', tabs: { a: true, b: 1 } })).toEqual({ theme: true, tabs: { a: true } });
  });
});

describe('apply patches', () => {
  it('each key writes its value and clears exactly its own marks', () => {
    for (const k of APPLY_KEYS) {
      const out = mergePatch({ ...DEFAULT_USER_SETTINGS, customized: { theme: true, compareAsk: true, searchScope: true, coverViewer: true, listOrder: true, tabs: { games: true, animeSeasons: true, tvSeasons: true }, nav: { side: true, collapsed: true }, notify: { messages: true } } },
        { ...defaultPatch(k, D), customized: clearPatch(k) }) as { customized: Parameters<typeof isCustomized>[0] };
      expect(isCustomized(out.customized, k), k).toBe(false);
    }
    const out = mergePatch({ customized: { tabs: { games: true, animeSeasons: true }, nav: { side: true, collapsed: true } } }, { ...defaultPatch('lists', D), customized: clearPatch('lists') }) as { customized: unknown };
    expect(out.customized).toEqual({ tabs: { animeSeasons: true }, nav: { side: true, collapsed: true } });
  });
  it('lists writes all nine switches from the chosen lists', () => {
    expect(defaultPatch('lists', { ...D, lists: ['anime'] })).toEqual({ tabs: expect.objectContaining({ anime: true, movies: false, youtube: false }) });
  });
  it('mergePatch follows RFC 7396 (null deletes, arrays replace)', () => {
    expect(mergePatch({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { b: null }, l: [3] })).toEqual({ a: { c: 2 }, l: [3] });
  });
});
