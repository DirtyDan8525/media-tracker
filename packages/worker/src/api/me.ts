import { Hono } from 'hono';
import {
  AVATAR_MAX_BYTES,
  COMPARE_ASK,
  DEFAULT_USER_SETTINGS,
  decodeAvatar,
  SEARCH_SCOPE,
  THEMES,
  type UserSettings,
} from '@media-tracker/shared';
import { USERNAME_RE, type AppEnv, type AppUser } from '../auth/user';
import { ensureTiers } from '../ratings/store';
import { ensureInviteCode, newInviteCode } from '../social/inviteCode';

export const me = new Hono<AppEnv>();

const HEX_RE = /^#[0-9a-f]{6}$/i;

const ROLE_KEYS = Object.keys(THEMES.Midnight!);
const TAB_KEYS = Object.keys(DEFAULT_USER_SETTINGS.tabs);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export type SanitizeResult = { ok: true; settings: UserSettings } | { ok: false };

/**
 * Validates a partial settings update and merges it into `current`.
 * Unknown keys are dropped (that includes the removed compareStyle, compareRoom and
 * compareWindow); a known key with a bad value fails the whole update. `tiers` is
 * dropped too: only PUT /api/ratings/tiers/:list writes it, because a change re-fits scores (Q3).
 * `tabs` and `colors` merge per key; scalars replace. Does not mutate `current`.
 */
export function sanitizeSettings(partial: unknown, current: UserSettings): SanitizeResult {
  if (!isPlainObject(partial)) return { ok: false };
  const next: UserSettings = { ...current, tabs: { ...current.tabs }, colors: { ...current.colors } };

  if ('theme' in partial) {
    const t = partial.theme;
    if (typeof t !== 'string' || !(t === 'Custom' || Object.hasOwn(THEMES, t))) return { ok: false };
    next.theme = t;
  }
  if ('colors' in partial) {
    const c = partial.colors;
    if (!isPlainObject(c)) return { ok: false };
    for (const [k, v] of Object.entries(c)) {
      if (!ROLE_KEYS.includes(k)) continue;
      if (typeof v !== 'string' || !HEX_RE.test(v)) return { ok: false };
      next.colors[k] = v;
    }
  }
  if ('tabs' in partial) {
    const t = partial.tabs;
    if (!isPlainObject(t)) return { ok: false };
    for (const [k, v] of Object.entries(t)) {
      if (!TAB_KEYS.includes(k)) continue;
      if (typeof v !== 'boolean') return { ok: false };
      next.tabs[k] = v;
    }
  }
  const enums = [
    ['compareAsk', COMPARE_ASK],
    ['searchScope', SEARCH_SCOPE],
  ] as const;
  for (const [key, allowed] of enums) {
    if (!(key in partial)) continue;
    const v = partial[key];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) return { ok: false };
    next[key] = v;
  }
  return { ok: true, settings: next };
}

const invalid = { error: 'invalid' } as const;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return isPlainObject(body) ? body : null;
  } catch {
    return null;
  }
}

/** S14: trimmed, 1-40 characters, or null to clear. undefined = invalid. */
export function cleanDisplayName(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim();
  return name.length < 1 || [...name].length > 40 ? undefined : name;
}

/** The one shape every /api/me* response returns. */
export function meBody(user: AppUser) {
  const { id, email, username, isAdmin, settings, avatarAt, createdAt, displayName, status } = user;
  return { id, email, username, isAdmin, settings, avatarAt, createdAt, displayName, status };
}

// 2 queries (4 when the lazy tier backfill finds rows to assign; Ruling Q10). The backfill is
// optional (every read and rating path derives missing tiers), so a failure is logged and /me,
// which the app needs to boot, still answers.
me.get('/', async (c) => {
  try {
    await ensureTiers(c.env.DB, c.var.user.id, c.var.user.settings);
  } catch (err) {
    console.error('ensureTiers failed', err);
  }
  return c.json(meBody(c.var.user));
});

