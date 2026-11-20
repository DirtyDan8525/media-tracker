import { Hono } from 'hono';
import {
  ACTIVITY_MERGE_MS, FEED_SCOPES, isReaction,
  type ActivityItem, type ActivityPage, type ActivityType, type Category, type Entry, type FeedScope, type PostSocial, type PublicUser, type Reaction,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { FRIEND_IDS_SQL, PUBLIC_USER_COLS, feedVisibleSql, publicUser, visibleEntrySql, type PublicUserRow } from '../social/visibility';

export const activity = new Hono<AppEnv>();

/** Posts per page (S6). */
const PAGE = 30;
/** The unread count stops here (S8). */
const UNREAD_CAP = 99;
const NEW_ID = `lower(hex(randomblob(16)))`;
const INSERT = `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at, post_id)`;

/**
 * S5: the anchor a new row of entry `e` joins: its user's newest anchor row (post_id IS NULL) for
 * that entry from the last 10 minutes, or NULL (the new row is an anchor itself). Rows inserted
 * earlier in the same batch count, so a rating + status PATCH lands in one post.
 */
const anchorOf = (cutoffParam: string) =>
  `(SELECT a.id FROM activity a WHERE a.user_id = e.user_id AND a.entry_id = e.id AND a.post_id IS NULL
      AND json_extract(a.payload_json, '$.seasonId') IS NULL
      AND a.created_at >= ${cutoffParam} ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`;
/** Season ratings join only a post of the same season (never the title's own post), same 10-minute rule. */
const seasonAnchorOf = (cutoffParam: string) =>
  `(SELECT a.id FROM activity a WHERE a.user_id = e.user_id AND a.entry_id = e.id AND a.post_id IS NULL
      AND json_extract(a.payload_json, '$.seasonId') = s.id
      AND a.created_at >= ${cutoffParam} ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`;
const cutoffOf = (now: string) => new Date(Date.parse(now) - ACTIVITY_MERGE_MS).toISOString();

type Changes = { rating?: number | null; status?: string | null };

/**
 * The `added` row for a new entry. Batch it AFTER the entry's INSERT (foreign key, and it reads
 * the row). A new entry has no earlier rows, so this is always an anchor; the subquery keeps every
 * builder on the one S5 rule. `now` is the insert time (tests pass their own).
 */
export function activityForCreate(
  db: D1Database,
  userId: string,
  entryId: string,
  values: Changes,
  now: string,
): D1PreparedStatement {
  const payload: Changes = {};
  if (values.rating !== undefined) payload.rating = values.rating;
  if (values.status !== undefined) payload.status = values.status;
  return db
    .prepare(
      `${INSERT}
       SELECT ${NEW_ID}, e.user_id, e.id, 'added', ?3, ?4, ?4, ${anchorOf('?5')}
         FROM entries e WHERE e.id = ?2 AND e.user_id = ?1`,
    )
    .bind(userId, entryId, JSON.stringify(payload), now, cutoffOf(now));
}

/**
 * 0-2 rows for a PATCH (rated / re-rated, status). Each compares against the STORED row, so
 * batch these BEFORE the UPDATE. Clearing a rating or status, or an unchanged value, logs nothing.
 */
export function activityForPatch(
  db: D1Database,
  userId: string,
  entryId: string,
  patch: Changes,
  now: string,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  if (typeof patch.rating === 'number') {
    out.push(
      db
        .prepare(
          `${INSERT}
           SELECT ${NEW_ID}, e.user_id, e.id, CASE WHEN e.rating IS NULL THEN 'rated' ELSE 're-rated' END,
                  json_object('from', e.rating, 'to', ?3), ?4, ?4, ${anchorOf('?5')}
             FROM entries e WHERE e.id = ?1 AND e.user_id = ?2 AND (e.rating IS NULL OR e.rating <> ?3)`,
        )
        .bind(entryId, userId, patch.rating, now, cutoffOf(now)),
    );
  }
  if (typeof patch.status === 'string') {
    out.push(
      db
        .prepare(
          `${INSERT}
           SELECT ${NEW_ID}, e.user_id, e.id, 'status', json_object('from', e.status, 'to', ?3), ?4, ?4, ${anchorOf('?5')}
             FROM entries e WHERE e.id = ?1 AND e.user_id = ?2 AND e.status IS NOT ?3`,
        )
        .bind(entryId, userId, patch.status, now, cutoffOf(now)),
    );
  }
  return out;
}

/**
 * A season's rating save (POST or PATCH /api/.../seasons): 'rated' (from null) or 're-rated' on the
 * parent entry, tagged with `seasonId` and the season's `label` so the feed names "Title · Season".
 * Rows of one season within 10 minutes fold into one post (S5), like a title's re-rates; a season's
 * rows never join the title's own post. Nothing when `to` is null or equals `from` (the shown
 * ratings). Batch it AFTER the season's INSERT / label UPDATE (it reads the label).
 */
export function activityForSeason(
  db: D1Database,
  userId: string,
  seasonId: string,
  from: number | null,
  to: number | null,
  now: string,
): D1PreparedStatement[] {
  if (to === null || from === to) return [];
  return [db
    .prepare(
      `${INSERT}
       SELECT ${NEW_ID}, e.user_id, e.id, ?3, json_object('from', ?4, 'to', ?5, 'seasonId', s.id, 'season', s.label), ?6, ?6, ${seasonAnchorOf('?7')}
         FROM seasons s JOIN entries e ON e.id = s.entry_id WHERE s.id = ?1 AND e.user_id = ?2`,
    )
    .bind(seasonId, userId, from === null ? 'rated' : 're-rated', from, to, now, cutoffOf(now))];
}

interface Row {
  id: string; post_id: string | null; user_id: string; type: ActivityType; entry_id: string; payload_json: string;
  created_at: string; category: Category; title: string; cover_url: string; creator: string; source: Entry['source']; source_id: string | null; release_date: string; note: string | null;
}

function parsePayload(json: string): ActivityItem['payload'] {
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as ActivityItem['payload']) : {};
  } catch {
    return {};
  }
}

