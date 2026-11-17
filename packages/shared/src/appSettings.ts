/**
 * App-wide settings the admin edits (Phase 6c, docs/plans/2026-11-17-phase6c-admin.md, AD1-AD11).
 * One record per key in `app_settings`. The server validates every PUT with `validateAppSetting`
 * and reads stored values with `resolveAppSettings`, which falls back to the default for any
 * key that is unset or no longer valid.
 */
import { CATEGORY_CONFIG, type Category } from './types';
import { THEMES } from './theme';

export const APP_SETTING_KEYS = ['features', 'announcement', 'whatsNew', 'comingSoon', 'about', 'brand', 'defaults', 'lists'] as const;
export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as Category[];

/** AD2: every switch is on by default. */
export const FEATURE_KEYS = ['signups', 'friends', 'feed', 'comments', 'reactions', 'messages', 'closeCalls', 'walkthrough', 'installBanner'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

export interface Announcement {
  /** New on every save, so a dismissed banner comes back when the text changes. Empty when there is none. */
  id: string;
  text: string;
  link: string | null;
  /** YYYY-MM-DD, the last day it shows; null = until removed. */
  endsAt: string | null;
}

export interface Release {
  version: string;
  date: string;
  items: string[];
}

export interface Brand {
  name: string;
  welcome: string;
  /** One of ACCENT_COLORS; null = the theme's own highlight. */
  accent: string | null;
}

export interface NewPersonDefaults {
  lists: Category[];
  theme: string;
  privateByDefault: boolean;
  notesPrivateByDefault: boolean;
}

export interface ListsSetting {
  /** Every list once, in display order. */
  order: Category[];
  hidden: Category[];
}

export interface AppSettings {
  features: Features;
  announcement: Announcement;
  /** null = the app's built-in text (AD4). */
  whatsNew: Release[] | null;
  comingSoon: string[] | null;
  about: string | null;
  brand: Brand;
  defaults: NewPersonDefaults;
  lists: ListsSetting;
}

export const ANNOUNCEMENT_MAX = 280;
export const LINK_MAX = 300;
export const BRAND_NAME_MAX = 40;
export const BRAND_WELCOME_MAX = 200;
export const ABOUT_MAX = 2000;
export const WHATS_NEW_MAX_RELEASES = 30;
export const RELEASE_VERSION_MAX = 40;
export const RELEASE_ITEMS_MAX = 20;
export const ITEM_MAX = 200;
export const COMING_SOON_MAX = 30;

/** The accents an admin may pick: the highlight colours of the built-in themes (each was checked for AA contrast on its own theme). */
export const ACCENT_COLORS: readonly string[] = [...new Set(Object.values(THEMES).map((t) => t['Highlight']!.toLowerCase()))];

export const APP_SETTING_DEFAULTS: AppSettings = {
  features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Features,
  announcement: { id: '', text: '', link: null, endsAt: null },
  whatsNew: null,
  comingSoon: null,
  about: null,
  brand: { name: 'Media Tracker', welcome: '', accent: null },
  defaults: { lists: [...ALL_CATEGORIES], theme: 'Midnight', privateByDefault: false, notesPrivateByDefault: false },
  lists: { order: [...ALL_CATEGORIES], hidden: [] },
};

export type Validated<T> = { ok: true; value: T } | { ok: false };
const bad = { ok: false } as const;
const ok = <T>(value: T): Validated<T> => ({ ok: true, value });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnly = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const isStr = (v: unknown, max: number, min = 0): v is string => typeof v === 'string' && v.length >= min && v.length <= max;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);
const isCategory = (v: unknown): v is Category => typeof v === 'string' && Object.hasOwn(CATEGORY_CONFIG, v);
/** A list of unique categories (each exactly once). */
const categoryList = (v: unknown): Category[] | null =>
  Array.isArray(v) && v.every(isCategory) && new Set(v).size === v.length ? (v as Category[]) : null;
const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

function features(v: unknown): Validated<Features> {
  if (!isObj(v) || !hasOnly(v, FEATURE_KEYS)) return bad;
  const out = { ...APP_SETTING_DEFAULTS.features };
  for (const k of FEATURE_KEYS) {
    if (!(k in v)) continue;
    if (typeof v[k] !== 'boolean') return bad;
    out[k] = v[k];
  }
  return ok(out);
}

function announcement(v: unknown): Validated<Announcement> {
  if (!isObj(v) || !hasOnly(v, ['id', 'text', 'link', 'endsAt'])) return bad;
  const text = typeof v.text === 'string' ? v.text.trim() : null;
  if (text === null || text.length > ANNOUNCEMENT_MAX) return bad;
  const link = v.link === undefined || v.link === null || v.link === '' ? null : v.link;
  if (link !== null && !(isStr(link, LINK_MAX, 1) && isHttpUrl(link))) return bad;
  const endsAt = v.endsAt === undefined || v.endsAt === null || v.endsAt === '' ? null : v.endsAt;
  if (endsAt !== null && !isDate(endsAt)) return bad;
  if (v.id !== undefined && !isStr(v.id, 64)) return bad;
  return ok({ id: typeof v.id === 'string' ? v.id : '', text, link, endsAt });
}

function whatsNew(v: unknown): Validated<Release[] | null> {
  if (v === null) return ok(null);
  if (!Array.isArray(v) || v.length > WHATS_NEW_MAX_RELEASES) return bad;
  const out: Release[] = [];
  for (const r of v) {
    if (!isObj(r) || !hasOnly(r, ['version', 'date', 'items'])) return bad;
    if (!isStr(r.version, RELEASE_VERSION_MAX, 1) || !isDate(r.date)) return bad;
    if (!Array.isArray(r.items) || r.items.length > RELEASE_ITEMS_MAX || !r.items.every((i) => isStr(i, ITEM_MAX, 1))) return bad;
    out.push({ version: r.version, date: r.date, items: r.items as string[] });
  }
  return ok(out);
}

