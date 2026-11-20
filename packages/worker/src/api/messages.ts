/**
 * Phase 6 (docs/plans/2026-11-17-phase6-messages.md, M1-M9): conversations, messages, pictures in R2,
 * recommendations. Mounted at /api (paths /conversations... and /messages...). Every route needs
 * a signed-in active user (requireUser); a conversation, its messages and its pictures exist only for
 * its members: anyone else gets 404, never 403. Query counts are noted per route (+ sign-in 1-3).
 */
import { Hono } from 'hono';
import {
  CATEGORY_CONFIG, GROUP_MAX, GROUP_NAME_MAX, IMAGE_MAX_BYTES, MESSAGES_PAGE, MESSAGE_MAX, MESSAGE_RATE_PER_MIN, RECOMMENDED_MAX,
  type Conversation, type ConversationKind, type ConversationList, type ConversationSummary, type LastMessage, type Message,
  type MessageKind, type MessagePage, type PublicUser, type RecSnapshot, type RecommendedItem, type ReplyInfo, type SourceId,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { pushNewMessage } from '../push/events';
import { ctxOf } from '../push/send';
import { sha256Hex } from '../auth/session';
import { featureOn } from '../settings/appSettings';
import { FRIEND_IDS_SQL, PUBLIC_USER_COLS, pair, publicUser, type PublicUserRow } from '../social/visibility';

export const messages = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const notFriends = { error: 'not_friends' } as const;
const PREVIEW_MAX = 80;
const LIST_MAX = 200;
const SOURCES: readonly string[] = ['anilist', 'kitsu', 'tmdb', 'wiki', 'tvmaze', 'deezer', 'itunes', 'spotify', 'openlibrary', 'steam', 'igdb', 'youtube'];

const newId = () => crypto.randomUUID().replaceAll('-', '');

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A deduplicated list of 1..max user ids (strings, not the caller), or null. */
function userIdsOf(v: unknown, me: string, max: number): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > max) return null;
  if (!v.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 64)) return null;
  const ids = [...new Set(v as string[])];
  return ids.includes(me) ? null : ids;
}

/** A conversation name: 1..GROUP_NAME_MAX characters after trimming; undefined when absent, null when bad. */
function nameOf(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= GROUP_NAME_MAX ? t : null;
}

/** The snapshot a rec message keeps, rebuilt field by field from the body (unknown keys dropped); null when invalid. */
function recOf(v: unknown): RecSnapshot | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.category !== 'string' || !Object.hasOwn(CATEGORY_CONFIG, r.category)) return null;
  if (typeof r.title !== 'string' || r.title.trim() === '' || r.title.length > 300) return null;
  const optStr = (x: unknown, max: number): string | null | undefined =>
    x === undefined || x === null ? null : typeof x === 'string' && x.length <= max ? x : undefined;
  const creator = optStr(r.creator, 300);
  const sourceId = optStr(r.sourceId, 200);
  if (creator === undefined || sourceId === undefined) return null;
  const coverUrl = r.coverUrl === undefined || r.coverUrl === null ? '' : r.coverUrl;
  if (typeof coverUrl !== 'string' || coverUrl.length > 2000 || (coverUrl !== '' && !/^(https?:\/\/|\/)/i.test(coverUrl))) return null;
  const rating = r.rating === undefined ? null : r.rating;
  if (rating !== null && (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 10)) return null;
  const source = r.source === undefined || r.source === null ? null : r.source;
  if (source !== null && (typeof source !== 'string' || !SOURCES.includes(source))) return null;
  const entryId = r.entryId === undefined || r.entryId === null ? undefined : r.entryId;
  if (entryId !== undefined && (typeof entryId !== 'string' || entryId === '' || entryId.length > 64)) return null;
  return {
    category: r.category as RecSnapshot['category'], title: r.title.trim(), creator, coverUrl, rating,
    source: source as SourceId | null, sourceId, ...(entryId !== undefined ? { entryId } : {}),
  };
}

function parseRec(json: string | null): RecSnapshot | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RecSnapshot;
  } catch {
    return null;
  }
}

