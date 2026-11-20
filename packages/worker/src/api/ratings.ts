import { Hono } from 'hono';
import {
  PLAN_STATUS,
  RATINGS_SAVE_MAX_DONE,
  RATINGS_SAVE_MAX_MOVES,
  RATINGS_SAVE_MAX_PICKS,
  RATING_SETS,
  closePairs,
  closeQuestionsFor,
  countClosePairs,
  tiersFor,
  isCustomCategory,
  type CloseItem,
  type CustomList,
  type Entry,
  type PickInput,
  type RatingSet,
  type SavePayload,
  type Tier,
} from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { isSeasonSet, loadSet, loadSets, planSave, runBatch, setWriteStatements, toSetItem, type LoadedItem } from '../ratings/store';
import { ENTRY_SELECT, rowToEntry, type EntryRow } from './entries';
import { isTier } from './entryValidation';

/**
 * Ratings (number-first, docs/plans/2026-11-16-phase5-number-first.md). Everything here is scoped
 * to the signed-in user: comparisons are never readable or writable by anyone else, and ids that
 * aren't the user's are dropped.
 */
export const ratings = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const MAX_ID = 64;

/** A built-in set, or one of the signed-in person's custom lists (each is its own rating set, keyed by its list key). */
const isSet = (s: string, lists: readonly CustomList[]): s is RatingSet =>
  (RATING_SETS as readonly string[]).includes(s) || (isCustomCategory(s) && lists.some((l) => l.key === s));
/** Every rating set the person has: the built-in ones, then their custom lists. */
const allSets = (lists: readonly CustomList[]): RatingSet[] => [...RATING_SETS, ...lists.map((l) => l.key)];
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

/** Most pairs one Sharpen session loads (N7). */
export const SHARPEN_MAX_PAIRS = 200;

const closeItem = (i: LoadedItem): CloseItem => ({ id: i.id, title: i.title, typed: i.typed, planned: i.status === PLAN_STATUS });

// 4-19 queries: sign-in (1-3), then 1 batch of 10-16 (the eleven sets' and any custom lists' titles, their comparisons). N7.
// Registered before /:set so the static path is never read as a set name.
ratings.get('/close-counts', async (c) => {
  const settings = c.var.user.settings;
  const loaded = await loadSets(c.env.DB, c.var.user.id, allSets(c.var.user.customLists), (s) => tiersFor(settings, s));
  const counts: Partial<Record<RatingSet, number>> = {};
  for (const l of loaded) counts[l.set] = countClosePairs(l.items.map(closeItem), l.comparisons);
  return c.json({ counts });
});

// 3-5 queries: sign-in (1-3), then 1 batch of 2. A Sharpen session's questions (N7): the set's
// unanswered close pairs, nearest numbers first, at most SHARPEN_MAX_PAIRS, with their titles.
ratings.get('/:set/close', async (c) => {
  const set = c.req.param('set');
  if (!isSet(set, c.var.user.customLists)) return c.json(invalid, 400);
  const loaded = await loadSet(c.env.DB, c.var.user.id, set, tiersFor(c.var.user.settings, set));
  const items = loaded.items.map(closeItem);
  const pairs = closePairs(items, loaded.comparisons, SHARPEN_MAX_PAIRS);
  const named = new Set(pairs.flat());
  return c.json({ pairs, total: countClosePairs(items, loaded.comparisons), items: loaded.items.filter((i) => named.has(i.id)).map(toSetItem) });
});

// 3-5 queries: sign-in (1-3), then 1 batch of 2. The close-call questions after `id` was rated
// (N6): at most 2 titles close to it, nearest first, never answered, never planned.
ratings.get('/:set/close/:id', async (c) => {
  const set = c.req.param('set');
  if (!isSet(set, c.var.user.customLists)) return c.json(invalid, 400);
  const id = c.req.param('id');
  const loaded = await loadSet(c.env.DB, c.var.user.id, set, tiersFor(c.var.user.settings, set));
  const item = loaded.items.find((i) => i.id === id);
  if (item === undefined) return c.json({ error: 'not_found' }, 404);
  const others = closeQuestionsFor(id, loaded.items.map(closeItem), loaded.comparisons);
  const byId = new Map(loaded.items.map((i) => [i.id, i]));
  return c.json({ item: toSetItem(item), others: others.map((o) => toSetItem(byId.get(o)!)) });
});

