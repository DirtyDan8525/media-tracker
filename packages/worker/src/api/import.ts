import { Hono } from 'hono';
import { CATEGORY_CONFIG, type Category, type ImportRow } from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import { D1_MAX_PARAMS, D1_MAX_QUERIES } from '../env';
import { CATEGORIES, validateEntryInput, validateSeasonInput } from './entryValidation';

export const importApi = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Chunk sizing -----------------------------------------------------------
// One POST = one Worker invocation, so everything it runs counts toward
// D1_MAX_QUERIES (every statement in a db.batch() counts):
//   requireUser: up to 3 (select, insert on first sign-in, select)
//   import lookup: 1
//   batch: 1 imports upsert + N entry inserts + M season inserts
// and every statement is a multi-row INSERT whose bound params must be <= D1_MAX_PARAMS.
const AUTH_QUERIES = 3;
const LOOKUP_QUERIES = 1;
const UPSERT_STATEMENTS = 1;
const INSERT_BUDGET = D1_MAX_QUERIES - AUTH_QUERIES - LOOKUP_QUERIES - UPSERT_STATEMENTS; // 45

// Bound params per row: id, user_id, category, title, typed_title, status, rating, genres,
// creator, album, cover_url, notes, lookup_state, import_id, created_at, updated_at.
// (details_state is the literal 'none'.)
const ENTRY_PARAMS = 16;
// id, entry_id, label, rating, notes, created_at.
const SEASON_PARAMS = 6;
const ENTRIES_PER_STATEMENT = Math.floor(D1_MAX_PARAMS / ENTRY_PARAMS); // 6
const SEASONS_PER_STATEMENT = Math.floor(D1_MAX_PARAMS / SEASON_PARAMS); // 16

// Two thirds of the insert budget goes to entry statements, the rest to season statements.
const ENTRY_STATEMENTS = Math.floor((INSERT_BUDGET * 2) / 3); // 30
const SEASON_STATEMENTS = INSERT_BUDGET - ENTRY_STATEMENTS; // 15

/** Max rows in one POST /api/import (180). */
export const IMPORT_CHUNK_ROWS = ENTRY_STATEMENTS * ENTRIES_PER_STATEMENT;
/** Max seasons, summed over all rows in one POST /api/import (240). */
export const IMPORT_CHUNK_SEASONS = SEASON_STATEMENTS * SEASONS_PER_STATEMENT;

/** Statements one chunk runs in its batch (imports upsert + inserts). */
export const importStatementCount = (rows: number, seasons: number) =>
  UPSERT_STATEMENTS + Math.ceil(rows / ENTRIES_PER_STATEMENT) + Math.ceil(seasons / SEASONS_PER_STATEMENT);

// ---- Validation -------------------------------------------------------------
interface CleanSeason { label: string; rating: number | null; notes: string }
interface CleanRow {
  category: Category; title: string; status: ImportRow['status']; rating: number | null;
  genres: string; creator: string; album: string; coverUrl: string; notes: string; seasons: CleanSeason[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanRow(input: unknown): CleanRow | null {
  if (!isPlainObject(input)) return null;
  const category = input.category;
  if (typeof category !== 'string' || !CATEGORIES.includes(category as Category)) return null;
  const v = validateEntryInput(input, 'create', category as Category);
  if (!v.ok) return null;
  const f = v.value;

  const seasons: CleanSeason[] = [];
  if (input.seasons !== undefined && input.seasons !== null) {
    if (!Array.isArray(input.seasons)) return null;
    if (input.seasons.length > 0 && !CATEGORY_CONFIG[category as Category].hasSeasons) return null;
    for (const s of input.seasons) {
      const sv = validateSeasonInput(s);
      if (!sv.ok) return null;
      seasons.push({ label: sv.value.label ?? '', rating: sv.value.rating ?? null, notes: sv.value.notes ?? '' });
    }
  }
  return {
    category: category as Category,
    title: f.title!,
    status: f.status ?? null,
    rating: f.rating ?? null,
    genres: f.genres ?? '',
    creator: f.creator ?? '',
    album: f.album ?? '',
    coverUrl: f.coverUrl ?? '',
    notes: f.notes ?? '',
    seasons,
  };
}

const placeholders = (params: number, rows: number, literalTail = '') =>
  Array.from({ length: rows }, () => `(${Array(params).fill('?').join(', ')}${literalTail})`).join(', ');

const ENTRY_COLS =
  'id, user_id, category, title, typed_title, status, rating, genres, creator, album, cover_url, notes, lookup_state, import_id, created_at, updated_at';

// 1 lookup + 1 batch (<= 46 statements). All-or-nothing.
importApi.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(invalid, 400);
  }
  if (!isPlainObject(body)) return c.json(invalid, 400);
  const { importId, rows } = body;
  if (typeof importId !== 'string' || !UUID_RE.test(importId)) return c.json(invalid, 400);
  if (!Array.isArray(rows) || rows.length === 0) return c.json(invalid, 400);