/** The reply columns (aliased r_*), present when the query joins the replied-to message (REPLY_JOIN). */
interface ReplyCols {
  r_id: string | null; r_sender: string | null; r_kind: MessageKind | null; r_body: string | null; r_rec_title: string | null;
  r_deleted_at: string | null; r_username: string | null; r_display_name: string | null;
}
interface MessageRow extends Partial<ReplyCols> {
  id: string; conversation_id: string; sender_id: string; kind: MessageKind; body: string; rec_json: string | null;
  has_image: number; reply_to: string | null; created_at: string; deleted_at: string | null;
}
const MESSAGE_COLS = `m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.rec_json, m.image_key IS NOT NULL AS has_image, m.reply_to, m.created_at, m.deleted_at`;
/** One join answers every reply's quote: no extra query per message. */
const REPLY_COLS = `r.id AS r_id, r.sender_id AS r_sender, r.kind AS r_kind, substr(r.body, 1, 300) AS r_body, json_extract(r.rec_json, '$.title') AS r_rec_title,
            r.deleted_at AS r_deleted_at, ru.username AS r_username, ru.display_name AS r_display_name`;
const REPLY_JOIN = `LEFT JOIN messages r ON r.id = m.reply_to LEFT JOIN users ru ON ru.id = r.sender_id AND ru.status = 'active'`;
const SNIPPET_MAX = 100;

