import { Hono } from 'hono';
import { isCategoryKey, type FriendEntry, type PublicUser, type Relation } from '@media-tracker/shared';
import { customListsSql, parseLists } from '../lists/sql';
import type { AppEnv } from '../auth/user';
import { pushFriendRequest } from '../push/events';
import { ctxOf } from '../push/send';
import { featureOn } from '../settings/appSettings';
import { ENTRY_SELECT, type EntryRow } from './entries';
import {
  FRIEND_IDS_SQL,
  PUBLIC_USER_COLS,
  pair,
  publicUser,
  relationOf,
  toFriendEntry,
  visibleEntrySql,
  type PublicUserRow,
} from '../social/visibility';

/** Mounted at /api/friends. */
export const friends = new Hono<AppEnv>();
/** Mounted at /api/users. */
export const users = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const USERNAME_Q_RE = /^[a-z0-9_]{2,20}$/;
const CODE_RE = /^[a-z0-9]{12}$/;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const userByUsername = (db: D1Database, username: string) =>
  db
    .prepare(`SELECT ${PUBLIC_USER_COLS}, created_at, bio, ${customListsSql('users.id')} FROM users WHERE username = ? AND status = 'active'`)
    .bind(username.toLowerCase())
    .first<PublicUserRow & { created_at: string | null; bio: string | null; custom_lists_json: string | null }>();

// Pending -> accepted when the other side already asked; a fresh pending row otherwise. Never downgrades.
const REQUEST_SQL = `INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?1, ?2, 'pending', ?3, ?4)
  ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', accepted_at = ?4 WHERE friendships.status = 'pending' AND friendships.requested_by <> ?3`;

// 1 query (+ sign-in)
friends.get('/', async (c) => {
  const me = c.var.user.id;
  const { results } = await c.env.DB.prepare(
    `SELECT f.status, f.requested_by, f.created_at AS f_created, f.accepted_at, u.id, u.username, u.display_name, u.avatar_at
     FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
     WHERE (f.user_a = ?1 OR f.user_b = ?1) AND u.status = 'active' ORDER BY u.username`,
  )
    .bind(me)
    .all<PublicUserRow & { status: string; requested_by: string; f_created: string; accepted_at: string | null }>();
  const friendsOut: (PublicUser & { since: string })[] = [];
  const incoming: PublicUser[] = [];
  const outgoing: PublicUser[] = [];
  for (const r of results) {
    if (r.status === 'accepted') friendsOut.push({ ...publicUser(r), since: r.accepted_at ?? r.f_created });
    else if (r.requested_by === me) outgoing.push(publicUser(r));
    else incoming.push(publicUser(r));
  }
  return c.json({ friends: friendsOut, incoming, outgoing });
});

// Static paths first: /entries and /code/:code never collide with /:userId.
// 1 query (+ sign-in): friend ids ride inside the entries statement. Rated, visible entries of every accepted friend.
friends.get('/entries', async (c) => {
  const category = c.req.query('category');
  if (category !== undefined && !isCategoryKey(category)) return c.json(invalid, 400);
  const me = c.var.user.id;
  const stmt = c.env.DB.prepare(
    // visibleEntrySql without its "your own" branch (excluded here anyway), so your own titles are never read.
    `${ENTRY_SELECT} WHERE e.user_id <> ?1 AND e.is_private = 0 AND e.user_id IN (${FRIEND_IDS_SQL('?1')})
     AND (e.rating IS NOT NULL OR EXISTS (SELECT 1 FROM seasons s WHERE s.entry_id = e.id AND s.rating IS NOT NULL))
     ${category ? 'AND e.category = ?2' : ''} ORDER BY e.user_id, e.created_at, e.rowid`,
  );
  const { results } = await (category ? stmt.bind(me, category) : stmt.bind(me)).all<EntryRow>();
  const byUser = new Map<string, FriendEntry[]>();
  for (const row of results) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(toFriendEntry(row, 'friend'));
    byUser.set(row.user_id, list);
  }
  return c.json([...byUser].map(([userId, entries]) => ({ userId, entries })));
});

