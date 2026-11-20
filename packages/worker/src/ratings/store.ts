import {
  CATEGORY_CONFIG,
  listOfSet,
  numberFirst,
  priorFromScore,
  round2,
  scoreOf,
  seasonSetOf,
  tierFor,
  tierRange,
  tiersFor,
  type Category,
  type Comparison,
  type PickInput,
  type RatedItem,
  type RatingSet,
  type SavePayload,
  type SetItem,
  type Status,
  type Tier,
  type TierSet,
  type UserSettings,
} from '@media-tracker/shared';

/** The rating fields of a row as the model needs them, from a rating alone (Ruling Q10). */
export function tierFieldsFor(rating: number, tiers: TierSet): { tier: Tier; priorMean: number; strength: number } {
  const tier = tierFor(rating, tiers);
  const priorMean = priorFromScore(rating, tierRange(tiers, tier));
  return { tier, priorMean, strength: priorMean };
}

/**
 * The typed number of a stored row (Ruling N2): its `typed` when set; else, for a 3c-era row, its
 * rating when it had no counted pick (strength = prior) or was locked, or the number its prior
 * stands for in its tier (3c clamped priors to 3–97% of the tier, so a fitted 10 reads 9.97).
 */
export function typedOf(
  r: { rating: number | null; typed?: number | null; tier: Tier | null; prior_mean: number | null; strength: number | null; score_locked: number },
  tiers: TierSet,
): number | null {
  if (r.typed !== undefined && r.typed !== null) return r.typed;
  if (r.rating === null) return null;
  const fitted = r.score_locked !== 1 && r.tier !== null && r.prior_mean !== null && r.strength !== null && r.strength !== r.prior_mean;
  return fitted ? round2(scoreOf(r.prior_mean!, tierRange(tiers, r.tier!))) : r.rating;
}

/**
 * The lazy backfill (Ruling N2): every rating set holding a rated row with no `typed` yet is
 * loaded (typed derived by `typedOf`), re-fitted number-first and written. Runs once per such
 * set; imports add rows with no `typed`, so their sets re-fit on the next sign-in.
 *
 * 2 queries when there is nothing to do, else 2 + 1 batch of ≤ 10 (the sets, their comparisons)
 * + 1 batch of ≤ 9 set UPDATEs. Returns the number of sets written.
 */
export async function ensureTyped(db: D1Database, userId: string, settings: Pick<UserSettings, 'tiers'>): Promise<number> {
  const [e, s] = await db.batch([
    // Both read only the rows still waiting (migration 0019's partial indexes; usually none), not every title.
    db.prepare('SELECT DISTINCT category FROM entries INDEXED BY idx_entries_untyped WHERE user_id = ? AND rating IS NOT NULL AND typed IS NULL').bind(userId),
    db.prepare(
      `SELECT DISTINCT e.category FROM seasons s INDEXED BY idx_seasons_untyped CROSS JOIN entries e ON e.id = s.entry_id
        WHERE e.user_id = ? AND s.rating IS NOT NULL AND s.typed IS NULL`,
    ).bind(userId),
  ]);
  const cats = (r: D1Result | undefined) => ((r?.results ?? []) as { category: Category }[]).map((x) => x.category);
  const sets: RatingSet[] = [
    ...cats(e),
    ...cats(s).map((c) => seasonSetOf(c)).filter((x): x is RatingSet => x !== null),
  ];
  if (sets.length === 0) return 0;
  const loaded = await loadSets(db, userId, sets, (set) => tiersFor(settings, set));
  const stmts = loaded.flatMap((l) => {
    const tiers = tiersFor(settings, l.set);
    // A row with no stored typed always differs from its re-fit (which carries the derived one).
    const changed = changedOf(refitNumberFirst(l.items, l.comparisons, tiers), l.stored);
    return setWriteStatements(db, userId, l.set, changed, l.stored);
  });
  if (stmts.length > 0) await runBatch(db, stmts);
  return sets.length;
}

// ---- Loading a rating set ------------------------------------------------------------------

export type SetKind = 'entry' | 'season';
export type LoadedItem = SetItem & { kind: SetKind; /** seasons: the parent entry */ entryId?: string };
type RatedFields = Pick<RatedItem, 'rating' | 'tier' | 'priorMean' | 'strength' | 'scoreLocked'> & { typed: number | null };
/** As stored, with the row's `rating_rev` (the optimistic guard's version). */
type StoredFields = RatedFields & { rev: number };

