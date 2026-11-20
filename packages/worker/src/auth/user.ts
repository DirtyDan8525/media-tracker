import type { MiddlewareHandler } from 'hono';
import {
  DEFAULT_USER_SETTINGS, isCategoryKey, NOTIFY_KEYS, applyDefaults, legacyCustomized, parseCustomized, resolveDefaults, validateTierSet,
  type Category, type CustomList, type Customized, type NewPersonDefaults, type UserSettings,
} from '@media-tracker/shared';
import type { Env } from '../env';
import { customListsSql, parseLists } from '../lists/sql';
import { clearedCookie, readSessionToken, ROLL_AFTER_MS, expiryFrom, sessionCookie, sha256Hex } from './session';

export interface AppUser {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  /** Effective settings: the admin defaults overlaid with what the person changed themselves. */
  settings: UserSettings;
  /** The settings the person set themselves (a sparse tree mirroring `settings`); the rest follow the admin defaults. */
  customized: Customized;
  /** The settings as stored, before the admin defaults are laid under them (what a settings save writes back). */
  storedSettings: UserSettings;
  avatarAt: string | null;
  createdAt: string | null;
  displayName: string | null;
  /** Phase 5 (item 17): up to 150 characters, plain text; null when none. */
  bio: string | null;
  /** A6: pending users may only set up their profile; removed users are signed out. */
  status: UserStatus;
  /** Their custom lists (migration 0020), oldest first; read with the user row at no extra query. */
  customLists: CustomList[];
}

export type UserStatus = 'pending' | 'active' | 'removed';

/** Username rules (A1, PUT /api/me/username). */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Hono generics for the whole app: bindings plus the user set by requireUser. */
export type AppEnv = { Bindings: Env; Variables: { user: AppUser } };

interface UserRow {
  id: string;
  email: string;
  username: string | null;
  settings_json: string;
  is_admin: number;
  avatar_at: string | null;
  created_at: string | null;
  display_name: string | null;
  bio: string | null;
  status: UserStatus;
  /** The `defaults` app_settings value (JSON text), when the query selected it; undefined = no overlay. */
  app_defaults?: string | null;
  /** CUSTOM_LISTS_SQL, when the query selected it. */
  custom_lists_json?: string | null;
}

/** The users columns `toAppUser` reads (prefix each with an alias as needed). */
export const USER_COLS = 'id, email, username, settings_json, is_admin, avatar_at, created_at, display_name, bio, status';

/** A select-list item: the admin `defaults` row's JSON, which toAppUser overlays under the person's own changes. */
export const APP_DEFAULTS_SQL = "(SELECT value_json FROM app_settings WHERE key = 'defaults') AS app_defaults";

/** A select-list item: the user's custom lists (JSON), for a `users` row aliased `u`. */
export const CUSTOM_LISTS_SQL = customListsSql('u.id');

const SETTINGS_KEYS = Object.keys(DEFAULT_USER_SETTINGS) as (keyof UserSettings)[];
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Stored settings merged over the defaults, keeping only the known UserSettings keys, so stale
 * keys (old Sheet settings, removed options) stop riding along into responses and later writes.
 * Tier sets are kept only for real lists and only when valid: they feed the ratings model.
 */
export function loadSettings(json: string): UserSettings {
  let stored: unknown = {};
  try {
    stored = JSON.parse(json);
  } catch {
    // corrupt settings fall back to defaults
  }
  const known: Partial<Record<keyof UserSettings, unknown>> = {};
  if (isPlainObject(stored)) for (const k of SETTINGS_KEYS) if (Object.hasOwn(stored, k)) known[k] = stored[k];
  const tiers: UserSettings['tiers'] = {};
  if (isPlainObject(known.tiers)) {
    for (const [k, v] of Object.entries(known.tiers)) {
      const t = isCategoryKey(k) ? validateTierSet(v) : null;
      if (t !== null) tiers[k as Category] = t;
    }
  }
  const notify = { ...DEFAULT_USER_SETTINGS.notify };
  if (isPlainObject(known.notify)) for (const k of NOTIFY_KEYS) if (typeof known.notify[k] === 'boolean') notify[k] = known.notify[k];
  const nav = { ...DEFAULT_USER_SETTINGS.nav };
  if (isPlainObject(known.nav)) {
    if (known.nav.side === 'left' || known.nav.side === 'right') nav.side = known.nav.side;
    if (typeof known.nav.collapsed === 'boolean') nav.collapsed = known.nav.collapsed;
  }
  const coverViewer = typeof known.coverViewer === 'boolean' ? known.coverViewer : DEFAULT_USER_SETTINGS.coverViewer;
  const listOrder: Category[] = [];
  if (Array.isArray(known.listOrder)) {
    for (const c of known.listOrder) if (isCategoryKey(c) && !listOrder.includes(c)) listOrder.push(c as Category);
  }
  // merge over defaults so older rows missing a key still get one
  return { ...DEFAULT_USER_SETTINGS, ...(known as Partial<UserSettings>), tiers, notify, nav, coverViewer, listOrder };
}

/** The raw `customized` tree of a stored settings JSON, or null for an account from before tracking (or corrupt JSON). */
function storedCustomized(json: string): Customized | null {
  try {
    const v: unknown = JSON.parse(json);
    return isPlainObject(v) ? parseCustomized(v.customized) : null;
  } catch {
    return null;
  }
}

