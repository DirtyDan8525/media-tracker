/**
 * How admin Defaults reach people (Dan, 2026-11-19, "Both"):
 *  1. Effective settings = the admin default for every setting the person never changed, their own value for the rest.
 *  2. "Apply to everyone" writes one default into every active person's settings and forgets that they had changed it.
 *
 * Tracking: a person's `settings_json` carries a sparse `customized` tree that mirrors the settings shape
 * ({ theme: true, tabs: { anime: true }, nav: { side: true } }). Only keys the person set themselves appear in it.
 * Accounts from before this existed have no `customized`: for them a stored value that differs from the built-in
 * default counts as their own choice (that is the only trace of a change they left), and anything equal to the
 * built-in default follows the admin.
 */
import { APP_SETTING_DEFAULTS, validateAppSetting, type NewPersonDefaults } from './appSettings';
import { BUILTIN_CATEGORIES, DEFAULT_USER_SETTINGS, NOTIFY_KEYS, type UserSettings } from './types';

/** Defaults cover the built-in lists only: a custom list (`c_` key) is personal, so its switch and place stay the person's own. */
const ALL_CATEGORIES_LIST = [...BUILTIN_CATEGORIES];

export type Customized = { [key: string]: true | { [key: string]: true } };

/** One "Apply to everyone" button each. `lists` is the nine list switches; `notify` the push switches. */
export const APPLY_KEYS = [
  'lists', 'animeSeasons', 'tvSeasons', 'listOrder', 'theme', 'compareAsk', 'searchScope', 'navSide', 'navCollapsed', 'coverViewer', 'notify',
] as const;
export type ApplyKey = (typeof APPLY_KEYS)[number];
export const isApplyKey = (k: unknown): k is ApplyKey => typeof k === 'string' && (APPLY_KEYS as readonly string[]).includes(k);

/** The `customized` paths an apply key owns, as [group, leaf?]. */
function pathsOf(key: ApplyKey): [string, string?][] {
  switch (key) {
    case 'lists': return ALL_CATEGORIES_LIST.map((c) => ['tabs', c]);
    case 'animeSeasons': return [['tabs', 'animeSeasons']];
    case 'tvSeasons': return [['tabs', 'tvSeasons']];
    case 'navSide': return [['nav', 'side']];
    case 'navCollapsed': return [['nav', 'collapsed']];
    case 'notify': return NOTIFY_KEYS.map((k) => ['notify', k]);
    default: return [[key]];
  }
}

/** The settings patch (RFC 7396 merge patch) that writes this default into a person's settings. */
export function defaultPatch(key: ApplyKey, d: NewPersonDefaults): Record<string, unknown> {
  switch (key) {
    case 'lists': return { tabs: Object.fromEntries(ALL_CATEGORIES_LIST.map((c) => [c, d.lists.includes(c)])) };
    case 'animeSeasons': return { tabs: { animeSeasons: d.animeSeasons } };
    case 'tvSeasons': return { tabs: { tvSeasons: d.tvSeasons } };
    case 'navSide': return { nav: { side: d.navSide } };
    case 'navCollapsed': return { nav: { collapsed: d.navCollapsed } };
    case 'notify': return { notify: { ...d.notify } };
    default: return { [key]: d[key] };
  }
}

/** The merge patch that removes this key's marks from `customized` (null deletes a member). */
export function clearPatch(key: ApplyKey): Record<string, unknown> {
  const out: Record<string, Record<string, unknown> | null> = {};
  for (const [g, leaf] of pathsOf(key)) {
    if (leaf === undefined) out[g] = null;
    else ((out[g] ??= {}) as Record<string, unknown>)[leaf] = null;
  }
  return out;
}

/** RFC 7396 JSON merge patch (what SQLite's json_patch does). Does not mutate `target`. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const base: Record<string, unknown> = typeof target === 'object' && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete base[k];
    else base[k] = mergePatch(base[k], v);
  }
  return base;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stored `customized` tree, or null when there is none (an account from before tracking). Unknown shapes are dropped. */
