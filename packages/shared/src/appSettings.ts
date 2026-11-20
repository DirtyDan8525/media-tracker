/**
 * App-wide settings the admin edits (Phase 6c, docs/plans/2026-11-17-phase6c-admin.md, AD1-AD11).
 * One record per key in `app_settings`. The server validates every PUT with `validateAppSetting`
 * and reads stored values with `resolveAppSettings`, which falls back to the default for any
 * key that is unset or no longer valid.
 */
import { CATEGORY_CONFIG, COMPARE_ASK, DEFAULT_USER_SETTINGS, NAV_SIDES, NOTIFY_KEYS, SEARCH_SCOPE, type Category, type NotifyKey } from './types';
import { THEMES } from './theme';

export const APP_SETTING_KEYS = ['features', 'announcement', 'whatsNew', 'comingSoon', 'about', 'brand', 'defaults', 'lists'] as const;
export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as Category[];

/** AD2: every switch is on by default. */
export const FEATURE_KEYS = ['signups', 'friends', 'feed', 'comments', 'reactions', 'messages', 'closeCalls', 'walkthrough', 'installBanner', 'everyoneNotes'] as const;
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

/**
 * Settings that live only in the browser (localStorage), so an admin default can only be the value a device
 * starts with when it has nothing saved; "Apply to everyone" cannot reach them.
 */
export interface DeviceDefaults {
  /** PC side bar width in px (200-360); null = the built-in 240. */
  navWidth: number | null;
  /** Chat and Activity text size, as a percent: one of TEXT_SIZE_STEPS. */
  chatTextSize: number;
  activityTextSize: number;
  /** Starting width in px for a table column (by column id), on every list; a column not named keeps its built-in width. */
  columnWidths: Record<string, number>;
}

/**
 * Admin -> Defaults (Dan, 2026-11-19): one default for every per-user setting. Everyone follows it for any
 * setting they never changed themselves (see userDefaults.ts); sign-up copies nothing. Not covered: Custom colours
 * (personal) and rating tiers (changing them re-fits scores, so they stay per person).
 */
export interface NewPersonDefaults {
  /** Which lists are on (Settings -> Tabs). */
  lists: Category[];
  animeSeasons: boolean;
  tvSeasons: boolean;
  /** Everyone's own list order; empty = the admin's order (the `lists` setting). */
  listOrder: Category[];
  theme: string;
  /** Rating: "Ask me to compare close ratings" (a COMPARE_ASK value). */
  compareAsk: string;
  searchScope: string;
  navSide: (typeof NAV_SIDES)[number];
  navCollapsed: boolean;
  coverViewer: boolean;
  notify: Record<NotifyKey, boolean>;
  /** Not per-person settings: what a new title starts as (server-side, applies to everyone already). */
  privateByDefault: boolean;
  notesPrivateByDefault: boolean;
  device: DeviceDefaults;
}

export const TEXT_SIZE_STEPS = [85, 100, 115, 125, 140] as const;
export const NAV_WIDTH_RANGE = { min: 200, max: 360 } as const;
/** Column ids a starting width may name (the web table's ColId; a web test keeps the two in step). */
export const COLUMN_IDS = ['cover', 'rating', 'title', 'status', 'progress', 'genres', 'creator', 'avg', 'notes', 'tags', 'started', 'finished', 'rewatches', 'airing'] as const;
export const COLUMN_WIDTH_RANGE = { min: 48, max: 600 } as const;

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
  defaults: {
    lists: [...ALL_CATEGORIES],
    animeSeasons: DEFAULT_USER_SETTINGS.tabs.animeSeasons!,
    tvSeasons: DEFAULT_USER_SETTINGS.tabs.tvSeasons!,
    listOrder: [],
    theme: DEFAULT_USER_SETTINGS.theme,
    compareAsk: DEFAULT_USER_SETTINGS.compareAsk,
    searchScope: DEFAULT_USER_SETTINGS.searchScope,
    navSide: DEFAULT_USER_SETTINGS.nav.side,
    navCollapsed: DEFAULT_USER_SETTINGS.nav.collapsed,
    coverViewer: DEFAULT_USER_SETTINGS.coverViewer,
    notify: { ...DEFAULT_USER_SETTINGS.notify },
    privateByDefault: false,
    notesPrivateByDefault: false,
    device: { navWidth: null, chatTextSize: 100, activityTextSize: 100, columnWidths: {} },
  },
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

const DEFAULTS_KEYS = [
  'lists', 'animeSeasons', 'tvSeasons', 'listOrder', 'theme', 'compareAsk', 'searchScope', 'navSide', 'navCollapsed', 'coverViewer',
  'notify', 'privateByDefault', 'notesPrivateByDefault', 'device',
] as const;