me.put('/username', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || typeof body.username !== 'string') return c.json(invalid, 400);
  const username = body.username.toLowerCase();
  if (!USERNAME_RE.test(username)) return c.json(invalid, 400);

  const user = c.var.user;
  const clash = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
    .bind(username, user.id)
    .first();
  if (clash) return c.json({ error: 'taken' }, 409);

  try {
    await c.env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, user.id).run();
  } catch (err) {
    // A concurrent claim can slip past the pre-check; the UNIQUE index is the real guard.
    if (/UNIQUE/i.test(String(err instanceof Error ? err.message : err))) return c.json({ error: 'taken' }, 409);
    throw err;
  }
  return c.json(meBody({ ...user, username }));
});

me.put('/settings', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const result = sanitizeSettings(body.settings, c.var.user.settings);
  if (!result.ok) return c.json(invalid, 400);
  await c.env.DB.prepare('UPDATE users SET settings_json = ? WHERE id = ?')
    .bind(JSON.stringify(result.settings), c.var.user.id)
    .run();
  return c.json({ settings: result.settings });
});

// Base64 of a maximum-size photo is about 87.4 KB; allow a little for the JSON around it.
const AVATAR_BODY_MAX = Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 1024;

/** Reads the request body as JSON, refusing (null) anything over `max` bytes before parsing it. */
async function readJsonCapped(req: Request, max: number): Promise<unknown> {
  const declared = req.headers.get('content-length');
  if (declared !== null && !(Number(declared) <= max)) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    all.set(ch, at);
    at += ch.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    return null;
  }
}

// 2 queries (+ sign-in). The photo is the caller's own: the row key is the signed-in user id.
me.put('/avatar', async (c) => {
  const decoded = decodeAvatar(await readJsonCapped(c.req.raw, AVATAR_BODY_MAX));
  if (!decoded) return c.json(invalid, 400);

  const user = c.var.user;
  // avatarAt is the cache-busting version in /api/me/avatar?v=; keep it strictly increasing.
  let now = new Date().toISOString();
  if (user.avatarAt !== null && now <= user.avatarAt) now = new Date(Date.parse(user.avatarAt) + 1).toISOString();
  const data = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(user.id, decoded.type, data, now),
    c.env.DB.prepare('UPDATE users SET avatar_at = ? WHERE id = ?').bind(now, user.id),
  ]);
  return c.json(meBody({ ...user, avatarAt: now }));
});

// 1 query (+ sign-in)
me.get('/avatar', async (c) => {
  const row = await c.env.DB.prepare('SELECT mime, data FROM avatars WHERE user_id = ?')
    .bind(c.var.user.id)
    .first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// 2 queries (+ sign-in)
me.delete('/avatar', async (c) => {
  const user = c.var.user;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM avatars WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('UPDATE users SET avatar_at = NULL WHERE id = ?').bind(user.id),
  ]);
  return c.json(meBody({ ...user, avatarAt: null }));
});

// 1 query when the code exists, 2-4 on first use (read, write, read; once more after a unique clash). (+ sign-in)
me.get('/invite', async (c) => c.json({ code: await ensureInviteCode(c.env.DB, c.var.user.id) }));

// 1 query, 2 after a unique clash (+ sign-in). The old link stops working at once.
me.post('/invite', async (c) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = newInviteCode();
    try {
      await c.env.DB.prepare('UPDATE users SET invite_code = ? WHERE id = ?').bind(code, c.var.user.id).run();
      return c.json({ code });
    } catch (err) {
      if (attempt === 0 && /UNIQUE/i.test(String(err instanceof Error ? err.message : err))) continue;
      throw err;
    }
  }
  throw new Error('could not create invite code');
});

// 1 query (+ sign-in)
me.put('/display-name', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || !('displayName' in body)) return c.json(invalid, 400);
  const displayName = cleanDisplayName(body.displayName);
  if (displayName === undefined) return c.json(invalid, 400);
  await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName, c.var.user.id).run();
  return c.json(meBody({ ...c.var.user, displayName }));
});