/** A quote's one-line snippet: the text with whitespace collapsed, a rec's title, nothing for a picture. */
function snippetOf(kind: MessageKind, body: string | null, recTitle: string | null): string {
  const t = kind === 'rec' ? (recTitle ?? '') : kind === 'image' ? '' : (body ?? '');
  const one = t.replace(/\s+/g, ' ').trim();
  const chars = Array.from(one);
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX - 1).join('')}…` : one;
}

const DELETED_REPLY = (id: string): ReplyInfo => ({ id, senderId: '', senderName: '', kind: 'text', snippet: '', deleted: true });

function replyOf(r: MessageRow): ReplyInfo | null {
  if (r.reply_to === null || r.r_id === undefined) return null;
  if (r.r_id === null || r.r_deleted_at !== null) return DELETED_REPLY(r.reply_to);
  return {
    id: r.r_id, senderId: r.r_sender!, senderName: r.r_display_name || (r.r_username ? `@${r.r_username}` : ''), kind: r.r_kind!,
    snippet: snippetOf(r.r_kind!, r.r_body ?? null, r.r_rec_title ?? null), deleted: false,
  };
}

function toMessage(r: MessageRow): Message {
  const deleted = r.deleted_at !== null;
  return {
    id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, kind: r.kind,
    text: deleted ? '' : r.body, rec: deleted ? null : parseRec(r.rec_json), image: !deleted && r.has_image === 1,
    deleted, replyTo: deleted ? null : replyOf(r), createdAt: r.created_at,
  };
}

/**
 * Whether the direct chat aliased `c` has lost its friendship (the other member is not an accepted active friend of ?2).
 * The pair's own friendships row is looked up by its key (user_a < user_b), rather than listing all of ?2's friends per chat.
 */
const READ_ONLY_SQL = `(c.kind = 'direct' AND NOT EXISTS (
    SELECT 1 FROM conversation_members o JOIN users ou ON ou.id = o.user_id AND ou.status = 'active'
      JOIN friendships f ON f.user_a = min(o.user_id, ?2) AND f.user_b = max(o.user_id, ?2) AND f.status = 'accepted'
     WHERE o.conversation_id = c.id AND o.user_id <> ?2))`;

interface Access {
  kind: ConversationKind; name: string | null; created_by: string; created_at: string;
  read_only: number; newest: string; recent: number; member_count: number;
}

/** What the newest page of a chat depends on, read without reading the page (accessOf with `poll`). */
interface PollState {
  /** JSON [created_at, id] of the newest message, or null in an empty chat. */
  newest_key: string | null;
  /** JSON [count, latest deleted_at] of the chat's deleted messages (a partial index: usually no rows). */
  deleted_key: string;
  last_read_at: string | null;
  /** Every user's public fields and status: names and pictures on the page, and who is active (users is a small table). */
  people_key: string;
}

/**
 * 1 query: the caller's membership of conversation `id` (null = not a member or no such chat: answer 404),
 * with what the write routes need: read-only, newest message time, how many the caller sent since `cutoff`.
 * `recent` is counted only for a send (a cutoff given); without one it is 0, so reads never count every message
 * the caller ever sent.
 */
function accessOf(db: D1Database, id: string, me: string, cutoff: string): Promise<Access | null>;
function accessOf(db: D1Database, id: string, me: string, cutoff: '', poll: true): Promise<(Access & PollState) | null>;
function accessOf(db: D1Database, id: string, me: string, cutoff: string, poll = false) {
  const pollCols = poll
    ? `, (SELECT json_array(x.created_at, x.id) FROM messages x WHERE x.conversation_id = c.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS newest_key,
            (SELECT json_array(COUNT(*), MAX(x.deleted_at)) FROM messages x WHERE x.conversation_id = c.id AND x.deleted_at IS NOT NULL) AS deleted_key,
            m.last_read_at,
            (SELECT json_group_array(json_array(p.id, p.username, p.display_name, p.avatar_at, p.status)) FROM users p) AS people_key`
    : '';
  return db.prepare(
    `SELECT c.kind, c.name, c.created_by, c.created_at, ${READ_ONLY_SQL} AS read_only,
            COALESCE((SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id), '') AS newest,
            ${cutoff === '' ? '0' : '(SELECT COUNT(*) FROM messages WHERE sender_id = ?2 AND created_at >= ?3)'} AS recent,
            (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) AS member_count${pollCols}
       FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?2
      WHERE c.id = ?1`,
  ).bind(...(cutoff === '' ? [id, me] : [id, me, cutoff])).first<Access & Partial<PollState>>();
}

/**
 * The newest page's validator: changes whenever anything the page shows could have changed (a new message, a deletion,
 * a name, picture or status, read-only, the page size), so a conditional poll that matches can answer 304 without
 * reading the page. Weak, per caller.
 */
async function pageTag(me: string, limit: number, a: Access & PollState): Promise<string> {
  const key = JSON.stringify([me, limit, a.read_only, a.newest_key, a.deleted_key, a.people_key]);
  return `W/"${(await sha256Hex(key)).slice(0, 32)}"`;
}

/** Whether an If-None-Match header names `tag`. */
const matchesTag = (header: string | undefined, tag: string) =>
  header !== undefined && header.split(',').some((t) => t.trim() === tag || t.trim() === '*');

/** Active members of the conversations, by conversation id (1 query). */
async function membersOf(db: D1Database, ids: string[]): Promise<Map<string, PublicUser[]>> {
  const out = new Map<string, PublicUser[]>(ids.map((i) => [i, []]));
  if (ids.length === 0) return out;
  const { results } = await db.prepare(
    `SELECT cm.conversation_id, ${PUBLIC_USER_COLS} FROM conversation_members cm JOIN users u ON u.id = cm.user_id AND u.status = 'active'
      WHERE cm.conversation_id IN (SELECT value FROM json_each(?1)) ORDER BY cm.joined_at, u.id`,
  ).bind(JSON.stringify(ids)).all<PublicUserRow & { conversation_id: string }>();
  for (const r of results) out.get(r.conversation_id)?.push(publicUser(r));
  return out;
}

/** 2 queries. null when the caller is not a member. */
async function loadConversation(db: D1Database, id: string, me: string): Promise<Conversation | null> {
  const a = await accessOf(db, id, me, '');
  if (!a) return null;
  const members = await membersOf(db, [id]);
  return {
    id, kind: a.kind, name: a.name, createdBy: a.created_by, createdAt: a.created_at,
    members: members.get(id) ?? [], readOnly: a.read_only === 1,
  };
}

/** How many of `ids` are accepted active friends of `me` (1 query). */
const friendCount = (db: D1Database, me: string, ids: string[]) =>
  db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (SELECT value FROM json_each(?1)) AND id IN (${FRIEND_IDS_SQL('?2')})`)
    .bind(JSON.stringify(ids), me).first<{ n: number }>().then((r) => r?.n ?? 0);