/**
 * S6, amended by Dan 2026-11-16: Everyone = all active users. An anchor row `a` (joined to its
 * entry `e`, viewer at ?1) whose post is more than a bare "added": the anchor carries a rating or
 * status, or a later row joined it (only an anchor can be "added"). Never a bare "added" of
 * others, never a private entry's post unless it is yours, never a pending or removed user's.
 */
const NOT_BARE = `(a.type <> 'added' OR json_extract(a.payload_json, '$.rating') IS NOT NULL
      OR json_extract(a.payload_json, '$.status') IS NOT NULL
      OR EXISTS (SELECT 1 FROM activity p WHERE p.post_id = a.id))`;
/** Friends' posts (the Friends scope and the unread count stay friends-only). */
const FRIENDS_POSTS = `(a.user_id IN (${FRIEND_IDS_SQL('?1')}) AND ${visibleEntrySql('e', '?1')} AND ${NOT_BARE})`;
const SCOPE: Record<FeedScope, string> = {
  you: 'a.user_id = ?1',
  friends: FRIENDS_POSTS,
  // A bare "added" shows only in You, your own included.
  everyone: `(${feedVisibleSql('e', '?1')} AND ${NOT_BARE})`,
};
/** The rows of the found posts are re-checked with their scope's own rule. */
const ROW_VISIBLE: Record<FeedScope, string> = {
  you: visibleEntrySql('e', '?1'),
  friends: visibleEntrySql('e', '?1'),
  everyone: feedVisibleSql('e', '?1'),
};

const isScope = (v: string): v is FeedScope => (FEED_SCOPES as readonly string[]).includes(v);

