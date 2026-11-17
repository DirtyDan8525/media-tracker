import { describe, expect, it } from 'vitest';
import {
  ACCENT_COLORS, APP_SETTING_DEFAULTS, APP_SETTING_KEYS, CATEGORY_CONFIG, FEATURE_KEYS, publicAppSettings, resolveAppSettings, tabsFor,
  validateAppSetting, type AppSettingKey,
} from '../src';

const CATS = Object.keys(CATEGORY_CONFIG);
const okVal = (k: AppSettingKey, v: unknown) => validateAppSetting(k, v);

describe('defaults', () => {
  it('every key validates as its own default, and every feature is on', () => {
    for (const k of APP_SETTING_KEYS) expect(okVal(k, APP_SETTING_DEFAULTS[k]).ok, k).toBe(true);
    expect(Object.keys(APP_SETTING_DEFAULTS.features)).toEqual([...FEATURE_KEYS]);
    expect(Object.values(APP_SETTING_DEFAULTS.features).every(Boolean)).toBe(true);
    expect(APP_SETTING_DEFAULTS.lists.order).toEqual(CATS);
  });
  it('resolveAppSettings: unset keys and corrupt or invalid rows give the default', () => {
    const r = resolveAppSettings([
      { key: 'brand', value_json: '{"name":"Our Shelf","welcome":"hi","accent":null}' },
      { key: 'features', value_json: '{"friends":"yes"}' },
      { key: 'about', value_json: 'not json' },
      { key: 'nope', value_json: '1' },
    ]);
    expect(r.brand.name).toBe('Our Shelf');
    expect(r.features).toEqual(APP_SETTING_DEFAULTS.features);
    expect(r.about).toBeNull();
  });
});

describe('features', () => {
  it('accepts booleans, fills missing keys with on, rejects unknown keys and non-booleans', () => {
    expect(okVal('features', { signups: false })).toEqual({ ok: true, value: { ...APP_SETTING_DEFAULTS.features, signups: false } });
    expect(okVal('features', { signups: 0 }).ok).toBe(false);
    expect(okVal('features', { bogus: true }).ok).toBe(false);
    expect(okVal('features', null).ok).toBe(false);
    expect(okVal('features', [true]).ok).toBe(false);
  });
});

describe('announcement', () => {
  it('trims, allows 280 characters, link must be http(s), end date a real YYYY-MM-DD', () => {
    expect(okVal('announcement', { text: '  Hi  ', link: 'https://x.test/a', endsAt: '2026-12-01' })).toEqual({
      ok: true, value: { id: '', text: 'Hi', link: 'https://x.test/a', endsAt: '2026-12-01' },
    });
    expect(okVal('announcement', { text: 'a'.repeat(280) }).ok).toBe(true);
    expect(okVal('announcement', { text: 'a'.repeat(281) }).ok).toBe(false);
    expect(okVal('announcement', { text: 'x', link: 'javascript:alert(1)' }).ok).toBe(false);
    expect(okVal('announcement', { text: 'x', link: 'x'.repeat(301) }).ok).toBe(false);
    expect(okVal('announcement', { text: 'x', endsAt: '2026-02-30' }).ok).toBe(false);
    expect(okVal('announcement', { text: 'x', endsAt: 'soon' }).ok).toBe(false);
    expect(okVal('announcement', { text: 5 }).ok).toBe(false);
    expect(okVal('announcement', { text: 'x', extra: 1 }).ok).toBe(false);
  });
});

describe('whatsNew, comingSoon, about', () => {
  it('null means the built-in text', () => {
    for (const k of ['whatsNew', 'comingSoon', 'about'] as const) expect(okVal(k, null)).toEqual({ ok: true, value: null });
  });
  it('whatsNew: releases with version, date and 1-200 character items', () => {
    const r = { version: 'Phase 6', date: '2026-11-17', items: ['A thing'] };
    expect(okVal('whatsNew', [r]).ok).toBe(true);
    expect(okVal('whatsNew', [{ ...r, date: '17 Nov' }]).ok).toBe(false);
    expect(okVal('whatsNew', [{ ...r, version: '' }]).ok).toBe(false);
    expect(okVal('whatsNew', [{ ...r, items: [''] }]).ok).toBe(false);
    expect(okVal('whatsNew', [{ ...r, items: ['x'.repeat(201)] }]).ok).toBe(false);
    expect(okVal('whatsNew', [{ ...r, items: Array(21).fill('x') }]).ok).toBe(false);
    expect(okVal('whatsNew', Array(31).fill(r)).ok).toBe(false);
    expect(okVal('whatsNew', 'text').ok).toBe(false);
  });
  it('comingSoon: up to 30 lines of 1-200 characters', () => {
    expect(okVal('comingSoon', ['One', 'Two']).ok).toBe(true);
    expect(okVal('comingSoon', ['']).ok).toBe(false);
    expect(okVal('comingSoon', Array(31).fill('x')).ok).toBe(false);
    expect(okVal('comingSoon', [1]).ok).toBe(false);
  });
  it('about: up to 2000 characters, line breaks kept', () => {
    expect(okVal('about', 'a\nb')).toEqual({ ok: true, value: 'a\nb' });
    expect(okVal('about', 'x'.repeat(2000)).ok).toBe(true);
    expect(okVal('about', 'x'.repeat(2001)).ok).toBe(false);
    expect(okVal('about', 5).ok).toBe(false);
  });
});