// 2 queries: the list with last message and unread, then the members (+ sign-in).
messages.get('/conversations', async (c) => {
  const me = c.var.user.id;
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT c.id, c.kind, c.name, c.created_by, c.created_at, c.last_message_at, ${READ_ONLY_SQL} AS read_only,
            lm.kind AS lm_kind, substr(lm.body, 1, 200) AS lm_body, json_extract(lm.rec_json, '$.title') AS lm_rec_title, lm.sender_id AS lm_sender, lm.created_at AS lm_at, lm.deleted_at AS lm_deleted,
            EXISTS (SELECT 1 FROM messages x JOIN users su ON su.id = x.sender_id AND su.status = 'active'
                     WHERE x.conversation_id = c.id AND x.sender_id <> ?2 AND x.deleted_at IS NULL
                       AND x.created_at > COALESCE(m.last_read_at, '')) AS unread
       FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN messages lm ON lm.id = (SELECT x.id FROM messages x JOIN users su ON su.id = x.sender_id AND su.status = 'active'
                                          WHERE x.conversation_id = c.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1)
      WHERE m.user_id = ?2 ORDER BY c.last_message_at DESC, c.id LIMIT ${LIST_MAX}`,
  ).bind(null, me).all<{
    id: string; kind: ConversationKind; name: string | null; created_by: string; created_at: string; last_message_at: string; read_only: number;
    lm_kind: MessageKind | null; lm_body: string | null; lm_rec_title: string | null; lm_sender: string | null; lm_at: string | null; lm_deleted: string | null; unread: number;
  }>();
  const members = await membersOf(db, results.map((r) => r.id));
  const conversations: ConversationSummary[] = results.map((r) => {
    const deleted = r.lm_deleted !== null;
    const last: LastMessage | null = r.lm_kind === null ? null : {
      kind: r.lm_kind, text: deleted ? '' : Array.from(r.lm_body ?? '').slice(0, PREVIEW_MAX).join(''),
      ...(r.lm_kind === 'rec' && !deleted ? { recTitle: Array.from(r.lm_rec_title ?? '').slice(0, PREVIEW_MAX).join('') || null } : {}),
      senderId: r.lm_sender!, deleted, createdAt: r.lm_at!,
    };
    return {
      id: r.id, kind: r.kind, name: r.name, createdBy: r.created_by, createdAt: r.created_at, members: members.get(r.id) ?? [],
      readOnly: r.read_only === 1, last, lastMessageAt: r.last_message_at, unread: r.unread === 1,
    };
  });
  return c.json({ conversations } satisfies ConversationList);
});

// Create: 1 id = a direct chat with a friend (the existing one when there is one: 200), 2-19 = a group (201).
// Friend check 1 query, create batch of 3-4, then 2 to read it back (+ sign-in).
messages.post('/conversations', featureOn('messages'), async (c) => {
  const me = c.var.user.id;
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  const ids = body ? userIdsOf(body.userIds, me, GROUP_MAX - 1) : null;
  const name = body ? nameOf(body.name) : undefined;
  if (!ids || name === null) return c.json(invalid, 400);
  if ((await friendCount(db, me, ids)) !== ids.length) return c.json(notFriends, 403);

  const id = newId();
  const now = new Date().toISOString();
  const insert = (key: string | null, kind: ConversationKind) =>
    db.prepare(
      `INSERT INTO conversations (id, kind, name, created_by, created_at, last_message_at, direct_key) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
       ON CONFLICT (direct_key) DO NOTHING`,
    ).bind(id, kind, kind === 'group' ? (name ?? null) : null, me, now, key);
  let convId = id;
  let created = true;
  if (ids.length === 1) {
    const other = ids[0]!;
    const key = pair(me, other).join(':');
    // Atomic per pair: the unique direct_key makes a racing second create a no-op that finds the first.
    const [, , , found] = await db.batch([
      insert(key, 'direct'),
      db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at, last_read_at) SELECT ?1, ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ?1)`).bind(id, me, now),
      db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ?1)`).bind(id, other, now),
      db.prepare('SELECT id FROM conversations WHERE direct_key = ?').bind(key),
    ]);
    convId = (found!.results[0] as { id: string }).id;
    created = convId === id;
  } else {
    await db.batch([
      insert(null, 'group'),
      db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_at) VALUES (?1, ?2, ?3, ?3)`).bind(id, me, now),
      db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, joined_at) SELECT ?1, value, ?2 FROM json_each(?3)`).bind(id, now, JSON.stringify(ids)),
    ]);
  }
  const conv = await loadConversation(db, convId, me);
  return c.json(conv, created ? 201 : 200);
});

// 2 queries (+ sign-in). Not a member = 404.
messages.get('/conversations/:id', async (c) => {
  const conv = await loadConversation(c.env.DB, c.req.param('id'), c.var.user.id);
  return conv ? c.json(conv) : c.json(notFound, 404);
});

// Rename a group: 1 + 1 + 2 queries (+ sign-in). Any member may.
messages.patch('/conversations/:id', async (c) => {
  const me = c.var.user.id;
  const id = c.req.param('id');
  const a = await accessOf(c.env.DB, id, me, '');
  if (!a) return c.json(notFound, 404);
  const body = await readJson(c.req.raw);
  const name = body ? nameOf(body.name) : undefined;
  if (typeof name !== 'string') return c.json(invalid, 400);
  if (a.kind !== 'group') return c.json({ error: 'not_group' }, 400);
  await c.env.DB.prepare('UPDATE conversations SET name = ? WHERE id = ?').bind(name, id).run();
  return c.json(await loadConversation(c.env.DB, id, me));
});

// Add friends of yours to a group: 2 + 1 + 2 queries (+ sign-in). Anyone already in is skipped; max GROUP_MAX members.
messages.post('/conversations/:id/members', async (c) => {
  const me = c.var.user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const a = await accessOf(db, id, me, '');
  if (!a) return c.json(notFound, 404);
  const body = await readJson(c.req.raw);
  // You are already in: naming yourself (or anyone already in) is a no-op, not an error.
  const ids = body && Array.isArray(body.userIds) ? userIdsOf(body.userIds.filter((i) => i !== me), me, GROUP_MAX - 1) : null;
  if (!ids) return c.json(invalid, 400);
  if (a.kind !== 'group') return c.json({ error: 'not_group' }, 400);
  const json = JSON.stringify(ids);
  const NOT_MEMBER = `NOT IN (SELECT user_id FROM conversation_members WHERE conversation_id = ?3)`;
  const row = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM json_each(?1) WHERE value ${NOT_MEMBER}) AS fresh,
            (SELECT COUNT(*) FROM users WHERE id IN (SELECT value FROM json_each(?1)) AND id ${NOT_MEMBER} AND id IN (${FRIEND_IDS_SQL('?2')})) AS ok`,
  ).bind(json, me, id).first<{ fresh: number; ok: number }>();
  const fresh = row?.fresh ?? 0;
  if (row?.ok !== fresh) return c.json(notFriends, 403);
  if (a.member_count + fresh > GROUP_MAX) return c.json({ error: 'group_full' }, 409);
  if (fresh > 0) {
    await db.prepare(
      `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) SELECT ?1, value, ?2 FROM json_each(?3)`,
    ).bind(id, new Date().toISOString(), json).run();
  }
  return c.json(await loadConversation(db, id, me));
});

