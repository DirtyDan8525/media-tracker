import { Hono } from 'hono';
import {
  COMMENT_MAX,
  GIF_MAX_BYTES,
  IMAGE_MAX_BYTES,
  isReaction,
  withRecentEmoji,
  type Comment,
  type PublicUser,
  type PostSocial,
  type Reaction,
  type Target,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { pushComment, pushReaction } from '../push/events';
import { ctxOf } from '../push/send';
import { canView, canViewPost, publicUser, relationOf } from '../social/visibility';
import { featureOn, loadAppSettings } from '../settings/appSettings';
import { makeRoom, removeMedia } from '../media/store';
import { IMAGE_EXT_OK, readCapped, serveObject } from '../media/files';

export const social = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const COMMENTS_MAX_LIST = 200;
const newId = () => crypto.randomUUID().replaceAll('-', '');

/** Exactly one of activityId / entryId, as a non-empty string; null otherwise. */
function parseTarget(src: Record<string, unknown>): Target | null {
  const a = src.activityId;
  const e = src.entryId;
  const hasA = a !== undefined && a !== null && a !== '';
  const hasE = e !== undefined && e !== null && e !== '';
  if (hasA === hasE) return null;
  if (hasA) return typeof a === 'string' ? { activityId: a } : null;
  return typeof e === 'string' ? { entryId: e } : null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The entry behind a reaction/comment target, or null when it is missing or the viewer may not see
 * it. Reactions and comments are stored on the entry only (Dan 2026-11-20, migration 0025): a post's
 * reactions and comments are its title's, so `activityId` (still accepted, old clients and the
 * Activity screen) is resolved to the post's entry here. A post id must be an anchor (`post_id IS
 * NULL`). Amends S7 (Dan 2026-11-16: Everyone = all active users): a post is open to you when it is
 * yours or its entry is not private and its author is active, friend or not (1 query), and through
 * it you see and add to its title's reactions and comments; an entry target stays friends-only (1
 * query, plus 1 for the friendship unless the viewer owns the entry).
 */
export async function resolveTarget(
  db: D1Database,
  viewerId: string,
  target: Target,
): Promise<{ ownerId: string; entryId: string } | null> {
  if ('activityId' in target) {
    const row = await db
      .prepare(
        `SELECT e.user_id, e.id, e.is_private, u.status FROM activity a
           JOIN entries e ON e.id = a.entry_id JOIN users u ON u.id = e.user_id
          WHERE a.id = ? AND a.post_id IS NULL`,
      )
      .bind(target.activityId)
      .first<{ user_id: string; id: string; is_private: number; status: string }>();
    if (!row || !canViewPost(viewerId, { ownerId: row.user_id, isPrivate: row.is_private === 1, ownerStatus: row.status })) return null;
    return { ownerId: row.user_id, entryId: row.id };
  }
  const row = await db
    .prepare('SELECT user_id, id, is_private FROM entries WHERE id = ?')
    .bind(target.entryId)
    .first<{ user_id: string; id: string; is_private: number }>();
  if (!row) return null;
  const rel = await relationOf(db, viewerId, row.user_id);
  if (!canView(rel, { isPrivate: row.is_private === 1 })) return null;
  return { ownerId: row.user_id, entryId: row.id };
}

/** A8: written by a user who is active (pending and removed users' rows stay, unseen). */
const BY_ACTIVE = `user_id IN (SELECT id FROM users WHERE status = 'active')`;

/** 1 query: reaction counts per emoji, my emoji, and the live comment count (a '#comments' row). */
async function socialOf(db: D1Database, viewerId: string, entryId: string): Promise<PostSocial> {
  const { results } = await db
    .prepare(
      `SELECT emoji, COUNT(*) AS n, MAX(user_id = ?1) AS mine FROM reactions WHERE entry_id = ?2 AND ${BY_ACTIVE} GROUP BY emoji
       UNION ALL
       SELECT '#comments', COUNT(*), 0 FROM comments WHERE entry_id = ?2 AND deleted_at IS NULL AND ${BY_ACTIVE}`,
    )
    .bind(viewerId, entryId)
    .all<{ emoji: string; n: number; mine: number }>();
  const out: PostSocial = { reactions: {}, mine: [], comments: 0 };
  for (const r of results) {
    if (r.emoji === '#comments') out.comments = r.n;
    else if (isReaction(r.emoji)) {
      out.reactions[r.emoji] = r.n;
      if (r.mine === 1) out.mine.push(r.emoji);
    }
  }
  return out;
}

// POST /reactions: 3-5 queries (+ sign-in): target (1) + friendship (0-1) + delete (1) + insert (0-1) + summary (1).
social.post('/reactions', featureOn('reactions'), async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const target = parseTarget(body);
  if (!target || !isReaction(body.emoji)) return c.json(invalid, 400);
  const emoji: Reaction = body.emoji;
  const user = c.var.user;
  const db = c.env.DB;

  const at = await resolveTarget(db, user.id, target);
  if (!at) return c.json(notFound, 404);

  const removed = await db
    .prepare('DELETE FROM reactions WHERE entry_id = ? AND user_id = ? AND emoji = ? RETURNING id')
    .bind(at.entryId, user.id, emoji)
    .first<{ id: string }>();
  if (!removed) {
    const insert = db
      .prepare('INSERT OR IGNORE INTO reactions (id, entry_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), at.entryId, user.id, emoji, new Date().toISOString());
    // A custom emoji (not in the quick set) goes to the front of your "Recent" row, in the same batch.
    const recent = withRecentEmoji(user.recentEmoji, emoji);
    if (JSON.stringify(recent) !== JSON.stringify(user.recentEmoji)) {
      await db.batch([insert, db.prepare('UPDATE users SET recent_emoji = ? WHERE id = ?').bind(JSON.stringify(recent), user.id)]);
    } else {
      await insert.run();
    }
    pushReaction(c.env, ctxOf(c), at.ownerId, user, at.entryId, emoji);
  }
  return c.json(await socialOf(db, user.id, at.entryId));
});

// GET /reactions?entryId=|activityId=: 3 queries (+ sign-in)
social.get('/reactions', async (c) => {
  const target = parseTarget(c.req.query());
  if (!target) return c.json(invalid, 400);
  const at = await resolveTarget(c.env.DB, c.var.user.id, target);
  if (!at) return c.json(notFound, 404);
  return c.json(await socialOf(c.env.DB, c.var.user.id, at.entryId));
});

// GET /reactions/who?entryId=|activityId=: 2-3 queries (+ sign-in): target (1-2) + reactions with people (1).
// One group per emoji: most reactions first, ties by who reacted first. People within a group: oldest reaction first.
social.get('/reactions/who', async (c) => {
  const target = parseTarget(c.req.query());
  if (!target) return c.json(invalid, 400);
  const at = await resolveTarget(c.env.DB, c.var.user.id, target);
  if (!at) return c.json(notFound, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT r.emoji, u.id, u.username, u.display_name, u.avatar_at
     FROM reactions r JOIN users u ON u.id = r.user_id
     WHERE r.entry_id = ? AND u.status = 'active'
     ORDER BY r.created_at, r.id`,
  )
    .bind(at.entryId)
    .all<{ emoji: string; id: string; username: string | null; display_name: string | null; avatar_at: string | null }>();
  const groups = new Map<string, PublicUser[]>(); // Map keeps first-seen order = first reaction time
  for (const r of results) {
    if (!isReaction(r.emoji)) continue;
    const users = groups.get(r.emoji) ?? [];
    users.push(publicUser({ id: r.id, username: r.username, display_name: r.display_name, avatar_at: r.avatar_at }));
    groups.set(r.emoji, users);
  }
  const out = [...groups].map(([emoji, users]) => ({ emoji, users }));
  out.sort((a, b) => b.users.length - a.users.length); // stable: ties keep first-reaction order
  return c.json(out);
});

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  has_image: number;
  media_expired: number;
  u_id: string;
  username: string | null;
  display_name: string | null;
  avatar_at: string | null;
}