  const seasonTotal = rows.reduce(
    (n: number, r) => n + (isPlainObject(r) && Array.isArray(r.seasons) ? r.seasons.length : 0),
    0,
  );
  if (rows.length > IMPORT_CHUNK_ROWS || seasonTotal > IMPORT_CHUNK_SEASONS) {
    return c.json({ error: 'too_large', maxRows: IMPORT_CHUNK_ROWS, maxSeasons: IMPORT_CHUNK_SEASONS }, 400);
  }

  const clean: CleanRow[] = [];
  for (const r of rows) {
    const row = cleanRow(r);
    if (!row) return c.json(invalid, 400);
    clean.push(row);
  }

  const db = c.env.DB;
  const userId = c.var.user.id;
  const existing = await db
    .prepare('SELECT user_id, counts_json FROM imports WHERE id = ?')
    .bind(importId)
    .first<{ user_id: string; counts_json: string | null }>();
  if (existing && existing.user_id !== userId) return c.json(notFound, 404);

  // Running totals for the imports row.
  let counts: Record<string, number> = {};
  try {
    const parsed = existing?.counts_json ? JSON.parse(existing.counts_json) : {};
    if (isPlainObject(parsed)) counts = parsed as Record<string, number>;
  } catch { /* corrupt counts start over */ }
  counts.total = counts.total ?? 0;
  for (const r of clean) {
    counts[r.category] = (counts[r.category] ?? 0) + 1;
    counts.total += 1;
  }

  const baseMs = Date.now();
  const now = new Date(baseMs).toISOString();
  const entryVals: unknown[][] = [];
  const seasonVals: unknown[][] = [];
  clean.forEach((r) => {
    const id = crypto.randomUUID();
    entryVals.push([
      id, userId, r.category, r.title, r.title, r.status, r.rating, r.genres, r.creator, r.album,
      r.coverUrl, r.notes, r.coverUrl ? 'ok' : 'not_found', importId, now, now,
    ]);
    for (const s of r.seasons) {
      // Distinct created_at keeps the sheet's season order (seasons list by created_at).
      const at = new Date(baseMs + seasonVals.length).toISOString();
      seasonVals.push([crypto.randomUUID(), id, s.label, s.rating, s.notes, at]);
    }
  });

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO imports (id, user_id, created_at, counts_json) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET counts_json = excluded.counts_json WHERE imports.user_id = excluded.user_id`,
      )
      .bind(importId, userId, now, JSON.stringify(counts)),
  ];
  for (let i = 0; i < entryVals.length; i += ENTRIES_PER_STATEMENT) {
    const part = entryVals.slice(i, i + ENTRIES_PER_STATEMENT);
    const tuples = placeholders(ENTRY_PARAMS, part.length, ", 'none'"); // 'none' is details_state
    stmts.push(
      db
        .prepare(`INSERT INTO entries (${ENTRY_COLS}, details_state) VALUES ${tuples}`)
        .bind(...(part.flat() as never[])),
    );
  }
  for (let i = 0; i < seasonVals.length; i += SEASONS_PER_STATEMENT) {
    const part = seasonVals.slice(i, i + SEASONS_PER_STATEMENT);
    stmts.push(
      db
        .prepare(`INSERT INTO seasons (id, entry_id, label, rating, notes, created_at) VALUES ${placeholders(SEASON_PARAMS, part.length)}`)
        .bind(...(part.flat() as never[])),
    );
  }
  await db.batch(stmts);
  return c.json({ inserted: clean.length });
});

// 1 lookup (with count) + 1 batch of 2 (seasons go via ON DELETE CASCADE).
importApi.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.var.user.id;
  if (!UUID_RE.test(id)) return c.json(notFound, 404);
  const db = c.env.DB;
  const owned = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM entries e WHERE e.import_id = i.id AND e.user_id = i.user_id) AS n
       FROM imports i WHERE i.id = ? AND i.user_id = ?`,
    )
    .bind(id, userId)
    .first<{ n: number }>();
  if (!owned) return c.json(notFound, 404);
  // (D1's meta.changes would include cascaded season rows, so count entries up front.)
  await db.batch([
    db.prepare('DELETE FROM entries WHERE import_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM imports WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return c.json({ deleted: owned.n });
});
