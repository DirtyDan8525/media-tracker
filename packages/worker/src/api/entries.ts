import { Hono } from 'hono';
import {
  CATEGORY_CONFIG,
  findDuplicate,
  seasonSetOf,
  tiersFor,
  type Category,
  type Entry,
  type RatedItem,
  type Season,
  type Tier,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import {
  applyRatingEdit, loadSet, planEdit, ratedFields, rowToComparison, setWriteStatements,
  type LoadedItem, type RatingEdit,
} from '../ratings/store';
import { enqueueStatements } from './compare';
import { CATEGORIES, validateEntryInput, validateSeasonInput, type EntryFields } from './entryValidation';

export { validateEntryInput, validateSeasonInput } from './entryValidation';

export const entries = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const notFound = { error: 'not_found' } as const;
const noSeasons = { error: 'no_seasons' } as const;

// Database row (snake_case) shapes.
export interface EntryRow {
  id: string; user_id: string; category: Category; title: string; typed_title: string;
  status: Entry['status']; rating: number | null; genres: string; creator: string; album: string;
  cover_url: string; notes: string; release_date: string; synopsis: string; length_label: string;
  origin: string; details_state: Entry['detailsState']; is_private: number; notes_private: number;
  source: Entry['source']; source_id: string | null; lookup_state: Entry['lookupState'];
  import_id: string | null; season_avg: number | null; created_at: string; updated_at: string;
  tier: Tier | null; prior_mean: number | null; strength: number | null; score_locked: number;
}
export interface SeasonRow {
  id: string; entry_id: string; label: string; rating: number | null; notes: string; created_at: string;
  tier: Tier | null; prior_mean: number | null; strength: number | null; score_locked: number;
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
    tier: r.tier,
    priorMean: r.prior_mean,
    strength: r.strength,
    scoreLocked: r.score_locked === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToSeason(r: SeasonRow): Season {
  return {
    id: r.id, entryId: r.entry_id, label: r.label, rating: r.rating, notes: r.notes,
    tier: r.tier, priorMean: r.prior_mean, strength: r.strength, scoreLocked: r.score_locked === 1,
  };
}

export const ENTRY_SELECT = `SELECT e.*, (SELECT AVG(s.rating) FROM seasons s WHERE s.entry_id = e.id AND s.rating IS NOT NULL) AS season_avg FROM entries e`;

// camelCase field -> column, with boolean columns stored 0/1. The rating fields (rating, tier,
// scoreLocked) are not written through this map: they go through the ratings model.
type PlainFields = Omit<EntryFields, 'rating' | 'tier' | 'scoreLocked'>;
const COLUMNS: Record<keyof PlainFields, string> = {
  title: 'title', typedTitle: 'typed_title', status: 'status', genres: 'genres',
  creator: 'creator', album: 'album', coverUrl: 'cover_url', notes: 'notes', releaseDate: 'release_date',
  synopsis: 'synopsis', lengthLabel: 'length_label', origin: 'origin', detailsState: 'details_state',
  isPrivate: 'is_private', notesPrivate: 'notes_private', source: 'source', sourceId: 'source_id',
  lookupState: 'lookup_state',
};
const dbValue = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** Splits validated fields into the plain columns and the rating edit (only the keys sent). */
function splitRating<T extends { rating?: number | null; tier?: Tier; scoreLocked?: boolean }>(v: T) {
  const { rating, tier, scoreLocked, ...rest } = v;
  const edit: RatingEdit = {};
  if ('rating' in v) edit.rating = rating ?? null;
  if (tier !== undefined) edit.tier = tier;
  if (scoreLocked !== undefined) edit.scoreLocked = scoreLocked;
  return { rest, edit, hasEdit: Object.keys(edit).length > 0 };
}

const unrated = (id: string, kind: LoadedItem['kind'], title: string): LoadedItem => ({
  id, kind, title, cover: '', square: false, status: null,
  rating: null, tier: null, priorMean: null, strength: null, scoreLocked: false,
});
const RATED_COLS = ['rating', 'tier', 'prior_mean', 'strength', 'score_locked'];
const ratedValues = (i: RatedItem) => [i.rating, i.tier, i.priorMean, i.strength, i.scoreLocked ? 1 : 0];

/**
 * A rating edit on a title already stored: applied to its row as loaded with its set, then the
 * old and new tiers re-fit (Ruling Q9). Null when the edit changes nothing (e.g. the number
 * re-sent unchanged), 'invalid', or the statements and the title's final state.
 */
async function editStored(
  db: D1Database, userId: string, set: Parameters<typeof loadSet>[2], tiers: Parameters<typeof loadSet>[3],
  current: RatedItem, id: string, edit: RatingEdit,
): Promise<null | 'invalid' | 'gone' | { stmts: D1PreparedStatement[]; before: RatedItem; item: RatedItem }> {
  // Checked on the row first, so a no-op edit costs no extra queries.
  const pre = applyRatingEdit(current, edit, tiers);
  if (pre === null || pre === 'invalid') return pre;
  const loaded = await loadSet(db, userId, set, tiers);
  const before = loaded.items.find((i) => i.id === id);
  if (!before) return 'gone';
  const next = applyRatingEdit(before, edit, tiers);
  if (next === null || next === 'invalid') return next;
  const { changed, item } = planEdit(loaded, next, tiers);
  return { stmts: setWriteStatements(db, userId, set, changed), before, item };
}

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

// 3 queries, plus sign-in (1-3): duplicate candidates, insert, re-select. A rated title (a number
// or a tier) adds loadSet (2) and, in the insert's batch, the set UPDATE [+ enqueue, trim]: ≤ 9.
entries.post('/entries', async (c) => {
  const body = await readJson(c.req.raw);
  const category = (body as { category?: unknown } | null)?.category;
  if (typeof category !== 'string' || !CATEGORIES.includes(category as Category)) return c.json(invalid, 400);
  const cat = category as Category;
  const v = validateEntryInput(body, 'create', cat);
  if (!v.ok) return c.json(invalid, 400);

  const db = c.env.DB;
  const userId = c.var.user.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { rest, edit } = splitRating(v.value);
  const values: PlainFields = {
    ...rest,
    typedTitle: rest.typedTitle ?? rest.title,
    lookupState: rest.lookupState ?? 'pending',
  };

  // A typed number or a tier alone (Q8: tier needs no rating); a tier alone starts in the middle.
  const tiers = tiersFor(c.var.user.settings, cat);
  const fresh = unrated(id, 'entry', values.title!);
  const edited = applyRatingEdit(fresh, edit, tiers);
  if (edited === 'invalid') return c.json(invalid, 400);
  let rated: RatedItem = edited ?? fresh;

  const { results: existing } = await db.prepare('SELECT id, title, creator FROM entries WHERE user_id = ? AND category = ?')
    .bind(userId, cat)
    .all<{ id: string; title: string; creator: string }>();
  const duplicateOf = findDuplicate(existing, { id, title: values.title!, creator: values.creator ?? '' }, cat);

  // A new title can change its neighbours' shown scores (the two-decimal rule), so its tier re-fits.
  let setStmts: D1PreparedStatement[] = [];
  if (rated.tier !== null) {
    const loaded = await loadSet(db, userId, cat, tiers);
    const { changed, item } = planEdit(loaded, rated as LoadedItem, tiers);
    rated = item;
    setStmts = setWriteStatements(db, userId, cat, changed.filter((i) => i.id !== id));
  }

  const keys = Object.keys(values) as (keyof PlainFields)[];
  const cols = ['id', 'user_id', 'category', ...keys.map((k) => COLUMNS[k]), ...RATED_COLS, 'created_at', 'updated_at'];
  const insert = db.prepare(`INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(id, userId, cat, ...keys.map((k) => dbValue(values[k])), ...ratedValues(rated), now, now);
  // A tier-only rating counts as a new rating for the queue (Q15).
  const queued = rated.rating !== null ? enqueueStatements(db, userId, id, c.var.user.settings.compareAsk) : [];
  await db.batch([insert, ...setStmts, ...queued]);

  const entry = await loadEntry(db, id, userId);
  return c.json({ entry, duplicateOf }, 201);
});

// 3 queries, plus sign-in (1-3): owner row, update, re-select. A rating edit that changes something
// adds loadSet (2) and, in the update's batch, the set UPDATE [+ enqueue, trim]: ≤ 8.
entries.patch('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const userId = c.var.user.id;
  const owned = await db.prepare('SELECT category, rating, tier, prior_mean, strength, score_locked FROM entries WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ category: Category; rating: number | null; tier: Tier | null; prior_mean: number | null; strength: number | null; score_locked: number }>();
  if (!owned) return c.json(notFound, 404);

  const v = validateEntryInput(await readJson(c.req.raw), 'patch', owned.category);
  if (!v.ok) return c.json(invalid, 400);
  const { rest, edit, hasEdit } = splitRating(v.value);

  let ratingStmts: D1PreparedStatement[] = [];
  let queued: D1PreparedStatement[] = [];
  if (hasEdit) {
    const tiers = tiersFor(c.var.user.settings, owned.category);
    const current = { id, title: '', ...ratedFields(owned, tiers) };
    const r = await editStored(db, userId, owned.category, tiers, current, id, edit);
    if (r === 'invalid') return c.json(invalid, 400);
    if (r === 'gone') return c.json(notFound, 404);
    if (r !== null) {
      ratingStmts = r.stmts;
      // A newly typed number, or a first tier for an unrated title, joins the queue (Q15).
      const isNew = (typeof edit.rating === 'number' && edit.rating !== r.before.rating) || (r.before.rating === null && r.item.rating !== null);
      if (isNew) queued = enqueueStatements(db, userId, id, c.var.user.settings.compareAsk);
    }
  }

  const keys = Object.keys(rest) as (keyof PlainFields)[];
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), 'updated_at = ?'];
  const update = db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...keys.map((k) => dbValue(rest[k])), new Date().toISOString(), id, userId);
  await db.batch([update, ...ratingStmts, ...queued]);
  return c.json(await loadEntry(db, id, userId));
});

// 1 batch of 2 queries: the entry (seasons and queue rows go via ON DELETE CASCADE; D1 enforces
// foreign keys) and the comparisons that name it (Q22; those naming its seasons stay).
entries.delete('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.var.user.id;
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').bind(id, userId),
    c.env.DB.prepare('DELETE FROM comparisons WHERE user_id = ?1 AND (winner_id = ?2 OR loser_id = ?2)').bind(userId, id),
  ]);
  if (res!.meta.changes === 0) return c.json(notFound, 404);
  return c.body(null, 204);
});

async function ownedEntry(db: D1Database, id: string, userId: string): Promise<{ category: Category; title: string } | null> {
  return db.prepare('SELECT category, title FROM entries WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ category: Category; title: string }>();
}

// 2 queries
entries.get('/entries/:id/seasons', async (c) => {
  const owner = await ownedEntry(c.env.DB, c.req.param('id'), c.var.user.id);
  if (!owner) return c.json(notFound, 404);
  if (!CATEGORY_CONFIG[owner.category].hasSeasons) return c.json(noSeasons, 400);
  const { results } = await c.env.DB.prepare('SELECT * FROM seasons WHERE entry_id = ? ORDER BY created_at, id')
    .bind(c.req.param('id'))
    .all<SeasonRow>();
  return c.json(results.map(rowToSeason));
});

const seasonOf = (base: Pick<Season, 'id' | 'entryId' | 'label' | 'notes'>, r: RatedItem): Season => ({
  ...base, rating: r.rating, tier: r.tier, priorMean: r.priorMean, strength: r.strength, scoreLocked: r.scoreLocked,
});

// 2 queries, plus sign-in (1-3): owner, insert. A rated season adds loadSet of its season tab (2)
// and the set UPDATE in the same batch: ≤ 5. Seasons never join the queue.
entries.post('/entries/:id/seasons', async (c) => {
  const entryId = c.req.param('id');
  const db = c.env.DB;
  const userId = c.var.user.id;
  const owner = await ownedEntry(db, entryId, userId);
  if (!owner) return c.json(notFound, 404);
  const set = seasonSetOf(owner.category);
  if (!CATEGORY_CONFIG[owner.category].hasSeasons || set === null) return c.json(noSeasons, 400);
  const v = validateSeasonInput(await readJson(c.req.raw));
  if (!v.ok) return c.json(invalid, 400);

  const { rest, edit } = splitRating(v.value);
  const base = { id: crypto.randomUUID(), entryId, label: rest.label ?? '', notes: rest.notes ?? '' };
  const tiers = tiersFor(c.var.user.settings, set);
  const fresh = unrated(base.id, 'season', `${owner.title} · ${base.label}`);
  const edited = applyRatingEdit(fresh, edit, tiers);
  if (edited === 'invalid') return c.json(invalid, 400);
  let rated: RatedItem = edited ?? fresh;
  let setStmts: D1PreparedStatement[] = [];
  if (rated.tier !== null) {
    const loaded = await loadSet(db, userId, set, tiers);
    const { changed, item } = planEdit(loaded, rated as LoadedItem, tiers);
    rated = item;
    setStmts = setWriteStatements(db, userId, set, changed.filter((i) => i.id !== base.id));
  }
  await db.batch([
    db.prepare(`INSERT INTO seasons (id, entry_id, label, notes, ${RATED_COLS.join(', ')}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(base.id, entryId, base.label, base.notes, ...ratedValues(rated), new Date().toISOString()),
    ...setStmts,
  ]);
  return c.json(seasonOf(base, rated), 201);
});

const SEASON_OWNED = `SELECT s.*, e.category AS category FROM seasons s JOIN entries e ON e.id = s.entry_id WHERE s.id = ? AND e.user_id = ?`;

// 2 queries, plus sign-in (1-3): ownership select, update. A rating edit adds loadSet of the
// season tab (2) and the set UPDATE in the same batch (≤ 5); the list itself never re-fits.
entries.patch('/seasons/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const userId = c.var.user.id;
  const owned = await db.prepare(SEASON_OWNED).bind(id, userId).first<SeasonRow & { category: Category }>();
  if (!owned) return c.json(notFound, 404);
  const v = validateSeasonInput(await readJson(c.req.raw));
  if (!v.ok) return c.json(invalid, 400);
  const { rest, edit, hasEdit } = splitRating(v.value);
  const base = { id, entryId: owned.entry_id, label: rest.label ?? owned.label, notes: rest.notes ?? owned.notes };

  const set = seasonSetOf(owned.category)!;
  const tiers = tiersFor(c.var.user.settings, set);
  let rated: RatedItem = { id, title: '', ...ratedFields(owned, tiers) };
  let ratingStmts: D1PreparedStatement[] = [];
  if (hasEdit) {
    const r = await editStored(db, userId, set, tiers, rated, id, edit);
    if (r === 'invalid') return c.json(invalid, 400);
    if (r === 'gone') return c.json(notFound, 404);
    if (r !== null) { ratingStmts = r.stmts; rated = r.item; }
  }
  await db.batch([
    db.prepare('UPDATE seasons SET label = ?, notes = ? WHERE id = ?').bind(base.label, base.notes, id),
    ...ratingStmts,
  ]);
  return c.json(seasonOf(base, rated));
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

// 1 batch of 3 statements (counts as 3): entries, seasons, and every comparison (undone ones and
// every set included; spec §7 "Export my data includes tiers and comparisons").
entries.get('/export', async (c) => {
  const userId = c.var.user.id;
  const [e, s, k] = await c.env.DB.batch([
    c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.user_id = ? ORDER BY e.created_at, e.rowid`).bind(userId),
    c.env.DB.prepare(
      'SELECT s.* FROM seasons s JOIN entries e ON e.id = s.entry_id WHERE e.user_id = ? ORDER BY s.created_at, s.id',
    ).bind(userId),
    c.env.DB.prepare(
      'SELECT id, category, winner_id, loser_id, is_tie, created_at, undone_at FROM comparisons WHERE user_id = ? ORDER BY created_at, rowid',
    ).bind(userId),
  ]);
  const body = {
    entries: (e!.results as EntryRow[]).map(rowToEntry),
    seasons: (s!.results as SeasonRow[]).map(rowToSeason),
    comparisons: (k!.results as Parameters<typeof rowToComparison>[0][]).map((r) => ({ category: r.category, ...rowToComparison(r) })),
    settings: c.var.user.settings,
  };
  return c.json(body, 200, { 'Content-Disposition': 'attachment; filename="media-tracker-export.json"' });
});