// 1 query + 1 batch of 4 (rows, users + friend flag, reactions, comment counts), plus sign-in (1-3): ≤ 8.
// Pages are 30 posts, by anchor (created_at, id); visibility is read-time, so an entry made
// private disappears from others' feeds at once (review focus 1).
activity.get('/', async (c) => {
  const show = c.req.query('show') ?? 'everyone';
  const before = c.req.query('before');
  const beforeId = c.req.query('beforeId');
  if (!isScope(show)) return c.json({ error: 'invalid' }, 400);
  if ((before === undefined) !== (beforeId === undefined)) return c.json({ error: 'invalid' }, 400);
  if (before !== undefined && (before.length > 40 || beforeId!.length > 64)) return c.json({ error: 'invalid' }, 400);

  const db = c.env.DB;
  const viewer = c.var.user.id;
  const cursor = before !== undefined ? 'AND (a.created_at, a.id) < (?2, ?3)' : '';
  // Friends / Everyone walk the anchors newest first (migration 0019's partial index, the activity row first: CROSS JOIN)
  // and stop after a page, instead of collecting every visible post and sorting. You keeps its own (user_id, created_at) index.
  const from = show === 'you'
    ? 'activity a JOIN entries e'
    : 'activity a INDEXED BY idx_activity_anchor_created CROSS JOIN entries e';
  const anchorSql = `SELECT a.id, a.user_id, a.created_at
      FROM ${from} ON e.id = a.entry_id AND e.user_id = a.user_id
     WHERE a.post_id IS NULL AND ${SCOPE[show]} ${cursor}
     ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE + 1}`;
  const anchorStmt = db.prepare(anchorSql);
  const { results: found } = await (before !== undefined ? anchorStmt.bind(viewer, before, beforeId!) : anchorStmt.bind(viewer))
    .all<{ id: string; user_id: string; created_at: string }>();
  const anchors = found.slice(0, PAGE);
  const last = anchors[anchors.length - 1];
  const next = found.length > PAGE && last ? { before: last.created_at, beforeId: last.id } : null;
  if (anchors.length === 0) return c.json({ items: [], users: {}, friends: [], social: {}, next } satisfies ActivityPage);

  const postIds = JSON.stringify(anchors.map((a) => a.id));
  const userIds = JSON.stringify([...new Set(anchors.map((a) => a.user_id))]);
  const [rowsRes, usersRes, reactRes, commentRes] = await db.batch([
    // Every row of these posts; the visibility rule again, so nothing slips through between reads.
    db.prepare(
      `SELECT a.id, a.post_id, a.user_id, a.type, a.entry_id, a.payload_json, a.created_at, e.category, e.title, e.cover_url, e.creator, e.source, e.source_id, e.release_date,
              -- The note rides along only for its owner or an accepted friend, and never when the owner made notes private.
              -- A non-private note goes to friends, and to everyone while the admin switch
              -- "Everyone feed shows notes to non-friends" (features.everyoneNotes, default on) is on.
              CASE WHEN e.user_id = ?1 OR (e.notes_private = 0 AND (e.user_id IN (${FRIEND_IDS_SQL('?1')})
                OR COALESCE((SELECT CASE WHEN json_valid(value_json) THEN json_extract(value_json, '$.everyoneNotes') END
                             FROM app_settings WHERE key = 'features'), 1) != 0)) THEN NULLIF(e.notes, '') END AS note
         FROM activity a JOIN entries e ON e.id = a.entry_id AND e.user_id = a.user_id
        WHERE (a.id IN (SELECT value FROM json_each(?2)) OR a.post_id IN (SELECT value FROM json_each(?2)))
          AND ${ROW_VISIBLE[show]}
        ORDER BY a.created_at DESC, a.id DESC`,
    ).bind(viewer, postIds),
    // `friend`: 1 for an accepted active friend (the web links only friends' titles).
    db.prepare(
      `SELECT ${PUBLIC_USER_COLS}, id IN (${FRIEND_IDS_SQL('?2')}) AS friend FROM users WHERE id IN (SELECT value FROM json_each(?1))`,
    ).bind(userIds, viewer),
    db.prepare(
      `SELECT activity_id, emoji, COUNT(*) AS n, SUM(user_id = ?1) AS mine FROM reactions
        WHERE activity_id IN (SELECT value FROM json_each(?2)) AND ${BY_ACTIVE('reactions')} GROUP BY activity_id, emoji`,
    ).bind(viewer, postIds),
    db.prepare(
      `SELECT activity_id, COUNT(*) AS n FROM comments
        WHERE activity_id IN (SELECT value FROM json_each(?1)) AND deleted_at IS NULL AND ${BY_ACTIVE('comments')} GROUP BY activity_id`,
    ).bind(postIds),
  ]);

  const users: Record<string, PublicUser> = {};
  const friends: string[] = [];
  for (const u of (usersRes!.results as (PublicUserRow & { friend: number })[])) {
    users[u.id] = publicUser(u);
    if (u.friend === 1) friends.push(u.id);
  }
  const social: Record<string, PostSocial> = {};
  for (const a of anchors) social[a.id] = { reactions: {}, mine: [], comments: 0 };
  for (const r of reactRes!.results as { activity_id: string; emoji: string; n: number; mine: number }[]) {
    const s = social[r.activity_id];
    if (!s || !isReaction(r.emoji)) continue;
    s.reactions[r.emoji] = r.n;
    if (r.mine > 0) s.mine.push(r.emoji as Reaction);
  }
  for (const r of commentRes!.results as { activity_id: string; n: number }[]) {
    const s = social[r.activity_id];
    if (s) s.comments = r.n;
  }

  const body: ActivityPage = {
    items: (rowsRes!.results as Row[]).map((r) => ({
      id: r.id,
      postId: r.post_id ?? r.id,
      userId: r.user_id,
      type: r.type,
      entryId: r.entry_id,
      category: r.category,
      title: r.title,
      coverUrl: r.cover_url,
      creator: r.creator,
      source: r.source,
      sourceId: r.source_id,
      releaseDate: r.release_date,
      note: r.note,
      payload: parsePayload(r.payload_json),
      createdAt: r.created_at,
    })),
    users,
    friends,
    social,
    next,
  };
  return c.json(body);
});