// 3-5 queries: sign-in (1-3), then 1 batch of 2 (the set's titles, its comparisons)
ratings.get('/:set', async (c) => {
  const set = c.req.param('set');
  if (!isSet(set, c.var.user.customLists)) return c.json(invalid, 400);
  const loaded = await loadSet(c.env.DB, c.var.user.id, set, tiersFor(c.var.user.settings, set));
  return c.json({ items: loaded.items.map(toSetItem), comparisons: loaded.comparisons });
});

// 3-7 queries: sign-in (1-3), loadSet (2), then 1 batch of ≤ 3: comparisons UPDATE, set UPDATE, Entry re-select.
// "Clear close calls" (Dan, 2026-11-20): marks the person's active picks undone (every one naming `entryId`,
// or the whole set's), the same mark a typed re-rate uses, then re-fits the set: titles go back to their typed
// numbers. Answers like a save. Owner-only by construction (every statement is scoped to the signed-in user);
// no activity. Registered before /:set/save; a different path, so no clash.
ratings.post('/clear', async (c) => {
  const body = await readJson(c.req.raw);
  if (!isPlainObject(body)) return c.json(invalid, 400);
  const { category, entryId } = body;
  if (typeof category !== 'string' || !isSet(category, c.var.user.customLists)) return c.json(invalid, 400);
  if (entryId !== undefined && !isId(entryId)) return c.json(invalid, 400);

  const db = c.env.DB;
  const userId = c.var.user.id;
  const tiers = tiersFor(c.var.user.settings, category);
  const loaded = await loadSet(db, userId, category, tiers);
  if (entryId !== undefined && !loaded.items.some((i) => i.id === entryId)) return c.json({ error: 'not_found' }, 404);
  const named = (k: { winnerId: string; loserId: string }) => entryId === undefined || k.winnerId === entryId || k.loserId === entryId;
  const gone = loaded.comparisons.filter(named);
  if (gone.length === 0) return c.json({ items: [], entries: [] });

  const remaining = { ...loaded, comparisons: loaded.comparisons.filter((k) => !named(k)) };
  const { changed } = planSave(remaining, { picks: [], moves: [], done: [] }, tiers);
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE comparisons SET undone_at = ?4
        WHERE user_id = ?1 AND category = ?2 AND undone_at IS NULL AND (?3 IS NULL OR winner_id = ?3 OR loser_id = ?3)`,
    ).bind(userId, category, entryId ?? null, new Date().toISOString()),
    ...setWriteStatements(db, userId, category, changed, loaded.stored),
  ];
  const entryIds = isSeasonSet(category) ? [] : changed.map((i) => i.id);
  if (entryIds.length > 0) {
    stmts.push(db.prepare(
      `${ENTRY_SELECT} WHERE e.user_id = ?2 AND e.id IN (SELECT value FROM json_each(?1)) ORDER BY e.created_at, e.rowid`,
    ).bind(JSON.stringify(entryIds), userId));
  }
  const res = await runBatch(db, stmts);
  const entries: Entry[] = entryIds.length > 0 ? (res[res.length - 1]!.results as EntryRow[]).map(rowToEntry) : [];
  return c.json({ items: changed.map(toSetItem), entries });
});

// 3-9 queries: sign-in (1-3), loadSet (2), then 1 batch of ≤ 4: comparisons INSERT, set UPDATE,
// queue DELETE, Entry re-select. Picks, rows and done ids each travel as one JSON
// parameter, so no statement binds more than 4 parameters however large the save.
ratings.post('/:set/save', async (c) => {
  const set = c.req.param('set');
  if (!isSet(set, c.var.user.customLists)) return c.json(invalid, 400);
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
  // No activity: a close-call pick moves a score by at most 0.2 (N4), never a feed post.
  stmts.push(...setWriteStatements(db, userId, set, changed, loaded.stored));
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
  const res = stmts.length > 0 ? await runBatch(db, stmts) : [];
  const entries: Entry[] = entryIds.length > 0 ? (res[res.length - 1]!.results as EntryRow[]).map(rowToEntry) : [];
  return c.json({ items: changed.map(toSetItem), entries });
});
