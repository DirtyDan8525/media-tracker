import { Hono } from 'hono';
import {
  COMMENT_MAX,
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
import { featureOn } from '../settings/appSettings';

export const social = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const COMMENTS_MAX_LIST = 200;

const col = (t: Target) => ('activityId' in t ? 'activity_id' : 'entry_id');
const idOf = (t: Target) => ('activityId' in t ? t.activityId : t.entryId);

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
 * it. A post id must be an anchor (`post_id IS NULL`). Amends S7 (Dan 2026-11-16: Everyone = all
 * active users): a post is open to you when it is yours or its entry is not private and its author
 * is active, friend or not (1 query); an entry target stays friends-only (1 query, plus 1 for the
 * friendship unless the viewer owns the entry).
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
async function socialOf(db: D1Database, viewerId: string, target: Target): Promise<PostSocial> {
  const c = col(target);
  const { results } = await db
    .prepare(
      `SELECT emoji, COUNT(*) AS n, MAX(user_id = ?1) AS mine FROM reactions WHERE ${c} = ?2 AND ${BY_ACTIVE} GROUP BY emoji
       UNION ALL
       SELECT '#comments', COUNT(*), 0 FROM comments WHERE ${c} = ?2 AND deleted_at IS NULL AND ${BY_ACTIVE}`,
    )
    .bind(viewerId, idOf(target))
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

  const column = col(target);
  const removed = await db
    .prepare(`DELETE FROM reactions WHERE ${column} = ? AND user_id = ? AND emoji = ? RETURNING id`)
    .bind(idOf(target), user.id, emoji)
    .first<{ id: string }>();
  if (!removed) {
    const insert = db
      .prepare(`INSERT OR IGNORE INTO reactions (id, ${column}, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), idOf(target), user.id, emoji, new Date().toISOString());
    // A custom emoji (not in the quick set) goes to the front of your "Recent" row, in the same batch.
    const recent = withRecentEmoji(user.recentEmoji, emoji);
    if (JSON.stringify(recent) !== JSON.stringify(user.recentEmoji)) {
      await db.batch([insert, db.prepare('UPDATE users SET recent_emoji = ? WHERE id = ?').bind(JSON.stringify(recent), user.id)]);
    } else {
      await insert.run();
    }
    pushReaction(c.env, ctxOf(c), at.ownerId, user, idOf(target), at.entryId, emoji);
  }
  return c.json(await socialOf(db, user.id, target));
});

// GET /reactions?entryId=|activityId=: 3 queries (+ sign-in)
social.get('/reactions', async (c) => {
  const target = parseTarget(c.req.query());
  if (!target) return c.json(invalid, 400);
  if (!(await resolveTarget(c.env.DB, c.var.user.id, target))) return c.json(notFound, 404);
  return c.json(await socialOf(c.env.DB, c.var.user.id, target));
});

// GET /reactions/who?entryId=|activityId=: 2-3 queries (+ sign-in): target (1-2) + reactions with people (1).
// One group per emoji: most reactions first, ties by who reacted first. People within a group: oldest reaction first.
social.get('/reactions/who', async (c) => {
  const target = parseTarget(c.req.query());
  if (!target) return c.json(invalid, 400);
  if (!(await resolveTarget(c.env.DB, c.var.user.id, target))) return c.json(notFound, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT r.emoji, u.id, u.username, u.display_name, u.avatar_at
     FROM reactions r JOIN users u ON u.id = r.user_id
     WHERE r.${col(target)} = ? AND u.status = 'active'
     ORDER BY r.created_at, r.id`,
  )
    .bind(idOf(target))
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
    `SELECT c.id, c.body, c.created_at, c.user_id, u.id AS u_id, u.username, u.display_name, u.avatar_at
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.${col(target)} = ? AND c.deleted_at IS NULL AND u.status = 'active'
     ORDER BY c.created_at, c.id LIMIT ${COMMENTS_MAX_LIST}`,
  )
    .bind(idOf(target))
    .all<CommentRow>();
  const out: Comment[] = results.map((r) => ({
    id: r.id,
    author: publicUser({ id: r.u_id, username: r.username, display_name: r.display_name, avatar_at: r.avatar_at }),
    body: r.body,
    createdAt: r.created_at,
    canDelete: r.user_id === viewerId || at.ownerId === viewerId,
  }));
  return c.json(out);
});

// POST /comments: 3-4 queries (+ sign-in): target (1) + friendship (0-1) + insert (1).
social.post('/comments', featureOn('comments'), async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const target = parseTarget(body);
  if (!target || typeof body.body !== 'string') return c.json(invalid, 400);
  const text = body.body.trim();
  if (text.length < 1 || text.length > COMMENT_MAX) return c.json(invalid, 400);
  const user = c.var.user;
  const at = await resolveTarget(c.env.DB, user.id, target);
  if (!at) return c.json(notFound, 404);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO comments (id, ${col(target)}, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, idOf(target), user.id, text, createdAt)
    .run();
  pushComment(c.env, ctxOf(c), at.ownerId, user, idOf(target), at.entryId, text);
  const comment: Comment = {
    id,
    author: { id: user.id, username: user.username ?? '', displayName: user.displayName, avatarAt: user.avatarAt },
    body: text,
    createdAt,
    canDelete: true,
  };
  return c.json(comment, 201);
});

// DELETE /comments/:id: 3 queries (+ sign-in): comment with its entry (1) + friendship (0-1) + soft delete (1).
// Author or entry owner -> 204; someone else who can see it -> 403; not visible or gone -> 404.
social.delete('/comments/:id', async (c) => {
  const user = c.var.user;
  const row = await c.env.DB.prepare(
    `SELECT c.user_id AS author, c.deleted_at, c.activity_id, e.user_id AS owner, e.is_private, u.status AS owner_status
     FROM comments c LEFT JOIN activity a ON a.id = c.activity_id
     JOIN entries e ON e.id = COALESCE(c.entry_id, a.entry_id) JOIN users u ON u.id = e.user_id
     WHERE c.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<{ author: string; deleted_at: string | null; activity_id: string | null; owner: string; is_private: number; owner_status: string }>();
  if (!row || row.deleted_at !== null) return c.json(notFound, 404);
  // AD7: the admin moderates any comment, private posts included.
  if (!user.isAdmin) {
    // A post's thread is open to any active user's non-private post (Dan 2026-11-16); an entry's stays friends-only.
    const visible = row.activity_id !== null
      ? canViewPost(user.id, { ownerId: row.owner, isPrivate: row.is_private === 1, ownerStatus: row.owner_status })
      : canView(await relationOf(c.env.DB, user.id, row.owner), { isPrivate: row.is_private === 1 });
    if (!visible) return c.json(notFound, 404);
    if (row.author !== user.id && row.owner !== user.id) return c.json({ error: 'forbidden' }, 403);
  }
  await c.env.DB.prepare('UPDATE comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), c.req.param('id'))
    .run();
  return c.body(null, 204);
});