// Leave a group: 2-3 queries (+ sign-in). The last one out deletes the group, its messages and its pictures.
messages.delete('/conversations/:id/members/me', async (c) => {
  const me = c.var.user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const a = await accessOf(db, id, me, '');
  if (!a) return c.json(notFound, 404);
  if (a.kind !== 'group') return c.json({ error: 'not_group' }, 400);
  if (a.member_count > 1) {
    await db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').bind(id, me).run();
    return c.body(null, 204);
  }
  const { results } = await db.prepare('SELECT image_key FROM messages WHERE conversation_id = ? AND image_key IS NOT NULL').bind(id).all<{ image_key: string }>();
  await db.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run();
  if (c.env.MEDIA && results.length > 0) await c.env.MEDIA.delete(results.map((r) => r.image_key)).catch(() => undefined);
  return c.body(null, 204);
});

// A page of a chat, newest first: 1 + 2 queries (+ sign-in). The first page (no `before`) marks it read.
// A conditional poll of the first page that still matches its ETag: 1 query (+ sign-in), answered 304.
messages.get('/conversations/:id/messages', async (c) => {
  const me = c.var.user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const before = c.req.query('before');
  const limitQ = c.req.query('limit');
  const limit = limitQ === undefined ? MESSAGES_PAGE : Number(limitQ);
  if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGES_PAGE || (before !== undefined && (before === '' || before.length > 64))) {
    return c.json(invalid, 400);
  }
  // The newest page (the 5 s poll) carries an ETag: the browser revalidates it (Cache-Control: no-cache), and while nothing
  // changed the answer is 304 from the access query alone, without reading the page. An older page has no validator.
  const a = before === undefined ? await accessOf(db, id, me, '', true) : await accessOf(db, id, me, '');
  if (!a) return c.json(notFound, 404);
  let tag: string | null = null;
  if (before === undefined) {
    const poll = a as Access & PollState;
    tag = await pageTag(me, limit, poll);
    const newestAt = poll.newest_key === null ? null : (JSON.parse(poll.newest_key) as [string, string])[0];
    // Already read up to the newest message, so the read mark this page would write changes nothing either.
    const read = newestAt === null || (poll.last_read_at !== null && poll.last_read_at >= newestAt);
    if (read && matchesTag(c.req.header('If-None-Match'), tag)) {
      return c.body(null, 304, { ETag: tag, 'Cache-Control': 'private, no-cache' });
    }
  }
  const cursor = before !== undefined
    ? 'AND (m.created_at, m.id) < (SELECT created_at, id FROM messages WHERE id = ?2 AND conversation_id = ?1)'
    : '';
  const select = db.prepare(
    `SELECT ${MESSAGE_COLS}, ${REPLY_COLS}, u.username AS u_username, u.display_name AS u_display_name, u.avatar_at AS u_avatar_at
       FROM messages m JOIN users u ON u.id = m.sender_id AND u.status = 'active' ${REPLY_JOIN}
      WHERE m.conversation_id = ?1 ${cursor} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit + 1}`,
  );
  const stmts = [before !== undefined ? select.bind(id, before) : select.bind(id)];
  if (before === undefined) {
    stmts.push(db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').bind(new Date().toISOString(), id, me));
  }
  const [res] = await db.batch(stmts);
  const rows = res!.results as (MessageRow & { u_username: string | null; u_display_name: string | null; u_avatar_at: string | null })[];
  const page = rows.slice(0, limit);
  const users: Record<string, PublicUser> = {};
  for (const r of page) {
    users[r.sender_id] ??= publicUser({ id: r.sender_id, username: r.u_username, display_name: r.u_display_name, avatar_at: r.u_avatar_at });
  }
  const body: MessagePage = {
    messages: page.map(toMessage), users, readOnly: a.read_only === 1,
    next: rows.length > limit ? page[page.length - 1]!.id : null,
  };
  return tag === null ? c.json(body) : c.json(body, 200, { ETag: tag, 'Cache-Control': 'private, no-cache' });
});

