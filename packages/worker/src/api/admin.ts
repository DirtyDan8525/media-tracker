/**
 * /api/admin/* (Phase 4b, A7): Dan approves sign-ups, declines them, removes and restores people,
 * and makes password-reset links. Only the admin reaches these routes.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import {
  clearPatch, defaultPatch, isAppSettingKey, isApplyKey, legacyCustomized, mergePatch, validateAppSetting,
  type Category, type PublicUser,
} from '@media-tracker/shared';
import { loadSettings, type AppEnv } from '../auth/user';
import { BACKUP_EXCLUDED_NOTE, BACKUP_TABLES } from '../admin/backup';
import { CATEGORIES } from './entryValidation';
import { checkSources, explainLookup } from '../lookup/adminTools';
import { forgetAppSettings, loadAppSettings } from '../settings/appSettings';
import { publicUser, PUBLIC_USER_COLS, type PublicUserRow } from '../social/visibility';
import { createResetLink, createSignupLink } from './auth';

export const admin = new Hono<AppEnv>();

/** Only the admin (users.is_admin, or the ADMIN_EMAIL row) reaches /api/admin/*. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user').isAdmin) return c.json({ error: 'forbidden' }, 403);
  await next();
};
admin.use('*', requireAdmin);

const notFound = { error: 'not_found' } as const;

export interface AdminLists {
  pending: (PublicUser & { requestedAt: string })[];
  active: (PublicUser & { joinedAt: string | null; isAdmin: boolean })[];
  removed: PublicUser[];
}

// GET /api/admin: 1 query (+ sign-in). Pending oldest first (the order they asked), the rest by join date.
admin.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLS}, status, is_admin, email, created_at FROM users ORDER BY created_at, id`,
  ).all<PublicUserRow & { status: string; is_admin: number; email: string; created_at: string | null }>();
  const adminEmail = (c.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const body: AdminLists = { pending: [], active: [], removed: [] };
  for (const r of results) {
    const u = publicUser(r);
    if (r.status === 'pending') body.pending.push({ ...u, requestedAt: r.created_at ?? '' });
    else if (r.status === 'removed') body.removed.push(u);
    else body.active.push({ ...u, joinedAt: r.created_at, isAdmin: r.is_admin === 1 || (adminEmail !== '' && r.email.toLowerCase() === adminEmail) });
  }
  return c.json(body);
});

// POST /api/admin/users/:id/approve: pending or removed -> active. 1 query (+ sign-in). 404 otherwise.
admin.post('/users/:id/approve', async (c) => {
  const res = await c.env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status IN ('pending', 'removed')")
    .bind(c.req.param('id'))
    .run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/decline: deletes a pending sign-up (sessions go with it). 1 query (+ sign-in).
admin.post('/users/:id/decline', async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").bind(c.req.param('id')).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/remove: active -> removed and every session deleted; data stays. Never yourself.
// 2 queries (+ sign-in).
admin.post('/users/:id/remove', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'self' }, 400);
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ? AND status = 'active'").bind(id),
    // Only when the row really is removed now (a pending person keeps their session).
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND (SELECT status FROM users WHERE id = ?1) = 'removed'").bind(id),
  ]);
  return res!.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/reset-link -> { link }: one-time, 24 h, replaces any earlier link. 2 queries (+ sign-in).
admin.post('/users/:id/reset-link', async (c) => {
  const link = await createResetLink(c.env.DB, c.req.param('id'), new URL(c.req.url).origin);
  return link ? c.json({ link }) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/delete: deletes the person and, by cascade, everything of theirs (lists,
// sessions, friendships, activity). Never yourself. 1 query (+ sign-in).
admin.post('/users/:id/delete', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'self' }, 400);
  const res = await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

export type SignupLinkStatus = 'unused' | 'used' | 'expired' | 'revoked';
export interface SignupLinkItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: SignupLinkStatus;
  usedBy: string | null;
  usedAt: string | null;
}

// POST /api/admin/signup-links -> { link, expiresAt, id }: single use, 7 days. 1 query (+ sign-in).
admin.post('/signup-links', async (c) => c.json(await createSignupLink(c.env.DB, c.get('user').id, new URL(c.req.url).origin)));

// GET /api/admin/signup-links -> { links }: the last 50, newest first. Never the token (only its hash is stored). 1 query (+ sign-in).
admin.get('/signup-links', async (c) => {
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.created_at, l.expires_at, l.used_at, l.revoked_at, u.username AS used_by
       FROM signup_links l LEFT JOIN users u ON u.id = l.used_by ORDER BY l.created_at DESC, l.id LIMIT 50`,
  ).all<{ id: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null; used_by: string | null }>();
  const links: SignupLinkItem[] = results.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.used_at ? 'used' : r.revoked_at ? 'revoked' : Date.parse(r.expires_at) > now ? 'unused' : 'expired',
    usedBy: r.used_by,
    usedAt: r.used_at,
  }));
  return c.json({ links });
});

// DELETE /api/admin/signup-links/:id: revokes an unused, unexpired link (404 otherwise). 1 query (+ sign-in).
admin.delete('/signup-links/:id', async (c) => {
  const res = await c.env.DB.prepare(
    'UPDATE signup_links SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1',
  ).bind(new Date().toISOString(), c.req.param('id')).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// ---- Phase 6c: app settings (AD1-AD6, AD11) ----

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// GET /api/admin/app -> { settings, set, people }: every key with defaults filled in (what the editors start from), the keys
// that have been saved, and how many active people "Apply to everyone" reaches. 2 queries (+ sign-in).
admin.get('/app', async (c) => {
  const [{ results }, people] = await Promise.all([
    c.env.DB.prepare('SELECT key FROM app_settings').all<{ key: string }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").first<{ n: number }>(),
  ]);
  return c.json({ settings: await loadAppSettings(c.env.DB), set: results.map((r) => r.key).filter(isAppSettingKey), people: people?.n ?? 0 });
});

// POST /api/admin/defaults/apply { key } -> { key, people }: writes the admin default for one setting into every active person's
// settings, over what they chose themselves, and forgets that they changed it (they follow the default again). 400 unknown key.
// Accounts that predate change tracking have no `customized` list yet; each is given one (what differs from the built-in defaults)
// in the same batch, so applying one key does not turn their other changes into "follows the default". 3 queries, plus one per
// such account, which stops being any once they have been touched (+ sign-in). The main write is one UPDATE with json_patch.
admin.post('/defaults/apply', async (c) => {
  const body = await readJson(c.req.raw);
  const key = body?.key;
  if (!isApplyKey(key)) return c.json({ error: 'invalid' }, 400);
  const db = c.env.DB;
  const { defaults } = await loadAppSettings(db);
  const patch = { ...defaultPatch(key, defaults), customized: clearPatch(key) };
  const NO_TRACKING = "CASE WHEN json_valid(settings_json) THEN json_type(settings_json, '$.customized') IS NULL ELSE 1 END";
  const { results: legacy } = await db.prepare(`SELECT id, settings_json FROM users WHERE status = 'active' AND ${NO_TRACKING}`)
    .all<{ id: string; settings_json: string }>();
  const results = await db.batch([
    db.prepare(`UPDATE users SET settings_json = json_patch(settings_json, ?) WHERE status = 'active' AND NOT (${NO_TRACKING})`).bind(JSON.stringify(patch)),
    ...legacy.map((u) => {
      const stored = loadSettings(u.settings_json);
      const next = mergePatch({ ...stored, customized: legacyCustomized(stored) }, patch);
      return db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').bind(JSON.stringify(next), u.id);
    }),
  ]);
  const people = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return c.json({ key, people });
});

// PUT /api/admin/app/:key { value } -> { key, value }: the validated, normalized value, saved. 400 invalid, 404 unknown key.
// A saved announcement gets a fresh id so a dismissed banner shows again. 1 query (+ sign-in).
admin.put('/app/:key', async (c) => {
  const key = c.req.param('key');
  if (!isAppSettingKey(key)) return c.json(notFound, 404);
  const body = await readJson(c.req.raw);
  if (!body || !('value' in body)) return c.json({ error: 'invalid' }, 400);
  const v = validateAppSetting(key, body.value);
  if (!v.ok) return c.json({ error: 'invalid' }, 400);
  const value = key === 'announcement' ? { ...(v.value as object), id: crypto.randomUUID() } : v.value;
  await c.env.DB.prepare(
    'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value_json = ?2, updated_at = ?3',
  ).bind(key, JSON.stringify(value), new Date().toISOString()).run();
  forgetAppSettings();
  return c.json({ key, value });
});

// DELETE /api/admin/app/:key: back to the built-in default (the row goes). 204; 404 unknown key. 1 query (+ sign-in).
admin.delete('/app/:key', async (c) => {
  const key = c.req.param('key');
  if (!isAppSettingKey(key)) return c.json(notFound, 404);
  await c.env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(key).run();
  forgetAppSettings();
  return c.body(null, 204);
});

// ---- moderation (AD7) ----

export interface AdminComment {
  id: string;
  body: string;
  createdAt: string;
  author: PublicUser;
  /** The post (activity anchor) the comment is on, or null when it is on an entry. */
  activityId: string | null;
  entryId: string;
  title: string;
  category: Category;
  /** Whose title it is. */
  owner: string | null;
}