// GET /comments?entryId=|activityId=: 3 queries (+ sign-in); oldest first, at most 200, deleted ones left out.
social.get('/comments', async (c) => {
  const target = parseTarget(c.req.query());
  if (!target) return c.json(invalid, 400);
  const viewerId = c.var.user.id;
  const at = await resolveTarget(c.env.DB, viewerId, target);
  if (!at) return c.json(notFound, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, c.media_key IS NOT NULL AS has_image, c.media_expired, u.id AS u_id, u.username, u.display_name, u.avatar_at
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.entry_id = ? AND c.deleted_at IS NULL AND u.status = 'active'
     ORDER BY c.created_at, c.id LIMIT ${COMMENTS_MAX_LIST}`,
  )
    .bind(at.entryId)
    .all<CommentRow>();
  const out: Comment[] = results.map((r) => ({
    id: r.id,
    author: publicUser({ id: r.u_id, username: r.username, display_name: r.display_name, avatar_at: r.avatar_at }),
    body: r.body,
    image: r.has_image === 1,
    expired: r.media_expired === 1,
    createdAt: r.created_at,
    canDelete: r.user_id === viewerId || at.ownerId === viewerId,
  }));
  return c.json(out);
});

// POST /comments/media?entryId=|activityId=: a photo or GIF for a comment (raw body, its type in Content-Type, checked by its first
// bytes; the same limits as chat: 2 MB (the app resizes photos first), GIF 8 MB). Stored first, "pending" in the media ledger;
// POST /comments with the returned mediaId attaches it (one not attached within an hour is cleaned up). The sender's per-person
// cap applies as in chat. 201 { mediaId }. Needs the Comments and Photos switches and the storage (503).
social.post('/comments/media', async (c) => {
  const settings = await loadAppSettings(c.env.DB);
  if (!settings.features.comments || !settings.features.photos) return c.json({ error: 'feature_off' }, 403);
  if (!c.env.MEDIA) return c.json({ error: 'not_configured' }, 503);
  const target = parseTarget(c.req.query());
  if (!target) return c.json(invalid, 400);
  const user = c.var.user;
  const at = await resolveTarget(c.env.DB, user.id, target);
  if (!at) return c.json(notFound, 404);
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const matches = Object.hasOwn(IMAGE_EXT_OK, type) ? IMAGE_EXT_OK[type] : undefined;
  if (!matches) return c.json({ error: 'unsupported_media_type' }, 415);
  const bytes = await readCapped(c.req.raw, type === 'image/gif' ? GIF_MAX_BYTES : IMAGE_MAX_BYTES);
  if (bytes === null) return c.json({ error: 'too_large' }, 413);
  if (bytes.byteLength < 12 || !matches(bytes)) return c.json(invalid, 400);
  await makeRoom(c.env, user.id, settings.media.capMb, bytes.byteLength);
  const mediaId = newId();
  // Not guessable: a random 128-bit name under the title (served only through GET /api/comments/:id/media).
  const key = `cmt/${at.entryId}/${mediaId}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    await c.env.DB.prepare("INSERT INTO media (key, entry_id, user_id, kind, bytes, created_at) VALUES (?1, ?2, ?3, 'photo', ?4, ?5)")
      .bind(key, at.entryId, user.id, bytes.byteLength, new Date().toISOString()).run();
  } catch (e) {
    await c.env.MEDIA.delete(key).catch(() => undefined);
    throw e;
  }
  return c.json({ mediaId }, 201);
});

