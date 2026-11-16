import { Hono } from 'hono';
import {
  ACTIVITY_MERGE_MS, FEED_SCOPES, isReaction,
  type ActivityItem, type ActivityPage, type ActivityType, type Category, type FeedScope, type PostSocial, type PublicUser, type Reaction,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import { FRIEND_IDS_SQL, PUBLIC_USER_COLS, publicUser, visibleEntrySql, type PublicUserRow } from '../social/visibility';

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

/** Shown-score change (spec §5.2 feed rule) at or above which a ratings save logs "re-rated". */
export const RE_RATED_MIN_CHANGE = 0.5;

type RatingState = { id: string; rating: number | null; tier: number | null };

/**
 * The titles a ratings save (POST /api/ratings/:set/save) logs, per the spec §5.2 feed rule: only
 * titles the user's session named (a counted pick or a move), and of those only the ones whose
 * shown score moved by at least 0.5, that changed tier, or that got their first rating. Titles that
 * changed only because their tier re-fit never log. `before` is the set as loaded (tiers derived on
 * the fly for rows not yet backfilled), `changed` the rows the save writes.
 */
export function ratingsSaveActivityRows(
  before: Map<string, RatingState>,
  changed: RatingState[],
  sessionIds: Set<string>,
): { id: string; rating: number }[] {
  const out: { id: string; rating: number }[] = [];
  for (const after of changed) {
    if (!sessionIds.has(after.id) || after.rating === null) continue;
    const old = before.get(after.id);
    if (!old) continue;
    const moved = old.rating === null
      || old.tier !== after.tier
      || Math.abs(after.rating - old.rating) >= RE_RATED_MIN_CHANGE - 1e-9;
    if (moved) out.push({ id: after.id, rating: after.rating });
  }
  return out;
}

/**
 * One statement for a whole ratings save (3 bound parameters however many titles; the rows travel
 * as one JSON parameter). Each row compares against the STORED rating, so batch it BEFORE the set
 * UPDATE. Rated / re-rated with `via: 'compare'`, the shape foldPosts folds; each row joins its
 * entry's post per S5.
 */
export function activityForRatingsSave(
  db: D1Database,
  userId: string,
  rowsJson: string,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `${INSERT}
       SELECT ${NEW_ID}, e.user_id, e.id, CASE WHEN e.rating IS NULL THEN 'rated' ELSE 're-rated' END,
              json_object('from', e.rating, 'to', j.rating, 'via', 'compare'), ?3, ?3, ${anchorOf('?4')}
         FROM entries e
         JOIN (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.rating') AS rating FROM json_each(?1)) j
           ON j.id = e.id
        WHERE e.user_id = ?2 AND (e.rating IS NULL OR e.rating <> j.rating)`,
    )
    .bind(rowsJson, userId, now, cutoffOf(now));
}

interface Row {
  id: string; post_id: string | null; user_id: string; type: ActivityType; entry_id: string; payload_json: string;
  created_at: string; category: Category; title: string; cover_url: string;
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
 * S6: an anchor row `a` (joined to its entry `e`, viewer at ?1) whose post is more than a bare
 * "added": the anchor carries a rating or status, or a later row joined it (only an anchor can be
 * "added"). Others' posts must also pass the visibility rule.
 */
const NOT_BARE = `(a.type <> 'added' OR json_extract(a.payload_json, '$.rating') IS NOT NULL
      OR json_extract(a.payload_json, '$.status') IS NOT NULL
      OR EXISTS (SELECT 1 FROM activity p WHERE p.post_id = a.id))`;
const OTHERS_POSTS = `(a.user_id IN (${FRIEND_IDS_SQL('?1')}) AND ${visibleEntrySql('e', '?1')} AND ${NOT_BARE})`;
const SCOPE: Record<FeedScope, string> = {
  you: 'a.user_id = ?1',
  friends: OTHERS_POSTS,
  // A bare "added" shows only in You, your own included.
  everyone: `((a.user_id = ?1 AND ${NOT_BARE}) OR ${OTHERS_POSTS})`,
};

const isScope = (v: string): v is FeedScope => (FEED_SCOPES as readonly string[]).includes(v);

// 1 query + 1 batch of 4 (rows, users, reactions, comment counts), plus sign-in (1-3): ≤ 8.
// Pages are 30 posts, by anchor (created_at, id); visibility is read-time, so an entry made
// private disappears from friends' feeds at once (review focus 1).
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
  const anchorSql = `SELECT a.id, a.user_id, a.created_at
      FROM activity a JOIN entries e ON e.id = a.entry_id AND e.user_id = a.user_id
     WHERE a.post_id IS NULL AND ${SCOPE[show]} ${cursor}
     ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE + 1}`;
  const anchorStmt = db.prepare(anchorSql);
  const { results: found } = await (before !== undefined ? anchorStmt.bind(viewer, before, beforeId!) : anchorStmt.bind(viewer))
    .all<{ id: string; user_id: string; created_at: string }>();
  const anchors = found.slice(0, PAGE);
  const last = anchors[anchors.length - 1];
  const next = found.length > PAGE && last ? { before: last.created_at, beforeId: last.id } : null;
  if (anchors.length === 0) return c.json({ items: [], users: {}, social: {}, next } satisfies ActivityPage);