/**
 * The gate every send shares: member (404), picture storage (503, when `needsMedia`), read-only (403), the rate limit
 * (429). On success the new message's created_at: now, kept strictly after the chat's newest so order and cursors never tie.
 */
async function sendGate(c: { env: AppEnv['Bindings']; var: AppEnv['Variables']; json: (b: unknown, s: 403 | 404 | 429 | 503, h?: Record<string, string>) => Response },
  id: string, needsMedia: boolean): Promise<{ response: Response } | { now: string }> {
  const t = Date.now();
  const a = await accessOf(c.env.DB, id, c.var.user.id, new Date(t - 60_000).toISOString());
  if (!a) return { response: c.json(notFound, 404) };
  if (needsMedia && !c.env.MEDIA) return { response: c.json({ error: 'not_configured' }, 503) };
  if (a.read_only === 1) return { response: c.json({ error: 'read_only' }, 403) };
  if (a.recent >= MESSAGE_RATE_PER_MIN) return { response: c.json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' }) };
  let now = new Date(t).toISOString();
  if (a.newest !== '' && now <= a.newest) now = new Date(Date.parse(a.newest) + 1).toISOString();
  return { now };
}

/** The batch that stores a message: the row, the chat's last_message_at, and the sender's own read mark. */
const insertMessage = (db: D1Database, m: { id: string; conv: string; sender: string; kind: MessageKind; body: string; rec: string | null; image: string | null; replyTo?: string | null; now: string }) => [
  db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, rec_json, image_key, reply_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(m.id, m.conv, m.sender, m.kind, m.body, m.rec, m.image, m.replyTo ?? null, m.now),
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').bind(m.now, m.conv),
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').bind(m.now, m.conv, m.sender),
];

// Send text, or a rec with an optional note: 1 query + a batch of 3 (+ sign-in). 201 with the message.
messages.post('/conversations/:id/messages', featureOn('messages'), async (c) => {
  const me = c.var.user.id;
  const id = c.req.param('id');
  const gate = await sendGate(c, id, false);
  if ('response' in gate) return gate.response;
  const body = await readJson(c.req.raw);
  if (!body) return c.json(invalid, 400);
  const text = body.text === undefined ? '' : typeof body.text === 'string' ? body.text.trim() : null;
  const rec = body.rec === undefined ? null : recOf(body.rec);
  if (text === null || (body.rec !== undefined && rec === null) || text.length > MESSAGE_MAX || (rec === null && text === '')) {
    return c.json(invalid, 400);
  }
  // A reply: the original must be in this same chat and still visible (not deleted). +1 query, only for replies.
  let replyTo: ReplyInfo | null = null;
  if (body.replyTo !== undefined && body.replyTo !== null) {
    if (typeof body.replyTo !== 'string' || body.replyTo === '' || body.replyTo.length > 64) return c.json(invalid, 400);
    const o = await c.env.DB.prepare(
      `SELECT r.id, r.sender_id, r.kind, substr(r.body, 1, 300) AS body, json_extract(r.rec_json, '$.title') AS rec_title, ru.username, ru.display_name
         FROM messages r LEFT JOIN users ru ON ru.id = r.sender_id AND ru.status = 'active'
        WHERE r.id = ?1 AND r.conversation_id = ?2 AND r.deleted_at IS NULL`,
    ).bind(body.replyTo, id).first<{ id: string; sender_id: string; kind: MessageKind; body: string; rec_title: string | null; username: string | null; display_name: string | null }>();
    if (!o) return c.json({ error: 'invalid_reply' }, 400);
    replyTo = {
      id: o.id, senderId: o.sender_id, senderName: o.display_name || (o.username ? `@${o.username}` : ''), kind: o.kind,
      snippet: snippetOf(o.kind, o.body, o.rec_title), deleted: false,
    };
  }
  // A card keeps `entryId` only when it is the sender's own entry (so tapping it can open the title); anything else is dropped. +1 query, only with one.
  let card = rec;
  if (card?.entryId !== undefined) {
    const own = await c.env.DB.prepare('SELECT 1 AS ok FROM entries WHERE id = ? AND user_id = ?').bind(card.entryId, me).first();
    if (!own) { const { entryId: _drop, ...rest } = card; card = rest; }
  }
  const msgId = newId();
  const kind: MessageKind = card ? 'rec' : 'text';
  await c.env.DB.batch(insertMessage(c.env.DB, { id: msgId, conv: id, sender: me, kind, body: text, rec: card ? JSON.stringify(card) : null, image: null, replyTo: replyTo?.id ?? null, now: gate.now }));
  const msg: Message = { id: msgId, conversationId: id, senderId: me, kind, text, rec: card, image: false, deleted: false, replyTo, createdAt: gate.now };
  pushNewMessage(c.env, ctxOf(c), id, c.var.user, kind, text);
  return c.json(msg, 201);
});

const IMAGE_EXT_OK: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/webp': (b) => [0x52, 0x49, 0x46, 0x46].every((v, i) => b[i] === v) && [0x57, 0x45, 0x42, 0x50].every((v, i) => b[8 + i] === v),
};