// POST /comments: 3-5 queries (+ sign-in): target (1) + friendship (0-1) + the picture (0-1) + insert (1). Text 1..500 characters,
// or none when there is a picture (`mediaId` from POST /comments/media, yours, for this title, not yet used).
social.post('/comments', featureOn('comments'), async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const target = parseTarget(body);
  const mediaId = body.mediaId;
  if (!target || (body.body !== undefined && typeof body.body !== 'string')) return c.json(invalid, 400);
  if (mediaId !== undefined && (typeof mediaId !== 'string' || !/^[0-9a-f]{32}$/.test(mediaId))) return c.json(invalid, 400);
  const text = (body.body ?? '').toString().trim();
  if (text.length > COMMENT_MAX || (text.length < 1 && mediaId === undefined)) return c.json(invalid, 400);
  const user = c.var.user;
  const db = c.env.DB;
  const at = await resolveTarget(db, user.id, target);
  if (!at) return c.json(notFound, 404);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  let key: string | null = null;
  if (mediaId !== undefined) {
    if (!(await loadAppSettings(db)).features.photos) return c.json({ error: 'feature_off' }, 403);
    key = `cmt/${at.entryId}/${mediaId}`;
    const file = await db.prepare('SELECT 1 AS ok FROM media WHERE key = ? AND user_id = ? AND comment_id IS NULL AND deleted_at IS NULL')
      .bind(key, user.id).first();
    if (!file) return c.json({ error: 'media_not_found' }, 400);
  }
  const insert = db.prepare('INSERT INTO comments (id, entry_id, user_id, body, media_key, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, at.entryId, user.id, text, key, createdAt);
  if (key) await db.batch([insert, db.prepare('UPDATE media SET comment_id = ? WHERE key = ?').bind(id, key)]);
  else await insert.run();
  pushComment(c.env, ctxOf(c), at.ownerId, user, at.entryId, text);
  const comment: Comment = {
    id,
    author: { id: user.id, username: user.username ?? '', displayName: user.displayName, avatarAt: user.avatarAt },
    body: text,
    image: key !== null,
    expired: false,
    createdAt,
    canDelete: true,
  };
  return c.json(comment, 201);
});