  const postIds = JSON.stringify(anchors.map((a) => a.id));
  const userIds = JSON.stringify([...new Set(anchors.map((a) => a.user_id))]);
  const [rowsRes, usersRes, reactRes, commentRes] = await db.batch([
    // Every row of these posts; the visibility rule again, so nothing slips through between reads.
    db.prepare(
      `SELECT a.id, a.post_id, a.user_id, a.type, a.entry_id, a.payload_json, a.created_at, e.category, e.title, e.cover_url
         FROM activity a JOIN entries e ON e.id = a.entry_id AND e.user_id = a.user_id
        WHERE (a.id IN (SELECT value FROM json_each(?2)) OR a.post_id IN (SELECT value FROM json_each(?2)))
          AND ${visibleEntrySql('e', '?1')}
        ORDER BY a.created_at DESC, a.id DESC`,
    ).bind(viewer, postIds),
    db.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id IN (SELECT value FROM json_each(?1))`).bind(userIds),
    db.prepare(
      `SELECT activity_id, emoji, COUNT(*) AS n, SUM(user_id = ?1) AS mine FROM reactions
        WHERE activity_id IN (SELECT value FROM json_each(?2)) GROUP BY activity_id, emoji`,
    ).bind(viewer, postIds),
    db.prepare(
      `SELECT activity_id, COUNT(*) AS n FROM comments
        WHERE activity_id IN (SELECT value FROM json_each(?1)) AND deleted_at IS NULL GROUP BY activity_id`,
    ).bind(postIds),
  ]);

  const users: Record<string, PublicUser> = {};
  for (const u of (usersRes!.results as PublicUserRow[])) users[u.id] = publicUser(u);
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
      payload: parsePayload(r.payload_json),
      createdAt: r.created_at,
    })),
    users,
    social,
    next,
  };
  return c.json(body);
});

/** Counts at most UNREAD_CAP rows of `sql`. */
const capped = (sql: string) => `(SELECT COUNT(*) FROM (${sql} LIMIT ${UNREAD_CAP}))`;

// 1 query, plus sign-in (1-3). S8: friends' visible posts, plus others' live comments and
// reactions on your posts and entries, newer than feed_seen_at (never seen = all), capped at 99;
// requests = incoming pending friend requests.
activity.get('/unread', async (c) => {
  const seen = `COALESCE((SELECT feed_seen_at FROM users WHERE id = ?1), '')`;
  const onMine = (t: string) => `(${t}.entry_id IN (SELECT id FROM entries WHERE user_id = ?1)
      OR ${t}.activity_id IN (SELECT id FROM activity WHERE user_id = ?1))`;
  const posts = `SELECT 1 FROM activity a JOIN entries e ON e.id = a.entry_id AND e.user_id = a.user_id
      WHERE a.post_id IS NULL AND ${OTHERS_POSTS} AND a.created_at > ${seen}`;
  const comments = `SELECT 1 FROM comments k WHERE k.user_id <> ?1 AND k.deleted_at IS NULL
      AND k.created_at > ${seen} AND ${onMine('k')}`;
  const reactions = `SELECT 1 FROM reactions r WHERE r.user_id <> ?1 AND r.created_at > ${seen} AND ${onMine('r')}`;
  const row = await c.env.DB.prepare(
    `SELECT MIN(${UNREAD_CAP}, ${capped(posts)} + ${capped(comments)} + ${capped(reactions)}) AS feed,
            (SELECT COUNT(*) FROM friendships f WHERE (f.user_a = ?1 OR f.user_b = ?1)
                AND f.status = 'pending' AND f.requested_by <> ?1) AS requests`,
  ).bind(c.var.user.id).first<{ feed: number; requests: number }>();
  return c.json({ feed: row?.feed ?? 0, requests: row?.requests ?? 0 });
});

// 1 query, plus sign-in (1-3).
activity.post('/seen', async (c) => {
  await c.env.DB.prepare('UPDATE users SET feed_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), c.var.user.id).run();
  return c.body(null, 204);
});
