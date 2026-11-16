import { Hono } from 'hono';
import type { ActivityItem, ActivityPage, ActivityType, Category } from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';

export const activity = new Hono<AppEnv>();

const PAGE = 50;
const NEW_ID = `lower(hex(randomblob(16)))`;
const INSERT = `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at)`;

type Changes = { rating?: number | null; status?: string | null };

/** The `added` row for a new entry. Batch it AFTER the entry's INSERT (foreign key). */
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
    .prepare(`${INSERT} VALUES (${NEW_ID}, ?1, ?2, 'added', ?3, ?4, ?4)`)
    .bind(userId, entryId, JSON.stringify(payload), now);
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
           SELECT ${NEW_ID}, user_id, id, CASE WHEN rating IS NULL THEN 'rated' ELSE 're-rated' END,
                  json_object('from', rating, 'to', ?3), ?4, ?4
             FROM entries WHERE id = ?1 AND user_id = ?2 AND (rating IS NULL OR rating <> ?3)`,
        )
        .bind(entryId, userId, patch.rating, now),
    );
  }
  if (typeof patch.status === 'string') {
    out.push(
      db
        .prepare(
          `${INSERT}
           SELECT ${NEW_ID}, user_id, id, 'status', json_object('from', status, 'to', ?3), ?4, ?4
             FROM entries WHERE id = ?1 AND user_id = ?2 AND status IS NOT ?3`,
        )
        .bind(entryId, userId, patch.status, now),
    );
  }
  return out;
}

/** One statement for a whole Compare save (3 bound parameters however many titles). Batch BEFORE the UPDATE. */
export function activityForCompareSave(
  db: D1Database,
  userId: string,
  changesJson: string,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `${INSERT}
       SELECT ${NEW_ID}, e.user_id, e.id, CASE WHEN e.rating IS NULL THEN 'rated' ELSE 're-rated' END,
              json_object('from', e.rating, 'to', j.rating, 'via', 'compare'), ?3, ?3
         FROM entries e
         JOIN (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.rating') AS rating FROM json_each(?1)) j
           ON j.id = e.id
        WHERE e.user_id = ?2 AND (e.rating IS NULL OR e.rating <> j.rating)`,
    )
    .bind(changesJson, userId, now);
}

interface Row {
  id: string; type: ActivityType; entry_id: string; payload_json: string; created_at: string;
  category: Category; title: string; cover_url: string;
}

function parsePayload(json: string): ActivityItem['payload'] {
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as ActivityItem['payload']) : {};
  } catch {
    return {};
  }
}

// 1 query
activity.get('/', async (c) => {
  const before = c.req.query('before');
  const beforeId = c.req.query('beforeId');
  if ((before === undefined) !== (beforeId === undefined)) return c.json({ error: 'invalid' }, 400);
  if (before !== undefined && (before.length > 40 || beforeId!.length > 64)) return c.json({ error: 'invalid' }, 400);

  const userId = c.var.user.id;
  const select = `SELECT a.id, a.type, a.entry_id, a.payload_json, a.created_at, e.category, e.title, e.cover_url
      FROM activity a JOIN entries e ON e.id = a.entry_id AND e.user_id = a.user_id
     WHERE a.user_id = ?`;
  const stmt =
    before !== undefined
      ? c.env.DB.prepare(`${select} AND (a.created_at, a.id) < (?, ?) ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE + 1}`)
          .bind(userId, before, beforeId!)
      : c.env.DB.prepare(`${select} ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE + 1}`).bind(userId);
  const { results } = await stmt.all<Row>();
  const page = results.slice(0, PAGE);
  const last = page[page.length - 1];
  const body: ActivityPage = {
    items: page.map((r) => ({
      id: r.id,
      type: r.type,
      entryId: r.entry_id,
      category: r.category,
      title: r.title,
      coverUrl: r.cover_url,
      payload: parsePayload(r.payload_json),
      createdAt: r.created_at,
    })),
    next: results.length > PAGE && last ? { before: last.created_at, beforeId: last.id } : null,
  };
  return c.json(body);
});