interface ThreadRow { owner: string; is_private: number; owner_status: string; has_post: number }
const THREAD_COLS = `e.user_id AS owner, e.is_private, u.status AS owner_status,
            EXISTS (SELECT 1 FROM activity a WHERE a.user_id = e.user_id AND a.entry_id = e.id AND a.post_id IS NULL) AS has_post`;

/**
 * Can this person read the thread of the comment's title? The one rule of reading it (resolveTarget): through one of the
 * title's posts (any active user's non-private post, Dan 2026-11-16), or on the title itself (friends only). AD7: the admin
 * moderates, private posts included. 0-1 queries.
 */
async function threadVisible(db: D1Database, user: { id: string; isAdmin: boolean }, row: ThreadRow): Promise<boolean> {
  if (user.isAdmin) return true;
  const isPrivate = row.is_private === 1;
  return (row.has_post === 1 && canViewPost(user.id, { ownerId: row.owner, isPrivate, ownerStatus: row.owner_status }))
    || canView(await relationOf(db, user.id, row.owner), { isPrivate });
}

// GET /comments/:id/media: the comment's photo or GIF: 1-2 queries + the R2 get (+ sign-in). Whoever may read that title's
// comments (see threadVisible), by an active author, while the comment is live. 404 otherwise, or once the file expired.
social.get('/comments/:id/media', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT c.media_key, a.status AS author_status, ${THREAD_COLS}
     FROM comments c JOIN entries e ON e.id = c.entry_id JOIN users u ON u.id = e.user_id JOIN users a ON a.id = c.user_id
     WHERE c.id = ? AND c.deleted_at IS NULL AND c.media_key IS NOT NULL`,
  )
    .bind(c.req.param('id'))
    .first<ThreadRow & { media_key: string; author_status: string }>();
  if (!row || row.author_status !== 'active' || !(await threadVisible(c.env.DB, c.var.user, row))) return c.json(notFound, 404);
  return serveObject(c, row.media_key);
});

// DELETE /comments/:id: 2-3 queries (+ sign-in): comment with its entry (1) + friendship (0-1) + soft delete (1) (+ its picture).
// Author or entry owner -> 204; someone else who can see it -> 403; not visible or gone -> 404. The picture's file goes too.
social.delete('/comments/:id', async (c) => {
  const user = c.var.user;
  const row = await c.env.DB.prepare(
    `SELECT c.user_id AS author, c.deleted_at, c.media_key, ${THREAD_COLS}
     FROM comments c JOIN entries e ON e.id = c.entry_id JOIN users u ON u.id = e.user_id
     WHERE c.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<ThreadRow & { author: string; deleted_at: string | null; media_key: string | null }>();
  if (!row || row.deleted_at !== null) return c.json(notFound, 404);
  if (!(await threadVisible(c.env.DB, user, row))) return c.json(notFound, 404);
  if (!user.isAdmin && row.author !== user.id && row.owner !== user.id) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare('UPDATE comments SET deleted_at = ?, media_key = NULL WHERE id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), c.req.param('id'))
    .run();
  if (row.media_key) await removeMedia(c.env, [row.media_key]).catch(() => undefined);
  return c.body(null, 204);
});
