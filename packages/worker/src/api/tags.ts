/**
 * Custom tags (Phase 7): each person's own labels on their titles. A tag is created the first time it is put on a title
 * and lives in the person's list (Settings > Tags) until they delete it. Names are 1-30 characters, unique per person ignoring
 * case; at most 50 tags per person and 20 per title. Tags ride on entry payloads via ENTRY_SELECT (no extra query); friends
 * and public links get them through `toFriendEntry`, which never sees a private title.
 */
import { Hono } from 'hono';
import { TAGS_PER_ENTRY_MAX, TAGS_PER_USER_MAX, TAG_NAME_MAX, type TagInfo } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';

export const tags = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;

/** The trimmed name when it is 1-30 characters, else null. Inner runs of spaces collapse to one. */
export function cleanTagName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= TAG_NAME_MAX ? name : null;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE|constraint/i.test(e.message);

// 1 query: my tags with how many titles carry each.
tags.get('/tags', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, (SELECT COUNT(*) FROM entry_tags et WHERE et.tag_id = t.id) AS count
     FROM tags t WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE`,
  ).bind(c.var.user.id).all<TagInfo>();
  return c.json(results);
});

// 2 queries: ownership of the tag, then the update. A name another tag of mine has (any case) is a 409.
tags.patch('/tags/:id', async (c) => {
  const body = (await readJson(c.req.raw)) as { name?: unknown } | null;
  const name = cleanTagName(body?.name);
  if (name === null) return c.json(invalid, 400);
  const userId = c.var.user.id;
  const id = c.req.param('id');
  const clash = await c.env.DB.prepare('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?')
    .bind(userId, name, id).first();
  if (clash) return c.json({ error: 'exists' }, 409);
  try {
    const res = await c.env.DB.prepare('UPDATE tags SET name = ? WHERE id = ? AND user_id = ?').bind(name, id, userId).run();
    if (res.meta.changes === 0) return c.json(notFound, 404);
  } catch (e) {
    if (isUniqueError(e)) return c.json({ error: 'exists' }, 409);
    throw e;
  }
  return c.json({ id, name });
});

// 1 query. Its rows on titles go with it (ON DELETE CASCADE).
tags.delete('/tags/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.var.user.id).run();
  return res.meta.changes === 0 ? c.json(notFound, 404) : c.body(null, 204);
});

async function tagsOf(db: D1Database, entryId: string): Promise<string[]> {
  const { results } = await db.prepare(
    'SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ? ORDER BY t.name COLLATE NOCASE',
  ).bind(entryId).all<{ name: string }>();
  return results.map((r) => r.name);
}

// Up to 5 queries: my title, its tags (limit and "already on it"), the tag by name, [create it], put it on, read back.
// Answers { tags } - the title's tags, A-Z. Putting a tag already on the title changes nothing.
tags.post('/entries/:id/tags', async (c) => {
  const body = (await readJson(c.req.raw)) as { name?: unknown } | null;
  const name = cleanTagName(body?.name);
  if (name === null) return c.json(invalid, 400);
  const db = c.env.DB;
  const userId = c.var.user.id;
  const entryId = c.req.param('id');
  const owned = await db.prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?').bind(entryId, userId).first();
  if (!owned) return c.json(notFound, 404);
  const have = await tagsOf(db, entryId);
  if (have.some((n) => n.toLowerCase() === name.toLowerCase())) return c.json({ tags: have });
  if (have.length >= TAGS_PER_ENTRY_MAX) return c.json({ error: 'entry_tag_limit' }, 409);

  let tag = await db.prepare('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?)').bind(userId, name).first<{ id: string }>();
  if (!tag) {
    const id = crypto.randomUUID();
    const res = await db.prepare(
      'INSERT OR IGNORE INTO tags (id, user_id, name, created_at) SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM tags WHERE user_id = ?2) < ?5',
    ).bind(id, userId, name, new Date().toISOString(), TAGS_PER_USER_MAX).run();
    if (res.meta.changes === 0) {
      // Either the person is at the limit, or the same name was just made by a parallel request.
      tag = await db.prepare('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?)').bind(userId, name).first<{ id: string }>();
      if (!tag) return c.json({ error: 'tag_limit' }, 409);
    } else {
      tag = { id };
    }
  }
  await db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').bind(entryId, tag.id).run();
  return c.json({ tags: await tagsOf(db, entryId) }, 201);
});

// 2 queries: my title, then the delete by name (any case). Answers { tags }. A tag the title does not have is a no-op.
tags.delete('/entries/:id/tags/:name', async (c) => {
  const db = c.env.DB;
  const userId = c.var.user.id;
  const entryId = c.req.param('id');
  const name = cleanTagName(c.req.param('name'));
  if (name === null) return c.json(invalid, 400);
  const owned = await db.prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?').bind(entryId, userId).first();
  if (!owned) return c.json(notFound, 404);
  await db.prepare(
    'DELETE FROM entry_tags WHERE entry_id = ?1 AND tag_id IN (SELECT id FROM tags WHERE user_id = ?2 AND lower(name) = lower(?3))',
  ).bind(entryId, userId, name).run();
  return c.json({ tags: await tagsOf(db, entryId) });
});