/** A8: the row aliased `t` (a comment or reaction) was written by a user who is active. */
const BY_ACTIVE = (t: string) => `EXISTS (SELECT 1 FROM users bu WHERE bu.id = ${t}.user_id AND bu.status = 'active')`;

/** Counts at most UNREAD_CAP rows of `sql`. */
const capped = (sql: string) => `(SELECT COUNT(*) FROM (${sql} LIMIT ${UNREAD_CAP}))`;

// 1 query, plus sign-in (1-3). S8 (stays friends-only, Dan 2026-11-16): friends' visible posts, plus others' live comments and
// reactions on your posts and entries, newer than feed_seen_at (never seen = all), capped at 99;
// requests = incoming pending friend requests, plus (A7) pending sign-ups for the admin.
// A8: nothing from pending or removed users counts.
activity.get('/unread', async (c) => {
  const seen = `COALESCE((SELECT feed_seen_at FROM users WHERE id = ?1), '')`;
  // On one of your entries or posts: a key lookup per new comment or reaction, which are found by created_at (indexed).
  const onMine = (t: string) => `(EXISTS (SELECT 1 FROM entries oe WHERE oe.id = ${t}.entry_id AND oe.user_id = ?1)
      OR EXISTS (SELECT 1 FROM activity oa WHERE oa.id = ${t}.activity_id AND oa.user_id = ?1))`;
  const posts = `SELECT 1 FROM activity a JOIN entries e ON e.id = a.entry_id AND e.user_id = a.user_id
      WHERE a.post_id IS NULL AND ${FRIENDS_POSTS} AND a.created_at > ${seen}`;
  const comments = `SELECT 1 FROM comments k WHERE k.user_id <> ?1 AND k.deleted_at IS NULL
      AND k.created_at > ${seen} AND ${onMine('k')} AND ${BY_ACTIVE('k')}`;
  const reactions = `SELECT 1 FROM reactions r WHERE r.user_id <> ?1 AND r.created_at > ${seen} AND ${onMine('r')} AND ${BY_ACTIVE('r')}`;
  const row = await c.env.DB.prepare(
    `SELECT MIN(${UNREAD_CAP}, ${capped(posts)} + ${capped(comments)} + ${capped(reactions)}) AS feed,
            (SELECT COUNT(*) FROM friendships f JOIN users ru ON ru.id = f.requested_by AND ru.status = 'active'
              WHERE (f.user_a = ?1 OR f.user_b = ?1) AND f.status = 'pending' AND f.requested_by <> ?1)
            + CASE WHEN ?2 = 1 THEN (SELECT COUNT(*) FROM users WHERE status = 'pending') ELSE 0 END AS requests,
            -- Phase 6 (M3): chats with a message from someone else (active) after your last_read_at, deleted ones not counted.
            MIN(${UNREAD_CAP}, (SELECT COUNT(*) FROM conversation_members m WHERE m.user_id = ?1 AND EXISTS (
              SELECT 1 FROM messages x JOIN users su ON su.id = x.sender_id AND su.status = 'active'
               WHERE x.conversation_id = m.conversation_id AND x.sender_id <> ?1 AND x.deleted_at IS NULL
                 AND x.created_at > COALESCE(m.last_read_at, '')))) AS messages`,
  ).bind(c.var.user.id, c.var.user.isAdmin ? 1 : 0).first<{ feed: number; requests: number; messages: number }>();
  return c.json({ feed: row?.feed ?? 0, requests: row?.requests ?? 0, messages: row?.messages ?? 0 });
});