// 1 query (+ sign-in)
friends.get('/code/:code', async (c) => {
  const code = c.req.param('code');
  if (!CODE_RE.test(code)) return c.json(notFound, 404);
  const row = await c.env.DB.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE invite_code = ? AND status = 'active'`).bind(code).first<PublicUserRow>();
  if (!row) return c.json(notFound, 404);
  if (row.id === c.var.user.id) return c.json({ error: 'self' }, 400);
  return c.json(publicUser(row));
});

// 2 queries (owner of the code, then the upsert) (+ sign-in). The link owner consented by sharing it: accepted at once.
friends.post('/add/:code', featureOn('friends'), async (c) => {
  const code = c.req.param('code');
  if (!CODE_RE.test(code)) return c.json(notFound, 404);
  const row = await c.env.DB.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE invite_code = ? AND status = 'active'`).bind(code).first<PublicUserRow>();
  if (!row) return c.json(notFound, 404);
  const me = c.var.user.id;
  if (row.id === me) return c.json({ error: 'self' }, 400);
  const [a, b] = pair(me, row.id);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO friendships (user_a, user_b, status, requested_by, created_at, accepted_at) VALUES (?1, ?2, 'accepted', ?3, ?4, ?4)
     ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', accepted_at = ?4 WHERE friendships.status = 'pending'`,
  )
    .bind(a, b, me, now)
    .run();
  return c.json({ relation: 'friend' as const, user: publicUser(row) });
});

// 4 queries at most: the target, the current relation, the upsert, the read-back (+ sign-in)
friends.post('/requests', featureOn('friends'), async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || typeof body.username !== 'string') return c.json(invalid, 400);
  const target = await userByUsername(c.env.DB, body.username.trim());
  if (!target) return c.json(notFound, 404);
  const me = c.var.user.id;
  if (target.id === me) return c.json({ error: 'self' }, 400);
  const before = await relationOf(c.env.DB, me, target.id);
  if (before === 'friend') return c.json({ error: 'already_friends' }, 409);
  if (before === 'pending_out') return c.json({ relation: 'pending_out' as const });
  const [a, b] = pair(me, target.id);
  await c.env.DB.prepare(REQUEST_SQL).bind(a, b, me, new Date().toISOString()).run();
  const after = await relationOf(c.env.DB, me, target.id);
  if (after !== 'friend') pushFriendRequest(c.env, ctxOf(c), target.id, c.var.user);
  return c.json({ relation: after === 'friend' ? ('friend' as const) : ('pending_out' as const) });
});

// 1 query (+ sign-in). Only the receiver of a pending request can accept it.
friends.post('/:userId/accept', featureOn('friends'), async (c) => {
  const me = c.var.user.id;
  const other = c.req.param('userId');
  const [a, b] = pair(me, other);
  const res = await c.env.DB.prepare(
    `UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ? AND status = 'pending' AND requested_by = ?`,
  )
    .bind(new Date().toISOString(), a, b, other)
    .run();
  if (!res.meta.changes) return c.json(notFound, 404);
  return c.body(null, 204);
});

// 1 query (+ sign-in). Decline, cancel and remove are the same delete, by either side.
friends.delete('/:userId', async (c) => {
  const [a, b] = pair(c.var.user.id, c.req.param('userId'));
  const res = await c.env.DB.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b).run();
  if (!res.meta.changes) return c.json(notFound, 404);
  return c.body(null, 204);
});