// GET /api/admin/comments?limit=50 -> { comments }: the newest live comments (1-200, default 50) with author and the
// title they are about, from anyone and on any post. Delete with DELETE /api/comments/:id. 1 query (+ sign-in).
admin.get('/comments', async (c) => {
  const asked = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isFinite(asked) ? Math.min(200, Math.max(1, asked)) : 50;
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.activity_id, e.id AS entry_id, e.title, e.category, ou.username AS owner,
            u.id AS u_id, u.username, u.display_name, u.avatar_at
       FROM comments c JOIN users u ON u.id = c.user_id
       LEFT JOIN activity a ON a.id = c.activity_id
       JOIN entries e ON e.id = COALESCE(c.entry_id, a.entry_id)
       LEFT JOIN users ou ON ou.id = e.user_id
      WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC, c.id LIMIT ?`,
  ).bind(limit).all<{
    id: string; body: string; created_at: string; activity_id: string | null; entry_id: string; title: string; category: Category;
    owner: string | null; u_id: string; username: string | null; display_name: string | null; avatar_at: string | null;
  }>();
  const comments: AdminComment[] = results.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    author: publicUser({ id: r.u_id, username: r.username, display_name: r.display_name, avatar_at: r.avatar_at }),
    activityId: r.activity_id,
    entryId: r.entry_id,
    title: r.title,
    category: r.category,
    owner: r.owner,
  }));
  return c.json({ comments });
});

// ---- numbers (AD9) ----

export interface AdminNumbers {
  members: number;
  /** People with a session used in the last 7 days (a session's last use is recorded at most once a day). */
  active7: number;
  titles7: number;
  messages7: number;
  /** Top 10 by how many people rated the title (same title and list, ignoring case and spaces), non-private entries only. */
  mostRated: { title: string; category: Category; count: number; average: number }[];
}

// GET /api/admin/numbers: one batch of 5 (+ sign-in).
admin.get('/numbers', async (c) => {
  const db = c.env.DB;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [members, active, titles, msgs, top] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
    db.prepare("SELECT COUNT(DISTINCT s.user_id) AS n FROM sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active' WHERE s.last_used_at >= ?").bind(since),
    db.prepare("SELECT COUNT(*) AS n FROM entries e JOIN users u ON u.id = e.user_id AND u.status = 'active' WHERE e.created_at >= ?").bind(since),
    db.prepare('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?').bind(since),
    db.prepare(
      `SELECT MIN(trim(e.title)) AS title, e.category, COUNT(DISTINCT e.user_id) AS n, ROUND(AVG(e.rating), 2) AS average
         FROM entries e JOIN users u ON u.id = e.user_id AND u.status = 'active'
        WHERE e.is_private = 0 AND e.rating IS NOT NULL
        GROUP BY lower(trim(e.title)), e.category
        ORDER BY n DESC, average DESC, title LIMIT 10`,
    ),
  ]);
  const n = (r: D1Result) => (r.results[0] as { n: number }).n;
  const body: AdminNumbers = {
    members: n(members!),
    active7: n(active!),
    titles7: n(titles!),
    messages7: n(msgs!),
    mostRated: (top!.results as { title: string; category: Category; n: number; average: number }[]).map((r) => ({
      title: r.title, category: r.category, count: r.n, average: r.average,
    })),
  };
  return c.json(body);
});

// ---- lookup tools (AD8) ----

/** Late-bound fetch, so tests can replace globalThis.fetch. */
const lookupDeps = (env: AppEnv['Bindings']) => ({ fetch: ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch, env });

// POST /api/admin/lookup/check -> { sources: SourceCheck[] }: one fixed search per source, in parallel, each with a 10 s limit.
// Sources without their key answer ok: null, "not set up". No database queries (+ sign-in).
admin.post('/lookup/check', async (c) => c.json({ sources: await checkSources(lookupDeps(c.env)) }));

// POST /api/admin/lookup/explain { category, title } -> Explanation: every step the chain tried. 1 query (+ sign-in).
admin.post('/lookup/explain', async (c) => {
  const body = await readJson(c.req.raw);
  const category = body?.category;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (typeof category !== 'string' || !(CATEGORIES as string[]).includes(category) || title === '' || title.length > 500) {
    return c.json({ error: 'invalid' }, 400);
  }
  return c.json(await explainLookup(category as Category, title, lookupDeps(c.env)));
});

// ---- backup (AD10) ----

// GET /api/admin/backup: a JSON attachment with every table's rows except the secrets listed in ../admin/backup.ts.
// One batch, a statement per table (+ sign-in).
admin.get('/backup', async (c) => {
  const names = Object.keys(BACKUP_TABLES);
  const results = await c.env.DB.batch(names.map((t) => c.env.DB.prepare(`SELECT * FROM ${t} ORDER BY rowid`)));
  const tables: Record<string, Record<string, unknown>[]> = {};
  names.forEach((t, i) => {
    const omit = BACKUP_TABLES[t]!;
    tables[t] = (results[i]!.results as Record<string, unknown>[]).map((row) => {
      const out = { ...row };
      for (const col of omit) delete out[col];
      return out;
    });
  });
  const stamp = new Date().toISOString();
  return c.json({ app: 'media-tracker', exportedAt: stamp, excluded: BACKUP_EXCLUDED_NOTE, tables }, 200, {
    'Content-Disposition': `attachment; filename="media-tracker-backup-${stamp.slice(0, 10)}.json"`,
    'Cache-Control': 'no-store',
  });
});