export interface LoadedSet {
  set: RatingSet;
  /** Every title of the set. A rated row with no tier yet has it derived on the fly (Q10). */
  items: LoadedItem[];
  /** The set's comparisons that are not undone. */
  comparisons: Comparison[];
  /** The rating fields exactly as stored, by id: what a write is diffed against and guarded on. */
  stored: Map<string, StoredFields>;
}

export const isSeasonSet = (s: RatingSet): s is 'anime_seasons' | 'tv_seasons' => s === 'anime_seasons' || s === 'tv_seasons';

interface ItemRow {
  id: string; title: string; label?: string; rating: number | null; typed: number | null; tier: Tier | null; prior_mean: number | null;
  strength: number | null; score_locked: number; rating_rev: number; cover_url: string; status?: Status | null;
  entry_id?: string;
}
interface ComparisonRow {
  id: string; category: string; winner_id: string; loser_id: string; is_tie: number; created_at: string; undone_at: string | null;
}

export const rowToComparison = (r: ComparisonRow): Comparison => ({
  id: r.id, winnerId: r.winner_id, loserId: r.loser_id, isTie: r.is_tie === 1, createdAt: r.created_at, undoneAt: r.undone_at,
});

/** The rating fields of a stored row, with `typed` derived for a 3c-era row (N2). */
export function ratedFields(
  r: Pick<ItemRow, 'rating' | 'tier' | 'prior_mean' | 'strength' | 'score_locked'> & { typed?: number | null }, tiers: TierSet,
): RatedFields {
  return {
    rating: r.rating, typed: typedOf(r, tiers), tier: r.tier, priorMean: r.prior_mean, strength: r.strength, scoreLocked: r.score_locked === 1,
  };
}

function itemsQuery(db: D1Database, userId: string, set: RatingSet): D1PreparedStatement {
  if (isSeasonSet(set)) {
    return db.prepare(
      `SELECT s.id, s.entry_id, e.title AS title, s.label, s.rating, s.typed, s.tier, s.prior_mean, s.strength, s.score_locked, s.rating_rev, e.cover_url
         FROM seasons s JOIN entries e ON e.id = s.entry_id
        WHERE e.user_id = ? AND e.category = ? ORDER BY e.created_at, e.rowid, s.created_at, s.id`,
    ).bind(userId, listOfSet(set));
  }
  return db.prepare(
    `SELECT id, title, rating, typed, tier, prior_mean, strength, score_locked, rating_rev, cover_url, status
       FROM entries WHERE user_id = ? AND category = ? ORDER BY created_at, rowid`,
  ).bind(userId, set);
}

/**
 * Loads rating sets in one batch: one query per set plus one for their comparisons. `tiers` are the
 * sets' tiers (or a function of the set), used only to read a 3c-era row's typed number (N2).
 */
export async function loadSets(
  db: D1Database, userId: string, sets: RatingSet[], tiers: TierSet | ((s: RatingSet) => TierSet),
): Promise<LoadedSet[]> {
  const res = await db.batch([
    ...sets.map((s) => itemsQuery(db, userId, s)),
    db.prepare(
      `SELECT id, category, winner_id, loser_id, is_tie, created_at, undone_at FROM comparisons
        WHERE user_id = ? AND category IN (SELECT value FROM json_each(?)) AND undone_at IS NULL ORDER BY created_at, rowid`,
    ).bind(userId, JSON.stringify(sets)),
  ]);
  const comps = (res[sets.length]!.results as ComparisonRow[]);
  return sets.map((set, k) => {
    const season = isSeasonSet(set);
    const square = CATEGORY_CONFIG[listOfSet(set)].square;
    const setTiers = typeof tiers === 'function' ? tiers(set) : tiers;
    const stored = new Map<string, StoredFields>();
    const items = (res[k]!.results as ItemRow[]).map((r): LoadedItem => {
      stored.set(r.id, { rating: r.rating, typed: r.typed, tier: r.tier, priorMean: r.prior_mean, strength: r.strength, scoreLocked: r.score_locked === 1, rev: r.rating_rev });
      return {
        id: r.id, kind: season ? 'season' : 'entry',
        title: season ? `${r.title} · ${r.label}` : r.title,
        cover: r.cover_url, square, status: season ? null : (r.status ?? null),
        ...(season ? { entryId: r.entry_id } : {}),
        ...ratedFields(r, setTiers),
      };
    });
    return { set, items, comparisons: comps.filter((c) => c.category === set).map(rowToComparison), stored };
  });
}

/** One rating set: 1 batch of 2 queries (its titles, its comparisons that are not undone). */
export async function loadSet(db: D1Database, userId: string, set: RatingSet, tiers: TierSet): Promise<LoadedSet> {
  return (await loadSets(db, userId, [set], tiers))[0]!;
}

