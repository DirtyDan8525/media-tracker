import { Hono } from 'hono';
import {
  CATEGORY_CONFIG,
  ENTRIES_PER_STATEMENT,
  IMPORT_CHUNK_ROWS,
  IMPORT_CHUNK_SEASONS,
  IMPORT_ENTRY_PARAMS,
  IMPORT_SEASON_PARAMS,
  SEASONS_PER_STATEMENT,
  importStatementCount,
  type Category,
  type ImportRow,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import { CATEGORIES, validateEntryInput, validateSeasonInput } from './entryValidation';

export const importApi = new Hono<AppEnv>();

// Re-exported for the Worker's tests.
export { IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS, importStatementCount };

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
// A 6000-row sheet is a few dozen chunks; anything far past that is not our client.
const MAX_CHUNK_INDEX = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Chunk sizing (IMPORT_CHUNK_ROWS / IMPORT_CHUNK_SEASONS and how they follow from D1's limits)
// lives in @media-tracker/shared, so the web client splits imports with the numbers enforced here.

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
  // Optional chunk index: a retry of a chunk that already landed (the reply was lost) must not insert twice.
  const chunk = body.chunk;
  if (chunk !== undefined && (typeof chunk !== 'number' || !Number.isInteger(chunk) || chunk < 0 || chunk > MAX_CHUNK_INDEX)) {
    return c.json(invalid, 400);
  }
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

  // Running totals for the imports row, plus the chunk indices already applied (same JSON, same batch).
  let counts: Record<string, number> = {};
  let applied: number[] = [];
  try {
    const parsed = existing?.counts_json ? JSON.parse(existing.counts_json) : {};
    if (isPlainObject(parsed)) {
      const { chunks, ...rest } = parsed as Record<string, unknown>;
      counts = rest as Record<string, number>;
      if (Array.isArray(chunks)) applied = chunks.filter((n): n is number => Number.isInteger(n));
    }
  } catch { /* corrupt counts start over */ }
  if (chunk !== undefined && applied.includes(chunk)) return c.json({ inserted: 0, duplicate: true });
  if (chunk !== undefined) applied.push(chunk);
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
      .bind(importId, userId, now, JSON.stringify(applied.length ? { ...counts, chunks: applied } : counts)),
  ];
  for (let i = 0; i < entryVals.length; i += ENTRIES_PER_STATEMENT) {
    const part = entryVals.slice(i, i + ENTRIES_PER_STATEMENT);
    const tuples = placeholders(IMPORT_ENTRY_PARAMS, part.length, ", 'none'"); // 'none' is details_state
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
        .prepare(`INSERT INTO seasons (id, entry_id, label, rating, notes, created_at) VALUES ${placeholders(IMPORT_SEASON_PARAMS, part.length)}`)
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
