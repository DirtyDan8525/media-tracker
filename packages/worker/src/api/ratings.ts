import { Hono } from 'hono';
import {
  DEFAULT_TIERS,
  RATINGS_SAVE_MAX_DONE,
  RATINGS_SAVE_MAX_MOVES,
  RATINGS_SAVE_MAX_PICKS,
  RATING_SETS,
  seasonSetOf,
  tierRange,
  tiersFor,
  validateTierSet,
  type Category,
  type Entry,
  type PickInput,
  type RatingSet,
  type SavePayload,
  type Tier,
  type TierSet,
  type UserSettings,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import {
  changedOf, isSeasonSet, loadSet, loadSets, planSave, refitTouched, setWriteStatements, toSetItem,
} from '../ratings/store';
import { ENTRY_SELECT, rowToEntry, type EntryRow } from './entries';
import { CATEGORIES, isTier } from './entryValidation';

/**
 * Tier ratings (spec v1.2 §5.2). Everything here is scoped to the signed-in user: comparisons
 * are never readable or writable by anyone else, and ids that aren't the user's are dropped.
 */
export const ratings = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const MAX_ID = 64;

const isSet = (s: string): s is RatingSet => (RATING_SETS as readonly string[]).includes(s);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= MAX_ID;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** The save body (Ruling Q11), or null when anything is malformed or over the limits. */
export function parseSavePayload(body: unknown): SavePayload | null {
  if (!isPlainObject(body)) return null;
  const { picks, moves, done } = body;
  if (!Array.isArray(picks) || picks.length > RATINGS_SAVE_MAX_PICKS) return null;
  if (!Array.isArray(moves) || moves.length > RATINGS_SAVE_MAX_MOVES) return null;
  if (!Array.isArray(done) || done.length > RATINGS_SAVE_MAX_DONE) return null;
  const outPicks: PickInput[] = [];
  for (const p of picks) {
    if (!isPlainObject(p)) return null;
    const { winnerId, loserId, isTie, undone } = p;
    if (!isId(winnerId) || !isId(loserId) || typeof isTie !== 'boolean' || typeof undone !== 'boolean') return null;
    outPicks.push({ winnerId, loserId, isTie, undone });
  }
  const seen = new Set<string>();
  const outMoves: { id: string; tier: Tier }[] = [];
  for (const m of moves) {
    if (!isPlainObject(m) || !isId(m.id) || !isTier(m.tier) || seen.has(m.id)) return null;
    seen.add(m.id);
    outMoves.push({ id: m.id, tier: m.tier });
  }
  if (!done.every(isId)) return null;
  return { picks: outPicks, moves: outMoves, done: done as string[] };
}

// 3-5 queries: sign-in (1-3), then 1 batch of 2 (the set's titles, its comparisons)
ratings.get('/:set', async (c) => {
  const set = c.req.param('set');
  if (!isSet(set)) return c.json(invalid, 400);
  const loaded = await loadSet(c.env.DB, c.var.user.id, set, tiersFor(c.var.user.settings, set));
  return c.json({ items: loaded.items.map(toSetItem), comparisons: loaded.comparisons });
});

// 3-9 queries: sign-in (1-3), loadSet (2), then 1 batch of ≤ 4: comparisons INSERT, set UPDATE,
// queue DELETE, Entry re-select. Picks, rows and done ids each travel as one JSON parameter.
ratings.post('/:set/save', async (c) => {
  const set = c.req.param('set');
  if (!isSet(set)) return c.json(invalid, 400);
  const payload = parseSavePayload(await readJson(c.req.raw));
  if (!payload) return c.json(invalid, 400);

  const db = c.env.DB;
  const userId = c.var.user.id;
  const tiers = tiersFor(c.var.user.settings, set);
  const loaded = await loadSet(db, userId, set, tiers);
  const { changed, picks } = planSave(loaded, payload, tiers);

  // created_at = request time + index ms keeps the picks' order; client clocks are ignored.
  const base = Date.now();
  const undoneAt = new Date(base + picks.length).toISOString();
  const stmts: D1PreparedStatement[] = [];
  if (picks.length > 0) {
    const json = JSON.stringify(picks.map((p, k) => ({
      id: crypto.randomUUID(), w: p.winnerId, l: p.loserId, t: p.isTie ? 1 : 0,
      at: new Date(base + k).toISOString(), u: p.undone ? undoneAt : null,
    })));
    stmts.push(db.prepare(
      `INSERT INTO comparisons (id, user_id, category, winner_id, loser_id, is_tie, created_at, undone_at)
       SELECT json_extract(value, '$.id'), ?2, ?3, json_extract(value, '$.w'), json_extract(value, '$.l'),
              json_extract(value, '$.t'), json_extract(value, '$.at'), json_extract(value, '$.u')
         FROM json_each(?1)`,
    ).bind(json, userId, set));
  }
  stmts.push(...setWriteStatements(db, userId, set, changed));
  if (payload.done.length > 0) {
    stmts.push(db.prepare('DELETE FROM compare_queue WHERE user_id = ?1 AND entry_id IN (SELECT value FROM json_each(?2))')
      .bind(userId, JSON.stringify(payload.done)));
  }
  const entryIds = isSeasonSet(set) ? [] : changed.map((i) => i.id);
  if (entryIds.length > 0) {
    stmts.push(db.prepare(
      `${ENTRY_SELECT} WHERE e.user_id = ?2 AND e.id IN (SELECT value FROM json_each(?1)) ORDER BY e.created_at, e.rowid`,
    ).bind(JSON.stringify(entryIds), userId));
  }
  const res = stmts.length > 0 ? await db.batch(stmts) : [];
  const entries: Entry[] = entryIds.length > 0 ? (res[res.length - 1]!.results as EntryRow[]).map(rowToEntry) : [];
  return c.json({ items: changed.map(toSetItem), entries });
});

/** The tiers whose score range differs between two tier sets (a names-only change has none). */
function rangeChanged(a: TierSet, b: TierSet): Tier[] {
  return ([0, 1, 2, 3] as Tier[]).filter((t) => {
    const [x0, x1] = tierRange(a, t), [y0, y1] = tierRange(b, t);
    return x0 !== y0 || x1 !== y1;
  });
}

// ≤ 10 queries: sign-in (1-3); when a range changed, 1 batch of 3 (the list's titles, its season
// tab's titles, their comparisons); then 1 batch of ≤ 4: settings UPDATE, entries UPDATE, seasons
// UPDATE, Entry re-select.
//
// Body `{ tiers: TierSet | null }` (null = back to the defaults; Ruling Q3). Changing a boundary
// moves no title between tiers: priors stay, and the tiers whose range changed re-fit with
// `rangeChanged`, so their scores spread over the new range (locked titles keep their numbers).
// The list's season tab uses the same tiers (Q4) and re-fits with it.
ratings.put('/tiers/:list', async (c) => {
  const list = c.req.param('list');
  if (!CATEGORIES.includes(list as Category)) return c.json(invalid, 400);
  const cat = list as Category;
  const body = await readJson(c.req.raw);
  if (!isPlainObject(body) || !('tiers' in body)) return c.json(invalid, 400);
  let chosen: TierSet | null = null;
  if (body.tiers !== null) {
    chosen = validateTierSet(body.tiers);
    if (chosen === null) return c.json(invalid, 400);
  }

  const db = c.env.DB;
  const userId = c.var.user.id;
  const current = c.var.user.settings;
  const oldTiers = tiersFor(current, cat);
  const newTiers = chosen ?? DEFAULT_TIERS;
  const tiers = { ...current.tiers };
  if (chosen === null) delete tiers[cat];
  else tiers[cat] = chosen;
  const settings: UserSettings = { ...current, tiers };

  const stmts: D1PreparedStatement[] = [
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').bind(JSON.stringify(settings), userId),
  ];
  let entryIds: string[] = [];
  const touched = rangeChanged(oldTiers, newTiers);
  if (touched.length > 0) {
    const sets: RatingSet[] = [cat];
    const seasons = seasonSetOf(cat);
    if (seasons !== null) sets.push(seasons);
    // Rows with no tier yet get theirs from the old tiers, so they too keep their tier.
    for (const loaded of await loadSets(db, userId, sets, oldTiers)) {
      const final = refitTouched(loaded.items, loaded.comparisons, newTiers, touched, { rangeChanged: true });
      const changed = changedOf(final, loaded.stored);
      stmts.push(...setWriteStatements(db, userId, loaded.set, changed));
      if (!isSeasonSet(loaded.set)) entryIds = changed.map((i) => i.id);
    }
  }
  if (entryIds.length > 0) {
    stmts.push(db.prepare(
      `${ENTRY_SELECT} WHERE e.user_id = ?2 AND e.id IN (SELECT value FROM json_each(?1)) ORDER BY e.created_at, e.rowid`,
    ).bind(JSON.stringify(entryIds), userId));
  }
  const res = await db.batch(stmts);
  const entries: Entry[] = entryIds.length > 0 ? (res[res.length - 1]!.results as EntryRow[]).map(rowToEntry) : [];
  return c.json({ settings, entries });
});