// ---- Planning a write (pure: no I/O) -------------------------------------------------------

const sameFields = (a: RatedFields, b: RatedFields | undefined): boolean =>
  b !== undefined && a.rating === b.rating && a.typed === b.typed && a.tier === b.tier && a.priorMean === b.priorMean
  && a.strength === b.strength && a.scoreLocked === b.scoreLocked;

/** The items whose rating fields differ from what is stored (new items included). */
export const changedOf = <T extends RatedFields & { id: string }>(items: T[], stored: Map<string, RatedFields>): T[] =>
  items.filter((i) => !sameFields(i, stored.get(i.id)));

const UNRATED = { rating: null, typed: null, tier: null, priorMean: null, strength: null, scoreLocked: false } as const;

/**
 * Re-fits a whole rating set number-first (Rulings N1, N4, N5). Every rated title gets its shown
 * `rating`, `tier = tierFor(typed)`, `priorMean = typed`, `strength` = its unrounded shown value
 * and no lock; unrated titles are cleared. Same order as `items`.
 */
export function refitNumberFirst<T extends RatedItem>(items: T[], comparisons: Comparison[], tiers: TierSet): (T & { typed: number | null })[] {
  const shown = numberFirst(items.map((i) => ({ id: i.id, typed: i.typed ?? null })), comparisons);
  return items.map((i) => {
    const typed = i.typed ?? null;
    const v = shown.get(i.id);
    if (typed === null || v === undefined) return { ...i, ...UNRATED };
    return { ...i, rating: v.rating, typed, tier: tierFor(typed, tiers), priorMean: typed, strength: v.hundredths / 100, scoreLocked: false };
  });
}

/** A rating edit from an entry or season form: only the keys the request carried. */
export interface RatingEdit { rating?: number | null; tier?: Tier; scoreLocked?: boolean }

/**
 * Applies a rating edit to one title (Ruling N10). A `rating` that differs from the typed number
 * is a retype: it becomes the new typed number (null clears the rating). `tier` and `scoreLocked`
 * are ignored (old clients). Returns the new item, or null when nothing changes. Never 'invalid'
 * now; the type is kept for the callers.
 */
export function applyRatingEdit<T extends RatedItem>(item: T, edit: RatingEdit, tiers: TierSet): T | null | 'invalid' {
  if (edit.rating === undefined || edit.rating === (item.typed ?? null)) return null;
  if (edit.rating === null) return { ...item, ...UNRATED };
  const r = edit.rating;
  return { ...item, rating: r, typed: r, tier: tierFor(r, tiers), priorMean: r, strength: r, scoreLocked: false };
}

/**
 * One title's edit (or a new title), re-fitted with its whole set. Returns every changed item (the
 * edited one included, with its shown values) and the edited item's final state.
 */
export function planEdit(loaded: LoadedSet, next: LoadedItem, tiers: TierSet): { changed: LoadedItem[]; item: LoadedItem } {
  const known = loaded.items.some((i) => i.id === next.id);
  const items = known ? loaded.items.map((i) => (i.id === next.id ? next : i)) : [...loaded.items, next];
  const final = refitNumberFirst(items, loaded.comparisons, tiers);
  return { changed: changedOf(final, loaded.stored), item: final.find((i) => i.id === next.id)! };
}

/**
 * A ratings save (Ruling Q11 as amended by N10): the picks that name two known, different titles
 * are stored (undone ones included) and the set re-fits with the ones not undone. `moves` and
 * `done` are ignored. Returns the changed items and the picks to store.
 */
export function planSave(loaded: LoadedSet, payload: SavePayload, tiers: TierSet): { changed: LoadedItem[]; picks: PickInput[] } {
  const ids = new Set(loaded.items.map((i) => i.id));
  const picks = payload.picks.filter((p) => p.winnerId !== p.loserId && ids.has(p.winnerId) && ids.has(p.loserId));
  const counted: Comparison[] = picks.flatMap((p, k) => (p.undone ? [] : [{
    id: `new-${k}`, winnerId: p.winnerId, loserId: p.loserId, isTie: p.isTie, createdAt: '', undoneAt: null,
  }]));
  const final = refitNumberFirst(loaded.items, [...loaded.comparisons, ...counted], tiers);
  return { changed: changedOf(final, loaded.stored), picks };
}

/**
 * Titles leaving a set (deleted entries, seasons or an import): the set re-fits without them, so a
 * neighbour that loses its picks shows its own number again. Returns the remaining changed items.
 */