function comingSoon(v: unknown): Validated<string[] | null> {
  if (v === null) return ok(null);
  if (!Array.isArray(v) || v.length > COMING_SOON_MAX || !v.every((i) => isStr(i, ITEM_MAX, 1))) return bad;
  return ok(v as string[]);
}

function about(v: unknown): Validated<string | null> {
  if (v === null) return ok(null);
  return isStr(v, ABOUT_MAX) ? ok(v) : bad;
}

function brand(v: unknown): Validated<Brand> {
  if (!isObj(v) || !hasOnly(v, ['name', 'welcome', 'accent'])) return bad;
  const name = typeof v.name === 'string' ? v.name.trim() : null;
  if (name === null || name.length < 1 || name.length > BRAND_NAME_MAX) return bad;
  const welcome = v.welcome === undefined ? '' : v.welcome;
  if (!isStr(welcome, BRAND_WELCOME_MAX)) return bad;
  const accent = v.accent === undefined || v.accent === null ? null : typeof v.accent === 'string' ? v.accent.toLowerCase() : false;
  if (accent === false || (accent !== null && !ACCENT_COLORS.includes(accent))) return bad;
  return ok({ name, welcome: welcome.trim(), accent });
}

function defaults(v: unknown): Validated<NewPersonDefaults> {
  if (!isObj(v) || !hasOnly(v, ['lists', 'theme', 'privateByDefault', 'notesPrivateByDefault'])) return bad;
  const d = APP_SETTING_DEFAULTS.defaults;
  const lists = v.lists === undefined ? d.lists : categoryList(v.lists);
  if (lists === null || lists.length < 1) return bad;
  const theme = v.theme === undefined ? d.theme : v.theme;
  if (typeof theme !== 'string' || !Object.hasOwn(THEMES, theme)) return bad;
  const priv = v.privateByDefault === undefined ? d.privateByDefault : v.privateByDefault;
  const notes = v.notesPrivateByDefault === undefined ? d.notesPrivateByDefault : v.notesPrivateByDefault;
  if (typeof priv !== 'boolean' || typeof notes !== 'boolean') return bad;
  return ok({ lists, theme, privateByDefault: priv, notesPrivateByDefault: notes });
}

function lists(v: unknown): Validated<ListsSetting> {
  if (!isObj(v) || !hasOnly(v, ['order', 'hidden'])) return bad;
  const order = v.order === undefined ? [...ALL_CATEGORIES] : categoryList(v.order);
  const hidden = v.hidden === undefined ? [] : categoryList(v.hidden);
  // Every list appears once in the order; at least one stays visible.
  if (!order || !hidden || order.length !== ALL_CATEGORIES.length || hidden.length >= ALL_CATEGORIES.length) return bad;
  return ok({ order, hidden });
}

const VALIDATORS: { [K in AppSettingKey]: (v: unknown) => Validated<AppSettings[K]> } = {
  features, announcement, whatsNew, comingSoon, about, brand, defaults, lists,
};

export const isAppSettingKey = (k: string): k is AppSettingKey => (APP_SETTING_KEYS as readonly string[]).includes(k);

/** Strict check of one key's value; returns the normalized value to store (trimmed text, missing fields filled). */
export function validateAppSetting<K extends AppSettingKey>(key: K, value: unknown): Validated<AppSettings[K]> {
  return VALIDATORS[key](value) as Validated<AppSettings[K]>;
}

/** Stored rows over the defaults: an unset or no-longer-valid key gives its default. */
export function resolveAppSettings(rows: { key: string; value_json: string }[]): AppSettings {
  const out: AppSettings = structuredClone(APP_SETTING_DEFAULTS);
  for (const r of rows) {
    if (!isAppSettingKey(r.key)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.value_json);
    } catch {
      continue;
    }
    const v = validateAppSetting(r.key, parsed);
    if (v.ok) (out as unknown as Record<string, unknown>)[r.key] = v.value;
  }
  return out;
}

/** What GET /api/app returns to everyone, signed in or not (`defaults` is admin-only: it only matters at sign-up). */
export interface PublicAppSettings {
  features: Features;
  /** null when there is none or its end date has passed. */
  announcement: Announcement | null;
  whatsNew: Release[] | null;
  comingSoon: string[] | null;
  about: string | null;
  brand: Brand;
  lists: ListsSetting;
}

/** The public subset; the announcement counts as ended after its last day (UTC). */
export function publicAppSettings(s: AppSettings, now: Date = new Date()): PublicAppSettings {
  const a = s.announcement;
  const live = a.text !== '' && (a.endsAt === null || a.endsAt >= now.toISOString().slice(0, 10));
  return {
    features: s.features,
    announcement: live ? a : null,
    whatsNew: s.whatsNew,
    comingSoon: s.comingSoon,
    about: s.about,
    brand: s.brand,
    lists: s.lists,
  };
}

/** AD6: the per-person settings a new account starts with: the chosen lists on, the rest off, and the default theme. */
export function tabsFor(lists: readonly Category[], base: Record<string, boolean>): Record<string, boolean> {
  const tabs = { ...base };
  for (const c of ALL_CATEGORIES) tabs[c] = lists.includes(c);
  return tabs;
}
