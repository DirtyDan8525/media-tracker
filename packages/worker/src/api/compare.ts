import { Hono } from 'hono';
import type { Category } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';

export const compare = new Hono<AppEnv>();

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