export function parseCustomized(v: unknown): Customized | null {
  if (!isObj(v)) return null;
  const out: Customized = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === true) out[k] = true;
    else if (isObj(x)) {
      const leaves: { [k: string]: true } = {};
      for (const [l, y] of Object.entries(x)) if (y === true) leaves[l] = true;
      if (Object.keys(leaves).length) out[k] = leaves;
    }
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** For an account with no `customized`: what differs from the built-in defaults was their own choice. `stored` has the built-ins filled in. */
export function legacyCustomized(stored: UserSettings): Customized {
  const d = DEFAULT_USER_SETTINGS;
  const out: Customized = {};
  for (const k of ['theme', 'compareAsk', 'searchScope', 'coverViewer'] as const) if (!same(stored[k], d[k])) out[k] = true;
  if (stored.listOrder.length > 0) out.listOrder = true;
  const group = (name: 'tabs' | 'notify' | 'nav', now: Record<string, unknown>, base: Record<string, unknown>) => {
    const leaves: { [k: string]: true } = {};
    for (const [k, v] of Object.entries(now)) if (!same(v, base[k])) leaves[k] = true;
    if (Object.keys(leaves).length) out[name] = leaves;
  };
  group('tabs', stored.tabs, d.tabs);
  group('notify', stored.notify, d.notify);
  group('nav', { ...stored.nav }, { ...d.nav });
  return out;
}

/** Adds the paths a (validated) settings update touches. Does not mutate. */
export function markCustomized(current: Customized, partial: Record<string, unknown>): Customized {
  const out: Customized = structuredClone(current);
  for (const k of ['theme', 'compareAsk', 'searchScope', 'coverViewer', 'listOrder'] as const) if (k in partial) out[k] = true;
  for (const g of ['tabs', 'notify', 'nav'] as const) {
    const v = partial[g];
    if (!isObj(v) || Object.keys(v).length === 0) continue;
    const leaves = isObj(out[g]) ? { ...(out[g] as object) } as { [k: string]: true } : {};
    for (const leaf of Object.keys(v)) leaves[leaf] = true;
    out[g] = leaves;
  }
  return out;
}

const has = (c: Customized, g: string, leaf?: string): boolean => {
  const x = c[g];
  if (leaf === undefined) return x === true;
  return isObj(x) && (x as Record<string, unknown>)[leaf] === true;
};

/** Stored (built-ins filled in) over the admin defaults: every setting not in `customized` takes the admin's value. */
export function applyDefaults(stored: UserSettings, customized: Customized, d: NewPersonDefaults): UserSettings {
  const out: UserSettings = { ...stored, tabs: { ...stored.tabs }, notify: { ...stored.notify }, nav: { ...stored.nav }, listOrder: stored.listOrder };
  if (!has(customized, 'theme')) out.theme = d.theme;
  if (!has(customized, 'compareAsk')) out.compareAsk = d.compareAsk;
  if (!has(customized, 'searchScope')) out.searchScope = d.searchScope;
  if (!has(customized, 'coverViewer')) out.coverViewer = d.coverViewer;
  if (!has(customized, 'listOrder')) out.listOrder = [...d.listOrder];
  for (const c of ALL_CATEGORIES_LIST) if (!has(customized, 'tabs', c)) out.tabs[c] = d.lists.includes(c);
  if (!has(customized, 'tabs', 'animeSeasons')) out.tabs.animeSeasons = d.animeSeasons;
  if (!has(customized, 'tabs', 'tvSeasons')) out.tabs.tvSeasons = d.tvSeasons;
  for (const k of NOTIFY_KEYS) if (!has(customized, 'notify', k)) out.notify[k] = d.notify[k];
  if (!has(customized, 'nav', 'side')) out.nav.side = d.navSide;
  if (!has(customized, 'nav', 'collapsed')) out.nav.collapsed = d.navCollapsed;
  return out;
}

/** Is the setting (an apply key) one this person set themselves? (Any of its parts, for `lists` and `notify`.) */
export function isCustomized(c: Customized, key: ApplyKey): boolean {
  return pathsOf(key).some(([g, leaf]) => has(c, g, leaf));
}

/** The stored `defaults` app setting (its JSON text, or null when unset) as validated defaults; junk gives the built-ins. */
export function resolveDefaults(json: string | null | undefined): NewPersonDefaults {
  if (json) {
    try {
      const v = validateAppSetting('defaults', JSON.parse(json));
      if (v.ok) return v.value;
    } catch {
      // fall through
    }
  }
  return structuredClone(APP_SETTING_DEFAULTS.defaults);
}
