import {
  CATEGORY_CONFIG,
  applyMove,
  applyTyped,
  listOfSet,
  priorFromScore,
  refitTier,
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
 * The lazy backfill (Ruling Q10): gives every rated row of the user that has no tier yet its
 * tier, prior and strength (= prior) from its list's tiers. Season rows use their entry's list.
 * `rating` is never written, so every shown score stays exactly as it was.
 *
 * 2 queries when there is nothing to do (one batch of 2 SELECTs), else 4 (plus a batch of ≤ 2
 * UPDATEs, each with its rows as one JSON parameter). Returns the number of rows assigned.
 */
export async function ensureTiers(db: D1Database, userId: string, settings: Pick<UserSettings, 'tiers'>): Promise<number> {
  const [e, s] = await db.batch([
    db.prepare('SELECT id, category, rating FROM entries WHERE user_id = ? AND rating IS NOT NULL AND tier IS NULL').bind(userId),
    db.prepare(
      `SELECT s.id, e.category, s.rating FROM seasons s JOIN entries e ON e.id = s.entry_id
        WHERE e.user_id = ? AND s.rating IS NOT NULL AND s.tier IS NULL`,
    ).bind(userId),
  ]);
  type Pending = { id: string; category: Category; rating: number };
  const rows = (r: D1Result | undefined) => ((r?.results ?? []) as Pending[]).map((p) => {
    const f = tierFieldsFor(p.rating, tiersFor(settings, p.category));
    return { id: p.id, tier: f.tier, prior: f.priorMean };
  });
  const entryRows = rows(e), seasonRows = rows(s);
  const stmts: D1PreparedStatement[] = [];
  const pick = `SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.tier') AS tier,
                       json_extract(value, '$.prior') AS prior FROM json_each(?1)`;
  if (entryRows.length > 0) {
    stmts.push(db.prepare(
      `UPDATE entries SET tier = j.tier, prior_mean = j.prior, strength = j.prior FROM (${pick}) AS j
        WHERE entries.id = j.id AND entries.user_id = ?2 AND entries.tier IS NULL AND entries.rating IS NOT NULL`,
    ).bind(JSON.stringify(entryRows), userId));
  }
  if (seasonRows.length > 0) {
    stmts.push(db.prepare(
      `UPDATE seasons SET tier = j.tier, prior_mean = j.prior, strength = j.prior FROM (${pick}) AS j
        WHERE seasons.id = j.id AND seasons.tier IS NULL AND seasons.rating IS NOT NULL
          AND seasons.entry_id IN (SELECT id FROM entries WHERE user_id = ?2)`,
    ).bind(JSON.stringify(seasonRows), userId));
  }
  if (stmts.length > 0) await db.batch(stmts);
  return entryRows.length + seasonRows.length;
}

// ---- Loading a rating set ------------------------------------------------------------------

export type SetKind = 'entry' | 'season';
export type LoadedItem = SetItem & { kind: SetKind };
type RatedFields = Pick<RatedItem, 'rating' | 'tier' | 'priorMean' | 'strength' | 'scoreLocked'>;

export interface LoadedSet {
  set: RatingSet;
  /** Every title of the set. A rated row with no tier yet has it derived on the fly (Q10). */
  items: LoadedItem[];
  /** The set's comparisons that are not undone. */
  comparisons: Comparison[];
  /** The rating fields exactly as stored, by id: what a write is diffed against. */
  stored: Map<string, RatedFields>;
}

export const isSeasonSet = (s: RatingSet): s is 'anime_seasons' | 'tv_seasons' => s === 'anime_seasons' || s === 'tv_seasons';

interface ItemRow {
  id: string; title: string; label?: string; rating: number | null; tier: Tier | null; prior_mean: number | null;
  strength: number | null; score_locked: number; cover_url: string; status?: Status | null;
}
interface ComparisonRow {
  id: string; category: string; winner_id: string; loser_id: string; is_tie: number; created_at: string; undone_at: string | null;
}

export const rowToComparison = (r: ComparisonRow): Comparison => ({
  id: r.id, winnerId: r.winner_id, loserId: r.loser_id, isTie: r.is_tie === 1, createdAt: r.created_at, undoneAt: r.undone_at,
});

/** The rating fields of a stored row, with a tier derived on the fly when it has a rating but none yet (Q10). */
export function ratedFields(r: Pick<ItemRow, 'rating' | 'tier' | 'prior_mean' | 'strength' | 'score_locked'>, tiers: TierSet): RatedFields {
  const f: RatedFields = { rating: r.rating, tier: r.tier, priorMean: r.prior_mean, strength: r.strength, scoreLocked: r.score_locked === 1 };
  return f.tier === null && f.rating !== null ? { ...f, ...tierFieldsFor(f.rating, tiers) } : f;
}

function itemsQuery(db: D1Database, userId: string, set: RatingSet): D1PreparedStatement {
  if (isSeasonSet(set)) {
    return db.prepare(
      `SELECT s.id, e.title AS title, s.label, s.rating, s.tier, s.prior_mean, s.strength, s.score_locked, e.cover_url
         FROM seasons s JOIN entries e ON e.id = s.entry_id
        WHERE e.user_id = ? AND e.category = ? ORDER BY e.created_at, e.rowid, s.created_at, s.id`,
    ).bind(userId, listOfSet(set));
  }
  return db.prepare(
    `SELECT id, title, rating, tier, prior_mean, strength, score_locked, cover_url, status
       FROM entries WHERE user_id = ? AND category = ? ORDER BY created_at, rowid`,
  ).bind(userId, set);
}

/**
 * Loads rating sets of one list (the list and/or its season tab) in one batch: one query per set
 * plus one for their comparisons. `tiers` are that list's tiers, used only for rows with no tier.
 */
export async function loadSets(db: D1Database, userId: string, sets: RatingSet[], tiers: TierSet): Promise<LoadedSet[]> {
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
    const stored = new Map<string, RatedFields>();
    const items = (res[k]!.results as ItemRow[]).map((r): LoadedItem => {
      stored.set(r.id, { rating: r.rating, tier: r.tier, priorMean: r.prior_mean, strength: r.strength, scoreLocked: r.score_locked === 1 });
      return {
        id: r.id, kind: season ? 'season' : 'entry',
        title: season ? `${r.title} · ${r.label}` : r.title,
        cover: r.cover_url, square, status: season ? null : (r.status ?? null),
        ...ratedFields(r, tiers),
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
  b !== undefined && a.rating === b.rating && a.tier === b.tier && a.priorMean === b.priorMean
  && a.strength === b.strength && a.scoreLocked === b.scoreLocked;

/** The items whose rating fields differ from what is stored (new items included). */
export const changedOf = <T extends RatedItem>(items: T[], stored: Map<string, RatedFields>): T[] =>
  items.filter((i) => !sameFields(i, stored.get(i.id)));

/**
 * Re-fits only the given tiers (Ruling Q9 as narrowed by the fit-cost ruling: tiers are fitted
 * independently, so re-fitting the touched tiers equals a full refitSet). Same order as `items`.
 */
export function refitTouched<T extends RatedItem>(
  items: T[], comparisons: Comparison[], tiers: TierSet, touched: Iterable<Tier | null>, opts?: { rangeChanged?: boolean },
): T[] {
  const out = new Map<string, T>();
  for (const t of new Set(touched)) {
    if (t === null) continue;
    const inTier = items.filter((i) => i.tier === t);
    for (const c of refitTier(inTier, comparisons, tierRange(tiers, t), opts)) out.set(c.id, c as T);
  }
  return items.map((i) => out.get(i.id) ?? i);
}

/** A rating edit from an entry or season form: only the keys the request carried. */
export interface RatingEdit { rating?: number | null; tier?: Tier; scoreLocked?: boolean }

/** Locks a rated title at its current number: prior from that number, strength = prior. */
function lockAt<T extends RatedItem>(item: T, tiers: TierSet): T {
  const priorMean = priorFromScore(item.rating!, tierRange(tiers, item.tier!));
  return { ...item, scoreLocked: true, priorMean, strength: priorMean };
}

/**
 * Applies a rating edit to one title (Rulings Q8, Q23). Returns the new item, null when nothing
 * changes, or 'invalid'.
 * - `rating` is an edit only when it differs from the stored rating; then `applyTyped`, with the
 *   lock passed only when the request carried `scoreLocked`. A `tier` beside it must be the tier
 *   that number falls in.
 * - Otherwise a `tier` that differs from the stored tier is a move (`applyMove`: rough place kept,
 *   unlocked; `scoreLocked: true` beside it locks at the moved number).
 * - Otherwise `scoreLocked` alone locks at the current number, or unlocks.
 * The tier is never re-derived from an unchanged number.
 */
export function applyRatingEdit<T extends RatedItem>(item: T, edit: RatingEdit, tiers: TierSet): T | null | 'invalid' {
  const lock = edit.scoreLocked;
  if (edit.rating !== undefined && edit.rating !== item.rating) {
    if (edit.tier !== undefined && (edit.rating === null || edit.tier !== tierFor(edit.rating, tiers))) return 'invalid';
    if (edit.rating === null && lock === true) return 'invalid';
    return applyTyped(item, edit.rating, tiers, lock) as T;
  }
  if (edit.tier !== undefined && edit.tier !== item.tier) {
    const moved = applyMove(item, edit.tier, tiers) as T;
    return lock === true ? lockAt(moved, tiers) : moved;
  }
  if (lock === true && (item.rating === null || item.tier === null)) return 'invalid';
  if (lock !== undefined && lock !== item.scoreLocked) return lock ? lockAt(item, tiers) : { ...item, scoreLocked: false };
  return null;
}

/**
 * One title's edit, re-fitted with its set: the old and the new tier are re-fitted. `next` may be
 * a new title (not in the set yet). Returns every changed item (the edited one included, with its
 * fitted values) and the edited item's final state.
 */
export function planEdit(loaded: LoadedSet, next: LoadedItem, tiers: TierSet): { changed: LoadedItem[]; item: LoadedItem } {
  const prev = loaded.items.find((i) => i.id === next.id);
  const items = prev ? loaded.items.map((i) => (i.id === next.id ? next : i)) : [...loaded.items, next];
  const final = refitTouched(items, loaded.comparisons, tiers, [prev?.tier ?? null, next.tier]);
  return { changed: changedOf(final, loaded.stored), item: final.find((i) => i.id === next.id)! };
}

/**
 * A ratings save (Ruling Q11), in memory: moves (`applyMove` from the stored row; a move to the
 * stored tier is a no-op), then the picks that name two known titles, then a re-fit of the tiers
 * touched by a move or by a counted pick. Unknown or foreign ids are dropped. Returns the changed
 * items and the picks to store (undone ones included).
 */
export function planSave(loaded: LoadedSet, payload: SavePayload, tiers: TierSet): { changed: LoadedItem[]; picks: PickInput[] } {
  const byId = new Map(loaded.items.map((i) => [i.id, i]));
  const touched = new Set<Tier | null>();
  for (const m of payload.moves) {
    const cur = byId.get(m.id);
    if (cur === undefined || cur.tier === m.tier) continue;
    byId.set(m.id, applyMove(cur, m.tier, tiers) as LoadedItem);
    touched.add(cur.tier).add(m.tier);
  }
  const picks = payload.picks.filter((p) => p.winnerId !== p.loserId && byId.has(p.winnerId) && byId.has(p.loserId));
  const counted: Comparison[] = [];
  picks.forEach((p, k) => {
    if (p.undone) return;
    counted.push({ id: `new-${k}`, winnerId: p.winnerId, loserId: p.loserId, isTie: p.isTie, createdAt: '', undoneAt: null });
    const tw = byId.get(p.winnerId)!.tier;
    if (tw !== null && tw === byId.get(p.loserId)!.tier) touched.add(tw);
  });
  const items = loaded.items.map((i) => byId.get(i.id)!);
  const final = refitTouched(items, [...loaded.comparisons, ...counted], tiers, touched);
  return { changed: changedOf(final, loaded.stored), picks };
}

// ---- Writing -------------------------------------------------------------------------------

const J = `SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.rating') AS rating,
                  json_extract(value, '$.tier') AS tier, json_extract(value, '$.prior') AS prior,
                  json_extract(value, '$.strength') AS strength, json_extract(value, '$.locked') AS locked
             FROM json_each(?1)`;

/**
 * The write for a set's changed rows: one UPDATE of tier, prior_mean, strength, score_locked and
 * rating (plus updated_at on entries), its rows as one JSON parameter (Ruling P14). Entries are
 * guarded by user and list; seasons by their entry's user and list. No statement when nothing changed.
 */
export function setWriteStatements(db: D1Database, userId: string, set: RatingSet, changed: RatedItem[]): D1PreparedStatement[] {
  if (changed.length === 0) return [];
  const json = JSON.stringify(changed.map((i) => ({
    id: i.id, rating: i.rating, tier: i.tier, prior: i.priorMean, strength: i.strength, locked: i.scoreLocked ? 1 : 0,
  })));
  const sets = 'rating = j.rating, tier = j.tier, prior_mean = j.prior, strength = j.strength, score_locked = j.locked';
  if (isSeasonSet(set)) {
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
export const toSetItem = ({ kind: _, ...i }: LoadedItem): SetItem => i;