export function planRemove(loaded: LoadedSet, gone: (i: LoadedItem) => boolean, tiers: TierSet): LoadedItem[] {
  const items = loaded.items.filter((i) => !gone(i));
  if (items.length === loaded.items.length) return [];
  return changedOf(refitNumberFirst(items, loaded.comparisons, tiers), loaded.stored);
}

// ---- Writing -------------------------------------------------------------------------------

/** A set write found a row changed since it was loaded (a concurrent write); nothing was saved. */
export class RatingConflict extends Error {
  constructor() { super('rating_conflict'); }
}

/** The named CHECK on `rating_rev` (migration 0005) that a stale set write violates. */
export const RATING_GUARD = 'rating_rev_mismatch';

/**
 * Runs a batch that contains set writes. A stale row makes its UPDATE violate the named
 * constraint `rating_rev_mismatch` (see `setWriteStatements`), which rolls the whole batch back;
 * only that constraint becomes RatingConflict (409). Every other error stays an error (500).
 */
export async function runBatch(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  try {
    return await db.batch(stmts);
  } catch (e) {
    const msg = String(e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : e);
    if (msg.includes(RATING_GUARD)) throw new RatingConflict();
    throw e;
  }
}

const J = `SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.rev') AS rev,
                  json_type(value, '$.rating') IS NOT NULL AS rc, json_extract(value, '$.rating') AS rating,
                  json_type(value, '$.typed') IS NOT NULL AS tc, json_extract(value, '$.typed') AS typed,
                  json_extract(value, '$.tier') AS tier, json_extract(value, '$.prior') AS prior,
                  json_extract(value, '$.strength') AS strength, json_extract(value, '$.locked') AS locked
             FROM json_each(?1)`;

/**
 * The write for a set's changed rows: one UPDATE of tier, prior_mean, strength, score_locked and,
 * only where they changed, rating and typed (plus updated_at on entries). The rows travel as one JSON
 * parameter (Ruling P14); a row whose rating did not change carries no rating, so a stored score
 * never round-trips through JSON. Entries are guarded by user and list; seasons by their entry's
 * user and list.
 *
 * Optimistic guard: each row carries the `rating_rev` it was loaded with. A fresh row gets
 * rev + 1; a row whose stored rev differs (another write landed in between) gets -1, which the
 * named CHECK `rating_rev_mismatch` refuses, aborting the batch (`runBatch` → 409). No extra
 * statement and no guard rows: nothing is left behind on success or failure. Rows deleted in
 * between simply match nothing. No statement when nothing changed.
 */
export function setWriteStatements(
  db: D1Database, userId: string, set: RatingSet, changed: RatedItem[], stored: Map<string, StoredFields>,
): D1PreparedStatement[] {
  if (changed.length === 0) return [];
  const json = JSON.stringify(changed.map((i) => {
    const old = stored.get(i.id);
    const row: Record<string, unknown> = {
      id: i.id, rev: old?.rev ?? 0, tier: i.tier, prior: i.priorMean, strength: i.strength, locked: i.scoreLocked ? 1 : 0,
    };
    if (old === undefined || old.rating !== i.rating) row.rating = i.rating;
    const typed = i.typed ?? null;
    if (old === undefined || old.typed !== typed) row.typed = typed;
    return row;
  }));
  const t = isSeasonSet(set) ? 'seasons' : 'entries';
  const sets = `rating = CASE WHEN j.rc THEN j.rating ELSE ${t}.rating END,
                typed = CASE WHEN j.tc THEN j.typed ELSE ${t}.typed END,
                tier = j.tier, prior_mean = j.prior, strength = j.strength, score_locked = j.locked,
                rating_rev = CASE WHEN ${t}.rating_rev IS j.rev THEN ${t}.rating_rev + 1 ELSE -1 END`;
  if (t === 'seasons') {
    return [db.prepare(
      `UPDATE seasons SET ${sets} FROM (${J}) AS j
        WHERE seasons.id = j.id AND seasons.entry_id IN (SELECT id FROM entries WHERE user_id = ?2 AND category = ?3)`,
    ).bind(json, userId, listOfSet(set))];
  }
  return [db.prepare(
    `UPDATE entries SET ${sets}, updated_at = ?4 FROM (${J}) AS j
      WHERE entries.id = j.id AND entries.user_id = ?2 AND entries.category = ?3`,
  ).bind(json, userId, set, new Date().toISOString())];
}

/** A SetItem as the API returns it (no `kind`). */
export const toSetItem = ({ kind: _k, entryId: _e, ...i }: LoadedItem): SetItem => i;