// 1 query (+ sign-in). Registered before /:username. Empty q = everyone (Dan, 2026-11-16: the Add friend
// sheet lists all accounts; a private friend group, so up to 200 by username).
users.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase();
  if (q !== '' && !USERNAME_Q_RE.test(q)) return c.json(invalid, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLS} FROM users WHERE username IS NOT NULL AND status = 'active' AND id <> ?1 AND substr(username, 1, ?2) = ?3 ORDER BY username LIMIT ${q === '' ? 200 : 10}`,
  )
    .bind(c.var.user.id, q.length, q)
    .all<PublicUserRow>();
  return c.json(results.map(publicUser));
});

// 1 query for a friend's avatar and for self's (relationOf is free for self), 2 + 1 otherwise (+ sign-in). Not a friend = 404, like no photo.
users.get('/:id/avatar', async (c) => {
  const id = c.req.param('id');
  const rel = await relationOf(c.env.DB, c.var.user.id, id);
  if (rel !== 'self' && rel !== 'friend') return c.json(notFound, 404);
  const row = await c.env.DB.prepare('SELECT mime, data FROM avatars WHERE user_id = ?').bind(id).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) return c.json(notFound, 404);
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// 2 queries (user, relation; 1 for yourself) (+ sign-in). Header only: never any entries.
users.get('/:username', async (c) => {
  const u = await userByUsername(c.env.DB, c.req.param('username'));
  if (!u) return c.json(notFound, 404);
  const relation: Relation = await relationOf(c.env.DB, c.var.user.id, u.id);
  // The bio is for friends (and yourself): a stranger sees the header only.
  const bio = relation === 'self' || relation === 'friend' ? u.bio ?? null : null;
  // Their custom lists go where their titles go (Dan, 2026-11-19 Q2: same rules as built-in lists): friends and yourself.
  const lists = relation === 'self' || relation === 'friend' ? parseLists(u.custom_lists_json) : [];
  return c.json({ user: publicUser(u), memberSince: u.created_at ?? null, bio, relation, lists });
});

type Resolved = { user: PublicUserRow & { custom_lists_json?: string | null }; rel: Relation };
async function resolve(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, username: string): Promise<Resolved | null> {
  const user = await userByUsername(c.env.DB, username);
  if (!user) return null;
  return { user, rel: await relationOf(c.env.DB, c.var.user.id, user.id) };
}

// 3 queries (user, relation, entries; 2 for yourself) (+ sign-in). Plan said 2: the 403 needs the relation, so it is one more.
users.get('/:username/entries', async (c) => {
  const category = c.req.query('category');
  if (category !== undefined && !isCategoryKey(category)) return c.json(invalid, 400);
  const r = await resolve(c, c.req.param('username'));
  if (!r) return c.json(notFound, 404);
  if (r.rel !== 'self' && r.rel !== 'friend') return c.json({ error: 'not_friends' }, 403);
  const stmt = c.env.DB.prepare(
    `${ENTRY_SELECT} WHERE e.user_id = ?2 AND ${visibleEntrySql('e', '?1')} ${category ? 'AND e.category = ?3' : ''} ORDER BY e.created_at, e.rowid`,
  );
  const me = c.var.user.id;
  const { results } = await (category ? stmt.bind(me, r.user.id, category) : stmt.bind(me, r.user.id)).all<EntryRow>();
  return c.json(results.map((row) => toFriendEntry(row, r.rel)));
});

// 4 queries (user, relation, entry, seasons; 3 for yourself) (+ sign-in). Not visible for any reason = 404.
users.get('/:username/entries/:id', async (c) => {
  const r = await resolve(c, c.req.param('username'));
  if (!r || (r.rel !== 'self' && r.rel !== 'friend')) return c.json(notFound, 404);
  const row = await c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.id = ?3 AND e.user_id = ?2 AND ${visibleEntrySql('e', '?1')}`)
    .bind(c.var.user.id, r.user.id, c.req.param('id'))
    .first<EntryRow>();
  if (!row) return c.json(notFound, 404);
  const entry = toFriendEntry(row, r.rel);
  const { results } = await c.env.DB.prepare('SELECT id, label, rating, notes FROM seasons WHERE entry_id = ? ORDER BY created_at, id')
    .bind(row.id)
    .all<{ id: string; label: string; rating: number | null; notes: string }>();
  const seasons = results.map((s) => ({ id: s.id, label: s.label, rating: s.rating, notes: row.notes_private === 1 ? null : s.notes }));
  // A custom list's name, words and columns, so the page reads like the owner's (null on built-in lists).
  const list = parseLists(r.user.custom_lists_json).find((l) => l.key === entry.category) ?? null;
  return c.json({ entry, seasons, list });
});

