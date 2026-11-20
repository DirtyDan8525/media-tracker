/**
 * Public profile pages (Phase 5 item 34), mounted at /api/public OUTSIDE requireUser, like /api/auth and
 * /api/app: anyone holding the link reads them, signed in or not. Strictly read-only (GET only; every
 * other method is 405). What leaves is at most what an accepted friend sees (`toFriendEntry`): never a
 * private entry, never private notes, never comparisons, strength, priorMean or scoreLocked, and of the
 * user only the public header (`publicUser`), bio and counts. Unknown, malformed, replaced or turned-off
 * tokens, and users who are not active (pending, removed), are all 404. JSON is `private, no-store`.
 */
import { Hono } from 'hono';
import type { FriendEntry } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { publicTokenHash } from '../social/publicLink';
import { PUBLIC_USER_COLS, publicUser, toFriendEntry, type PublicUserRow } from '../social/visibility';
import { coverUrlOf, serveCover } from './cover';
import { TAGS_SUBSELECT, type EntryRow } from './entries';

export const publicApi = new Hono<AppEnv>();

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const notFound = { error: 'not_found' } as const;

// Read-only: refuse every write before anything else runs.
publicApi.on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', (c) => c.json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' }));

// 1 query: the owner (by token hash, active only) with their visible counts.
publicApi.get('/:token', async (c) => {
  const hash = await publicTokenHash(c.req.param('token'));
  if (!hash) return c.json(notFound, 404, NO_STORE);
  const row = await c.env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLS}, created_at, bio,
       (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.is_private = 0) AS titles,
       (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.is_private = 0 AND e.rating IS NOT NULL) AS rated
     FROM users u WHERE u.public_token_hash = ? AND u.status = 'active'`,
  )
    .bind(hash)
    .first<PublicUserRow & { created_at: string | null; bio: string | null; titles: number; rated: number }>();
  if (!row) return c.json(notFound, 404, NO_STORE);
  return c.json(
    { user: publicUser(row), memberSince: row.created_at ?? null, bio: row.bio ?? null, counts: { titles: row.titles, rated: row.rated } },
    200,
    NO_STORE,
  );
});

// 1 query: the owner joined to their non-private entries (one row with no entry when they have none).
publicApi.get('/:token/entries', async (c) => {
  const hash = await publicTokenHash(c.req.param('token'));
  if (!hash) return c.json(notFound, 404, NO_STORE);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS owner_id, e.*, (SELECT AVG(s.rating) FROM seasons s WHERE s.entry_id = e.id AND s.rating IS NOT NULL) AS season_avg, ${TAGS_SUBSELECT}
     FROM users u LEFT JOIN entries e ON e.user_id = u.id AND e.is_private = 0
     WHERE u.public_token_hash = ? AND u.status = 'active' ORDER BY e.created_at, e.rowid`,
  )
    .bind(hash)
    .all<EntryRow & { owner_id: string; id: string | null }>();
  if (results.length === 0) return c.json(notFound, 404, NO_STORE);
  // `toFriendEntry` re-checks is_private and drops private notes: a public visitor sees what a friend sees.
  const out: FriendEntry[] = results.filter((r) => r.id !== null).map((r) => toFriendEntry(r as EntryRow, 'friend'));
  return c.json(out, 200, NO_STORE);
});

// 1 query.
publicApi.get('/:token/avatar', async (c) => {
  const hash = await publicTokenHash(c.req.param('token'));
  if (!hash) return c.json(notFound, 404, NO_STORE);
  const row = await c.env.DB.prepare(
    `SELECT a.mime, a.data FROM users u JOIN avatars a ON a.user_id = u.id WHERE u.public_token_hash = ? AND u.status = 'active'`,
  )
    .bind(hash)
    .first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) return c.json(notFound, 404, NO_STORE);
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
});

// 1 query (plus, on an anime fallback, the cover proxy's own 1-2). Only the owner's non-private entries.
publicApi.get('/:token/cover/:entryId', async (c) => {
  const hash = await publicTokenHash(c.req.param('token'));
  if (!hash) return c.json(notFound, 404, NO_STORE);
  const row = await c.env.DB.prepare(
    `SELECT e.title, e.category, e.cover_url FROM users u JOIN entries e ON e.user_id = u.id
     WHERE u.public_token_hash = ?1 AND u.status = 'active' AND e.id = ?2 AND e.is_private = 0`,
  )
    .bind(hash, c.req.param('entryId'))
    .first<{ title: string; category: string; cover_url: string | null }>();
  const first = coverUrlOf(row?.cover_url ?? null);
  if (!row || !first) return c.json(notFound, 404, NO_STORE);
  return serveCover(row.cover_url!, first, row, c.env.DB);
});