/** The whole body, or null when it runs past `max` bytes (stops reading at once). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
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
  const out = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    out.set(ch, at);
    at += ch.byteLength;
  }
  return out;
}

// A picture (raw body): 1 query + a batch of 3 (+ sign-in), plus the R2 put. 201 with the message.
messages.post('/conversations/:id/messages/image', featureOn('messages'), async (c) => {
  const me = c.var.user.id;
  const id = c.req.param('id');
  const gate = await sendGate(c, id, true);
  if ('response' in gate) return gate.response;
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const matches = IMAGE_EXT_OK[type];
  if (!Object.hasOwn(IMAGE_EXT_OK, type) || !matches) return c.json({ error: 'unsupported_media_type' }, 415);
  const bytes = await readCapped(c.req.raw, IMAGE_MAX_BYTES);
  if (bytes === null) return c.json({ error: 'too_large' }, 413);
  if (bytes.byteLength < 12 || !matches(bytes)) return c.json(invalid, 400);
  const msgId = newId();
  const key = `msg/${id}/${msgId}`;
  await c.env.MEDIA!.put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    await c.env.DB.batch(insertMessage(c.env.DB, { id: msgId, conv: id, sender: me, kind: 'image', body: '', rec: null, image: key, now: gate.now }));
  } catch (e) {
    await c.env.MEDIA!.delete(key).catch(() => undefined);
    throw e;
  }
  const msg: Message = { id: msgId, conversationId: id, senderId: me, kind: 'image', text: '', rec: null, image: true, deleted: false, replyTo: null, createdAt: gate.now };
  pushNewMessage(c.env, ctxOf(c), id, c.var.user, 'image', '');
  return c.json(msg, 201);
});

// Recs sent to you, newest first: 1 query (+ sign-in). Static path: registered before /messages/:id.
messages.get('/messages/recommended', async (c) => {
  const me = c.var.user.id;
  const { results } = await c.env.DB.prepare(
    `SELECT ${MESSAGE_COLS}, (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at) AS unread,
            u.username AS u_username, u.display_name AS u_display_name, u.avatar_at AS u_avatar_at
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?1
       JOIN users u ON u.id = m.sender_id AND u.status = 'active'
      WHERE m.kind = 'rec' AND m.sender_id <> ?1 AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT ${RECOMMENDED_MAX}`,
  ).bind(me).all<MessageRow & { unread: number; u_username: string | null; u_display_name: string | null; u_avatar_at: string | null }>();
  const items: RecommendedItem[] = results.map((r) => ({
    message: toMessage(r), unread: r.unread === 1,
    sender: publicUser({ id: r.sender_id, username: r.u_username, display_name: r.u_display_name, avatar_at: r.u_avatar_at }),
  }));
  return c.json({ items });
});

// A picture, to members only: 1 query + the R2 get (+ sign-in).
messages.get('/messages/:id/image', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT m.image_key FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?2
      WHERE m.id = ?1 AND m.deleted_at IS NULL AND m.image_key IS NOT NULL`,
  ).bind(c.req.param('id'), c.var.user.id).first<{ image_key: string }>();
  if (!row) return c.json(notFound, 404);
  if (!c.env.MEDIA) return c.json({ error: 'not_configured' }, 503);
  const obj = await c.env.MEDIA.get(row.image_key);
  if (!obj) return c.json(notFound, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// Delete your own message (soft): 1 + 1 queries (+ sign-in). Not a member of its chat = 404; someone else's = 403.
messages.delete('/messages/:id', async (c) => {
  const me = c.var.user.id;
  const id = c.req.param('id');
  // AD7: the admin may delete any message, in a chat they are not in too.
  const asAdmin = c.var.user.isAdmin;
  const row = await c.env.DB.prepare(
    asAdmin
      ? 'SELECT sender_id, image_key, deleted_at FROM messages WHERE id = ?1'
      : `SELECT m.sender_id, m.image_key, m.deleted_at FROM messages m
           JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?2 WHERE m.id = ?1`,
  ).bind(...(asAdmin ? [id] : [id, me])).first<{ sender_id: string; image_key: string | null; deleted_at: string | null }>();
  if (!row) return c.json(notFound, 404);
  if (row.sender_id !== me && !asAdmin) return c.json({ error: 'forbidden' }, 403);
  if (row.deleted_at !== null) return c.body(null, 204);
  await c.env.DB.prepare(
    `UPDATE messages SET body = '', rec_json = NULL, image_key = NULL, deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
  ).bind(new Date().toISOString(), id).run();
  if (row.image_key && c.env.MEDIA) await c.env.MEDIA.delete(row.image_key).catch(() => undefined);
  return c.body(null, 204);
});