// 1 query, plus sign-in (1-3).
activity.post('/seen', async (c) => {
  await c.env.DB.prepare('UPDATE users SET feed_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), c.var.user.id).run();
  return c.body(null, 204);
});

/** The ids of `ids` that are the viewer's own anchor posts (post_id IS NULL), as a JSON param. */
const OWN_ANCHORS = `SELECT a.id FROM activity a WHERE (?1 IS NULL OR a.user_id = ?1) AND a.post_id IS NULL AND a.id IN (SELECT value FROM json_each(?2))`;

/**
 * Deletes the viewer's own posts by anchor id: every row of the post (post_id = anchor) and the
 * anchor, plus the posts' reactions and comments (explicit, not left to the cascade). Ids that are
 * not the viewer's anchors are ignored; returns how many posts went. One batch of 4.
 * `viewerId` null (the admin, AD7) means any post.
 */
async function deletePosts(db: D1Database, viewerId: string | null, ids: string[]): Promise<number> {
  const json = JSON.stringify(ids);
  const [found] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM (${OWN_ANCHORS})`).bind(viewerId, json),
    db.prepare(`DELETE FROM reactions WHERE activity_id IN (${OWN_ANCHORS})`).bind(viewerId, json),
    db.prepare(`DELETE FROM comments WHERE activity_id IN (${OWN_ANCHORS})`).bind(viewerId, json),
    db.prepare(
      `DELETE FROM activity WHERE (?1 IS NULL OR user_id = ?1)
          AND (COALESCE(post_id, id) IN (SELECT value FROM json_each(?2)))`,
    ).bind(viewerId, json),
  ]);
  return (found!.results[0] as { n: number }).n;
}

const MAX_BATCH_DELETE = 100;

// POST /api/activity/delete { postIds }: owner only, 1-100 anchor ids, one batch (4 statements).
// Ids that aren't your anchors are ignored (a stale selection must not fail the rest).
activity.post('/delete', async (c) => {
  const body = await c.req.json().catch(() => null) as { postIds?: unknown } | null;
  const ids = body?.postIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BATCH_DELETE || !ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 64)) {
    return c.json({ error: 'invalid' }, 400);
  }
  const deleted = await deletePosts(c.env.DB, c.var.user.id, [...new Set(ids as string[])]);
  return c.json({ deleted });
});

// DELETE /api/activity/:postId: owner (or, AD7, the admin: any post), the anchor id; 404 when it isn't your post. The entry stays.
activity.delete('/:postId', async (c) => {
  const deleted = await deletePosts(c.env.DB, c.var.user.isAdmin ? null : c.var.user.id, [c.req.param('postId')]);
  return deleted === 0 ? c.json({ error: 'not_found' }, 404) : c.body(null, 204);
});