describe('brand', () => {
  it('name 1-40, welcome up to 200, accent from the allowed list or null', () => {
    const accent = ACCENT_COLORS[0]!;
    expect(okVal('brand', { name: ' Our Shelf ', welcome: 'Hello', accent: accent.toUpperCase() })).toEqual({
      ok: true, value: { name: 'Our Shelf', welcome: 'Hello', accent },
    });
    expect(okVal('brand', { name: 'x'.repeat(40) }).ok).toBe(true);
    expect(okVal('brand', { name: 'x'.repeat(41) }).ok).toBe(false);
    expect(okVal('brand', { name: '  ' }).ok).toBe(false);
    expect(okVal('brand', { name: 'x', welcome: 'w'.repeat(201) }).ok).toBe(false);
    expect(okVal('brand', { name: 'x', accent: '#123456' }).ok).toBe(false);
    expect(okVal('brand', { name: 'x', accent: 5 }).ok).toBe(false);
    expect(okVal('brand', { name: 'x', theme: 'Midnight' }).ok).toBe(false);
  });
});

describe('defaults for new people', () => {
  it('lists from CATEGORIES (unique, at least one), a real theme, two booleans', () => {
    expect(okVal('defaults', { lists: ['anime', 'movies'], theme: 'Ocean', privateByDefault: true, notesPrivateByDefault: true }).ok).toBe(true);
    expect(okVal('defaults', { lists: [] }).ok).toBe(false);
    expect(okVal('defaults', { lists: ['anime', 'anime'] }).ok).toBe(false);
    expect(okVal('defaults', { lists: ['podcasts'] }).ok).toBe(false);
    expect(okVal('defaults', { theme: 'Neon' }).ok).toBe(false);
    expect(okVal('defaults', { theme: 'Custom' }).ok).toBe(false);
    expect(okVal('defaults', { privateByDefault: 'yes' }).ok).toBe(false);
    expect(okVal('defaults', { notesPrivateByDefault: 1 }).ok).toBe(false);
  });
  it('tabsFor turns exactly the chosen lists on and keeps the season switches', () => {
    const tabs = tabsFor(['anime'], { anime: false, movies: true, animeSeasons: true });
    expect(tabs.anime).toBe(true);
    expect(tabs.movies).toBe(false);
    expect(tabs.animeSeasons).toBe(true);
  });
});

describe('lists', () => {
  it('order is every list once; hidden is a unique subset leaving one visible', () => {
    const reversed = [...CATS].reverse();
    expect(okVal('lists', { order: reversed, hidden: ['tv'] }).ok).toBe(true);
    expect(okVal('lists', { order: CATS.slice(1), hidden: [] }).ok).toBe(false);
    expect(okVal('lists', { order: [...CATS.slice(1), CATS[1]], hidden: [] }).ok).toBe(false);
    expect(okVal('lists', { order: CATS, hidden: ['nope'] }).ok).toBe(false);
    expect(okVal('lists', { order: CATS, hidden: CATS }).ok).toBe(false);
    expect(okVal('lists', { order: CATS, hidden: ['tv', 'tv'] }).ok).toBe(false);
  });
});

describe('publicAppSettings', () => {
  const base = resolveAppSettings([]);
  const withA = (a: object) => ({ ...base, announcement: { id: 'a1', text: 'Hi', link: null, endsAt: null, ...a } });
  it('hides an empty or ended announcement, keeps one on its last day, never carries defaults', () => {
    expect(publicAppSettings(base).announcement).toBeNull();
    const now = new Date('2026-12-01T23:00:00Z');
    expect(publicAppSettings(withA({ endsAt: '2026-12-01' }), now).announcement?.text).toBe('Hi');
    expect(publicAppSettings(withA({ endsAt: '2026-11-30' }), now).announcement).toBeNull();
    expect(publicAppSettings(withA({}), now).announcement?.id).toBe('a1');
    expect('defaults' in publicAppSettings(base)).toBe(false);
  });
});
