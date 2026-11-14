import { Hono } from 'hono';
import {
  CATEGORY_CONFIG,
  findDuplicate,
  type Category,
  type Entry,
  type Season,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import { CATEGORIES, validateEntryInput, validateSeasonInput, type EntryFields } from './entryValidation';

export { validateEntryInput, validateSeasonInput } from './entryValidation';

export const entries = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const noSeasons = { error: 'no_seasons' } as const;

// Database row (snake_case) shapes.
interface EntryRow {
  id: string; user_id: string; category: Category; title: string; typed_title: string;
  status: Entry['status']; rating: number | null; genres: string; creator: string; album: string;
  cover_url: string; notes: string; release_date: string; synopsis: string; length_label: string;
  origin: string; details_state: Entry['detailsState']; is_private: number; notes_private: number;
  source: Entry['source']; source_id: string | null; lookup_state: Entry['lookupState'];
  import_id: string | null; season_avg: number | null; created_at: string; updated_at: string;
}
interface SeasonRow {
  id: string; entry_id: string; label: string; rating: number | null; notes: string; created_at: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function rowToEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    userId: r.user_id,
    category: r.category,
    title: r.title,
    typedTitle: r.typed_title,
    status: r.status,
    rating: r.rating,
    genres: r.genres,
    creator: r.creator,
    album: r.album,
    coverUrl: r.cover_url,
    notes: r.notes,
    releaseDate: r.release_date,
    synopsis: r.synopsis,
    lengthLabel: r.length_label,
    origin: r.origin,
    detailsState: r.details_state,
    isPrivate: r.is_private === 1,
    notesPrivate: r.notes_private === 1,
    source: r.source,
    sourceId: r.source_id,
    lookupState: r.lookup_state,
    importId: r.import_id,
    seasonAvg: r.season_avg === null || r.season_avg === undefined ? null : round2(r.season_avg),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToSeason(r: SeasonRow): Season {
  return { id: r.id, entryId: r.entry_id, label: r.label, rating: r.rating, notes: r.notes };
}

const ENTRY_SELECT = `SELECT e.*, (SELECT AVG(s.rating) FROM seasons s WHERE s.entry_id = e.id AND s.rating IS NOT NULL) AS season_avg FROM entries e`;

// camelCase field -> column, with boolean columns stored 0/1.
const COLUMNS: Record<keyof EntryFields, string> = {
  title: 'title', typedTitle: 'typed_title', status: 'status', rating: 'rating', genres: 'genres',
  creator: 'creator', album: 'album', coverUrl: 'cover_url', notes: 'notes', releaseDate: 'release_date',
  synopsis: 'synopsis', lengthLabel: 'length_label', origin: 'origin', detailsState: 'details_state',
  isPrivate: 'is_private', notesPrivate: 'notes_private', source: 'source', sourceId: 'source_id',
  lookupState: 'lookup_state',
};
const dbValue = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function loadEntry(db: D1Database, id: string, userId: string): Promise<Entry | null> {
  const row = await db.prepare(`${ENTRY_SELECT} WHERE e.id = ? AND e.user_id = ?`).bind(id, userId).first<EntryRow>();
  return row ? rowToEntry(row) : null;
}

// 1 query
entries.get('/entries', async (c) => {
  const category = c.req.query('category');
  if (category !== undefined && !CATEGORIES.includes(category as Category)) return c.json(invalid, 400);
  const userId = c.var.user.id;
  const stmt = category
    ? c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.user_id = ? AND e.category = ? ORDER BY e.created_at, e.rowid`).bind(userId, category)
    : c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.user_id = ? ORDER BY e.created_at, e.rowid`).bind(userId);
  const { results } = await stmt.all<EntryRow>();
  return c.json(results.map(rowToEntry));
});

// 1 query
entries.get('/entries/:id', async (c) => {
  const entry = await loadEntry(c.env.DB, c.req.param('id'), c.var.user.id);
  return entry ? c.json(entry) : c.json(notFound, 404);
});

// 3 queries: duplicate candidates, insert, re-select (for seasonAvg/defaults)
entries.post('/entries', async (c) => {
  const body = await readJson(c.req.raw);
  const category = (body as { category?: unknown } | null)?.category;
  if (typeof category !== 'string' || !CATEGORIES.includes(category as Category)) return c.json(invalid, 400);
  const v = validateEntryInput(body, 'create', category as Category);
  if (!v.ok) return c.json(invalid, 400);

  const f = v.value;
  const userId = c.var.user.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const values: EntryFields = {
    ...f,
    typedTitle: f.typedTitle ?? f.title,
    lookupState: f.lookupState ?? 'pending',
  };

  const { results: existing } = await c.env.DB.prepare(
    'SELECT id, title, creator FROM entries WHERE user_id = ? AND category = ?',
  )
    .bind(userId, category)
    .all<{ id: string; title: string; creator: string }>();
  const duplicateOf = findDuplicate(
    existing,
    { id, title: values.title!, creator: values.creator ?? '' },
    category as Category,
  );

  const keys = Object.keys(values) as (keyof EntryFields)[];
  const cols = ['id', 'user_id', 'category', ...keys.map((k) => COLUMNS[k]), 'created_at', 'updated_at'];
  await c.env.DB.prepare(`INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(id, userId, category, ...keys.map((k) => dbValue(values[k])), now, now)
    .run();

  const entry = await loadEntry(c.env.DB, id, userId);
  return c.json({ entry, duplicateOf }, 201);
});

// 3 queries: category lookup, update, re-select
entries.patch('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.var.user.id;
  const owned = await c.env.DB.prepare('SELECT category FROM entries WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ category: Category }>();
  if (!owned) return c.json(notFound, 404);

  const v = validateEntryInput(await readJson(c.req.raw), 'patch', owned.category);
  if (!v.ok) return c.json(invalid, 400);

  const keys = Object.keys(v.value) as (keyof EntryFields)[];
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), 'updated_at = ?'];
  await c.env.DB.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...keys.map((k) => dbValue(v.value[k])), new Date().toISOString(), id, userId)
    .run();
  return c.json(await loadEntry(c.env.DB, id, userId));
});

// 1 query (seasons go via ON DELETE CASCADE; D1 enforces foreign keys)
entries.delete('/entries/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.var.user.id)
    .run();
  if (res.meta.changes === 0) return c.json(notFound, 404);
  return c.body(null, 204);
});

async function ownedEntryCategory(db: D1Database, id: string, userId: string): Promise<Category | null> {
  const row = await db.prepare('SELECT category FROM entries WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ category: Category }>();
  return row ? row.category : null;
}

// 2 queries
entries.get('/entries/:id/seasons', async (c) => {
  const category = await ownedEntryCategory(c.env.DB, c.req.param('id'), c.var.user.id);
  if (!category) return c.json(notFound, 404);
  if (!CATEGORY_CONFIG[category].hasSeasons) return c.json(noSeasons, 400);
  const { results } = await c.env.DB.prepare('SELECT * FROM seasons WHERE entry_id = ? ORDER BY created_at, id')
    .bind(c.req.param('id'))
    .all<SeasonRow>();
  return c.json(results.map(rowToSeason));
});

// 2 queries
entries.post('/entries/:id/seasons', async (c) => {
  const entryId = c.req.param('id');
  const category = await ownedEntryCategory(c.env.DB, entryId, c.var.user.id);
  if (!category) return c.json(notFound, 404);
  if (!CATEGORY_CONFIG[category].hasSeasons) return c.json(noSeasons, 400);
  const v = validateSeasonInput(await readJson(c.req.raw));
  if (!v.ok) return c.json(invalid, 400);

  const season: Season = { id: crypto.randomUUID(), entryId, label: '', rating: null, notes: '', ...v.value };
  await c.env.DB.prepare(
    'INSERT INTO seasons (id, entry_id, label, rating, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(season.id, entryId, season.label, season.rating, season.notes, new Date().toISOString())
    .run();
  return c.json(season, 201);
});

const SEASON_OWNED = `SELECT s.* FROM seasons s JOIN entries e ON e.id = s.entry_id WHERE s.id = ? AND e.user_id = ?`;

// 3 queries: ownership select, update, re-select
entries.patch('/seasons/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.var.user.id;
  const owned = await c.env.DB.prepare(SEASON_OWNED).bind(id, userId).first<SeasonRow>();
  if (!owned) return c.json(notFound, 404);
  const v = validateSeasonInput(await readJson(c.req.raw));
  if (!v.ok) return c.json(invalid, 400);

  const next = { ...rowToSeason(owned), ...v.value };
  await c.env.DB.prepare('UPDATE seasons SET label = ?, rating = ?, notes = ? WHERE id = ?')
    .bind(next.label, next.rating, next.notes, id)
    .run();
  return c.json(next);
});

// 1 query
entries.delete('/seasons/:id', async (c) => {
  const res = await c.env.DB.prepare(
    'DELETE FROM seasons WHERE id = ? AND entry_id IN (SELECT id FROM entries WHERE user_id = ?)',
  )
    .bind(c.req.param('id'), c.var.user.id)
    .run();
  if (res.meta.changes === 0) return c.json(notFound, 404);
  return c.body(null, 204);
});

// 1 batch of 2 statements (counts as 2)
entries.get('/export', async (c) => {
  const userId = c.var.user.id;
  const [e, s] = await c.env.DB.batch([
    c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.user_id = ? ORDER BY e.created_at, e.rowid`).bind(userId),
    c.env.DB.prepare(
      'SELECT s.* FROM seasons s JOIN entries e ON e.id = s.entry_id WHERE e.user_id = ? ORDER BY s.created_at, s.id',
    ).bind(userId),
  ]);
  const body = {
    entries: (e!.results as EntryRow[]).map(rowToEntry),
    seasons: (s!.results as SeasonRow[]).map(rowToSeason),
    settings: c.var.user.settings,
  };
  return c.json(body, 200, { 'Content-Disposition': 'attachment; filename="media-tracker-export.json"' });
});