function device(v: unknown): Validated<DeviceDefaults> {
  const d = APP_SETTING_DEFAULTS.defaults.device;
  if (v === undefined) return ok({ ...d, columnWidths: {} });
  if (!isObj(v) || !hasOnly(v, ['navWidth', 'chatTextSize', 'activityTextSize', 'columnWidths'])) return bad;
  const navWidth = v.navWidth === undefined ? d.navWidth : v.navWidth;
  if (navWidth !== null && !(Number.isInteger(navWidth) && (navWidth as number) >= NAV_WIDTH_RANGE.min && (navWidth as number) <= NAV_WIDTH_RANGE.max)) return bad;
  const size = (x: unknown, dflt: number) => (x === undefined ? dflt : (TEXT_SIZE_STEPS as readonly unknown[]).includes(x) ? (x as number) : null);
  const chat = size(v.chatTextSize, d.chatTextSize);
  const activity = size(v.activityTextSize, d.activityTextSize);
  if (chat === null || activity === null) return bad;
  const columnWidths: Record<string, number> = {};
  if (v.columnWidths !== undefined) {
    if (!isObj(v.columnWidths)) return bad;
    for (const [k, w] of Object.entries(v.columnWidths)) {
      if (!(COLUMN_IDS as readonly string[]).includes(k) || !Number.isInteger(w) || (w as number) < COLUMN_WIDTH_RANGE.min || (w as number) > COLUMN_WIDTH_RANGE.max) return bad;
      columnWidths[k] = w as number;
    }
  }
  return ok({ navWidth: navWidth as number | null, chatTextSize: chat, activityTextSize: activity, columnWidths });
}

function defaults(v: unknown): Validated<NewPersonDefaults> {
  if (!isObj(v) || !hasOnly(v, DEFAULTS_KEYS)) return bad;
  const d = APP_SETTING_DEFAULTS.defaults;
  const lists = v.lists === undefined ? d.lists : categoryList(v.lists);
  if (lists === null || lists.length < 1) return bad;
  const listOrder = v.listOrder === undefined ? d.listOrder : categoryList(v.listOrder);
  if (listOrder === null) return bad;
  const theme = v.theme === undefined ? d.theme : v.theme;
  // The Custom colour theme is personal, so it is not a choice for everyone.
  if (typeof theme !== 'string' || !Object.hasOwn(THEMES, theme)) return bad;
  const bools = {} as Record<'animeSeasons' | 'tvSeasons' | 'navCollapsed' | 'coverViewer' | 'privateByDefault' | 'notesPrivateByDefault', boolean>;
  for (const k of ['animeSeasons', 'tvSeasons', 'navCollapsed', 'coverViewer', 'privateByDefault', 'notesPrivateByDefault'] as const) {
    if (v[k] === undefined) { bools[k] = d[k]; continue; }
    if (typeof v[k] !== 'boolean') return bad;
    bools[k] = v[k];
  }
  const compareAsk = v.compareAsk === undefined ? d.compareAsk : v.compareAsk;
  if (typeof compareAsk !== 'string' || !(COMPARE_ASK as readonly string[]).includes(compareAsk)) return bad;
  const searchScope = v.searchScope === undefined ? d.searchScope : v.searchScope;
  if (typeof searchScope !== 'string' || !(SEARCH_SCOPE as readonly string[]).includes(searchScope)) return bad;
  const navSide = v.navSide === undefined ? d.navSide : v.navSide;
  if (typeof navSide !== 'string' || !(NAV_SIDES as readonly string[]).includes(navSide)) return bad;
  const notify = { ...d.notify };
  if (v.notify !== undefined) {
    if (!isObj(v.notify) || !hasOnly(v.notify, NOTIFY_KEYS)) return bad;
    for (const k of NOTIFY_KEYS) {
      if (!(k in v.notify)) continue;
      if (typeof v.notify[k] !== 'boolean') return bad;
      notify[k] = v.notify[k];
    }
  }
  const dev = device(v.device);
  if (!dev.ok) return bad;
  return ok({
    lists, listOrder, theme, compareAsk, searchScope, notify, device: dev.value,
    navSide: navSide as NewPersonDefaults['navSide'],
    ...bools,
  });
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

/** What GET /api/app returns to everyone, signed in or not (`defaults` is admin-only; its per-person part reaches people through /api/me). */
export interface PublicAppSettings {
  features: Features;
  /** null when there is none or its end date has passed. */
  announcement: Announcement | null;
  whatsNew: Release[] | null;
  comingSoon: string[] | null;
  about: string | null;
  brand: Brand;
  lists: ListsSetting;
  /** Device-only starting values (side bar width, text sizes, column widths): the app reads them when a device has nothing saved. */
  device: DeviceDefaults;
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
    device: s.defaults.device,
  };
}

/** AD6: the per-person settings a new account starts with: the chosen lists on, the rest off, and the default theme. */
export function tabsFor(lists: readonly Category[], base: Record<string, boolean>): Record<string, boolean> {
  const tabs = { ...base };
  for (const c of ALL_CATEGORIES) tabs[c] = lists.includes(c);
  return tabs;
}
