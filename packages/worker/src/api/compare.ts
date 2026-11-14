import { Hono } from 'hono';
import { COMPARE_SAVE_MAX_CHANGES, type Category, type Entry } from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import { isValidRating } from './entryValidation';
import { ENTRY_SELECT, rowToEntry } from './entries';

export const compare = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const QUEUE_MAX = 50;

/**
 * Statements that queue a freshly typed rating for Compare (script queueNewRating_): none unless
 * compareAsk is Both or Only for new ratings; else an upsert (a re-rated title moves to the end)
 * and a trim to the 50 most recent.
 */
export function enqueueStatements(
  db: D1Database,
  userId: string,
  entryId: string,
  compareAsk: string,
): D1PreparedStatement[] {
  if (compareAsk !== 'Both' && compareAsk !== 'Only for new ratings') return [];
  return [
    db
      .prepare(
        `INSERT INTO compare_queue (user_id, entry_id, added_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id, entry_id) DO UPDATE SET added_at = excluded.added_at`,
      )
      .bind(userId, entryId, new Date().toISOString()),
    db
      .prepare(
        `DELETE FROM compare_queue WHERE user_id = ?1 AND entry_id NOT IN
           (SELECT entry_id FROM compare_queue WHERE user_id = ?1 ORDER BY added_at DESC, rowid DESC LIMIT ${QUEUE_MAX})`,
      )
      .bind(userId),
  ];
}

// 1 query
compare.get('/queue', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT q.entry_id, e.category FROM compare_queue q
       JOIN entries e ON e.id = q.entry_id AND e.user_id = q.user_id
      WHERE q.user_id = ? AND e.rating IS NOT NULL
      ORDER BY q.added_at, q.rowid`,
  )
    .bind(c.var.user.id)
    .all<{ entry_id: string; category: Category }>();
  return c.json({ items: results.map((r) => ({ entryId: r.entry_id, category: r.category })) });
});

// 1 query
compare.delete('/queue/:entryId', async (c) => {
  await c.env.DB.prepare('DELETE FROM compare_queue WHERE user_id = ? AND entry_id = ?')
    .bind(c.var.user.id, c.req.param('entryId'))
    .run();
  return c.body(null, 204);
});

type Change = { id: string; rating: number };

function parseChanges(body: unknown): { changes: Change[]; doneEntryId: string | null } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { changes, doneEntryId } = body as { changes?: unknown; doneEntryId?: unknown };
  if (!Array.isArray(changes) || changes.length > COMPARE_SAVE_MAX_CHANGES) return null;
  if (doneEntryId !== undefined && (typeof doneEntryId !== 'string' || doneEntryId.length > 64)) return null;
  const seen = new Set<string>();
  const out: Change[] = [];
  for (const ch of changes) {
    if (typeof ch !== 'object' || ch === null) return null;
    const { id, rating } = ch as { id?: unknown; rating?: unknown };
    if (typeof id !== 'string' || id.length < 1 || id.length > 64 || seen.has(id)) return null;
    if (rating === null || !isValidRating(rating)) return null;
    seen.add(id);
    out.push({ id, rating });
  }
  return { changes: out, doneEntryId: doneEntryId ?? null };
}

// One batch of 2-3 statements (+ up to 3 for sign-in = 6 queries, under the 50 limit),
// each with a fixed number of bound parameters (the changes are one JSON parameter).
compare.post('/save', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(invalid, 400);
  }
  const parsed = parseChanges(body);
  if (!parsed) return c.json(invalid, 400);

  const db = c.env.DB;
  const userId = c.var.user.id;
  const json = JSON.stringify(parsed.changes);
  const stmts = [
    db
      .prepare(
        `UPDATE entries SET
           rating = (SELECT json_extract(value, '$.rating') FROM json_each(?1) WHERE json_extract(value, '$.id') = entries.id),
           updated_at = ?3
         WHERE user_id = ?2 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
      )
      .bind(json, userId, new Date().toISOString()),
  ];
  if (parsed.doneEntryId !== null) {
    stmts.push(
      db.prepare('DELETE FROM compare_queue WHERE user_id = ? AND entry_id = ?').bind(userId, parsed.doneEntryId),
    );
  }
  stmts.push(
    db
      .prepare(
        `${ENTRY_SELECT} WHERE e.user_id = ?2 AND e.id IN (SELECT json_extract(value, '$.id') FROM json_each(?1)) ORDER BY e.created_at, e.rowid`,
      )
      .bind(json, userId),
  );
  const res = await db.batch(stmts);
  const updated = res[0]!.meta.changes;
  const entries: Entry[] = (res[res.length - 1]!.results as Parameters<typeof rowToEntry>[0][]).map(rowToEntry);
  return c.json({ updated, entries });
});