/**
 * Stored settings as the person sees them: the admin defaults (`app_defaults`, the `defaults` row's JSON text; undefined = none
 * known, so no overlay) under everything they changed themselves. Accounts with no `customized` tree count a stored value that
 * differs from the built-in default as their own.
 */
export function readSettings(json: string, appDefaults?: string | null | NewPersonDefaults): { settings: UserSettings; customized: Customized; storedSettings: UserSettings } {
  const stored = loadSettings(json);
  const customized = storedCustomized(json) ?? legacyCustomized(stored);
  if (appDefaults === undefined) return { settings: stored, customized, storedSettings: stored };
  const d = typeof appDefaults === 'object' && appDefaults !== null ? appDefaults : resolveDefaults(appDefaults);
  return { settings: applyDefaults(stored, customized, d), customized, storedSettings: stored };
}

/**
 * The admin is the user with is_admin set (the first signup on a fresh install) or the one whose
 * email is ADMIN_EMAIL (Dan's row from before Phase 4b).
 */
export function toAppUser(row: UserRow, adminEmail: string | undefined, appDefaults?: NewPersonDefaults): AppUser {
  const admin = (adminEmail ?? '').trim().toLowerCase();
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    isAdmin: row.is_admin === 1 || (admin !== '' && row.email.toLowerCase() === admin),
    avatarAt: row.avatar_at ?? null,
    createdAt: row.created_at ?? null,
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    status: row.status,
    customLists: parseLists(row.custom_lists_json),
    ...readSettings(row.settings_json, appDefaults ?? row.app_defaults),
  };
}

/** Dev only (DEV_EMAIL): the user with this email, created active on first use. 1 query, 3 on creation. */
async function getOrCreateUser(env: Env, email: string): Promise<AppUser> {
  const select = () => env.DB.prepare(`SELECT ${USER_COLS}, ${APP_DEFAULTS_SQL}, ${CUSTOM_LISTS_SQL} FROM users u WHERE email = ?`).bind(email).first<UserRow>();

  const existing = await select();
  if (existing) return toAppUser(existing, env.ADMIN_EMAIL);

  const adminEmail = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const isAdmin = adminEmail !== '' && email === adminEmail ? 1 : 0;
  // OR IGNORE: two first requests racing on the same email must not fail.
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (id, email, settings_json, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), email, JSON.stringify(DEFAULT_USER_SETTINGS), isAdmin, new Date().toISOString())
    .run();
  const created = await select();
  if (!created) throw new Error('failed to create user');
  return toAppUser(created, env.ADMIN_EMAIL);
}

/** A6: the only calls a pending user may make (plus /api/auth/*, which is mounted outside requireUser). */
const PENDING_ALLOWED = new Set(['GET /api/me', 'PUT /api/me/username', 'PUT /api/me/display-name']);

const SESSION_SQL = `SELECT ${USER_COLS.split(', ').map((k) => `u.${k}`).join(', ')}, ${APP_DEFAULTS_SQL}, ${CUSTOM_LISTS_SQL}, s.expires_at AS s_expires_at, s.last_used_at AS s_last_used_at
  FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`;

/**
 * Resolves the signed-in user or answers 401 (A3, A6). Production reads the mt_session cookie:
 * 1 query, 2 when the session is renewed (used more than a day after its last use) or found expired
 * or removed. Dev with DEV_EMAIL signs that user in instead (A10).
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.env.DB;
  let user: AppUser;
  let renewed: string | null = null;
  // The DEV_EMAIL bypass exists only when ENVIRONMENT is exactly 'dev'.
  if (c.env.ENVIRONMENT === 'dev' && c.env.DEV_EMAIL) {
    user = await getOrCreateUser(c.env, c.env.DEV_EMAIL.trim().toLowerCase());
    if (user.status === 'removed') return c.json({ error: 'removed' }, 401);
  } else {
    const token = readSessionToken(c.req.header('Cookie'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const hash = await sha256Hex(token);
    const row = await db.prepare(SESSION_SQL).bind(hash).first<UserRow & { s_expires_at: string; s_last_used_at: string }>();
    if (!row) return c.json({ error: 'unauthorized' }, 401, { 'Set-Cookie': clearedCookie() });
    const now = Date.now();
    if (!(Date.parse(row.s_expires_at) > now)) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
      return c.json({ error: 'unauthorized' }, 401, { 'Set-Cookie': clearedCookie() });
    }
    if (row.status === 'removed') {
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run();
      return c.json({ error: 'removed' }, 401, { 'Set-Cookie': clearedCookie() });
    }
    if (!(now - Date.parse(row.s_last_used_at) <= ROLL_AFTER_MS)) {
      await db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?')
        .bind(new Date(now).toISOString(), expiryFrom(now), hash)
        .run();
      renewed = sessionCookie(token);
    }
    user = toAppUser(row, c.env.ADMIN_EMAIL);
  }
  if (user.status === 'pending' && !PENDING_ALLOWED.has(`${c.req.method} ${c.req.path}`)) {
    return c.json({ error: 'pending' }, 403, renewed ? { 'Set-Cookie': renewed } : {});
  }
  c.set('user', user);
  await next();
  if (renewed) {
    try {
      c.res.headers.append('Set-Cookie', renewed);
    } catch {
      // immutable headers (a passed-through Response): copy it first
      c.res = new Response(c.res.body, c.res);
      c.res.headers.append('Set-Cookie', renewed);
    }
  }
};
