import {
  listOfSet, seasonSetOf, type Category, type Entry, type RatingSet, type SavePayload, type SetItem,
  type Comparison, type UserSettings,
} from '@media-tracker/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { entryKey, writeEntry } from './entryCache';
import { refreshCategories } from './useEntries';

/** GET /api/ratings/:set */
export interface RatingSetData { items: SetItem[]; comparisons: Comparison[] }

export const ratingSetKey = (set: RatingSet) => ['rating-set', set] as const;

const loadSet = (set: RatingSet) => api.get<RatingSetData>(`/api/ratings/${encodeURIComponent(set)}`);

/** The titles and picks of one rating set (a list, or a seasons tab). */
export function useRatingSet(set: RatingSet, enabled = true) {
  return useQuery({ queryKey: ratingSetKey(set), queryFn: () => loadSet(set), enabled });
}

/** The set as the Worker has it now (always refetched): what a rating session starts from. */
export const fetchRatingSet = (qc: QueryClient, set: RatingSet): Promise<RatingSetData> =>
  qc.fetchQuery({ queryKey: ratingSetKey(set), queryFn: () => loadSet(set), staleTime: 0 });

const isConflict = (err: unknown): boolean => err instanceof ApiError && err.status === 409;

/**
 * A write the Worker may answer 409 (it re-fits a rating set and another write raced it; nothing
 * was saved): run it once more. Deletes and season edits use this; saves also reload their set first.
 */
export async function retryOnConflict<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isConflict(err)) throw err;
    return run();
  }
}

const isSeasons = (set: RatingSet): boolean => set === 'anime_seasons' || set === 'tv_seasons';

/**
 * Runs a rating write. A 409 means another device or tab changed the set after the Worker loaded
 * it (the Worker rolled the write back): reload the set so the cache is current, then try once more.
 * A second 409, or any other failure, throws.
 */
async function withConflictRetry<T>(qc: QueryClient, set: RatingSet, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isConflict(err)) throw err;
    // Another device changed the set: its rows in the list are stale too, whatever the retry does.
    // Wait for the reload: one that landed after the retry would overwrite the Worker's new rows.
    await refreshCategories(qc, [listOfSet(set)]);
    try {
      await qc.fetchQuery({ queryKey: ratingSetKey(set), queryFn: () => loadSet(set), staleTime: 0 });
    } catch {
      // The retry below reports the failure if the network is really gone.
    }
    return run();
  }
}

/** The parent list's entries and per-entry caches, after something changed a season's rating. */
async function refreshParents(qc: QueryClient, category: Category): Promise<void> {
  await refreshCategories(qc, [category]);
  void qc.invalidateQueries({ queryKey: ['entry'] });
}

/** 'conflict': the set changed elsewhere and the one retry conflicted too; the person must reload. */
export type SaveResult = 'ok' | 'conflict' | 'failed';

/**
 * Saves picks. Writes the returned entries to the entry cache and invalidates the set, the
 * close-call counts and, for season sets, the seasons (a season save returns `entries: []`, so the parent
 * entries are refetched for their season average). Reloads and retries once on a 409.
 */
export async function saveRatingsResult(qc: QueryClient, set: RatingSet, payload: SavePayload): Promise<SaveResult> {
  let res: { items: SetItem[]; entries: Entry[] };
  try {
    res = await withConflictRetry(qc, set, () =>
      api.post<{ items: SetItem[]; entries: Entry[] }>(`/api/ratings/${encodeURIComponent(set)}/save`, payload));
  } catch (err) {
    return isConflict(err) ? 'conflict' : 'failed';
  }
  // Saved on the Worker: a cache write that throws must not report a failure (the reload below fixes the cache).
  writeEntries(qc, res.entries, listOfSet(set));
  void qc.invalidateQueries({ queryKey: ratingSetKey(set) });
  void qc.invalidateQueries({ queryKey: CLOSE_COUNTS_KEY });
  if (isSeasons(set)) {
    void qc.invalidateQueries({ queryKey: ['seasons'] });
    await refreshParents(qc, listOfSet(set));
  }
  return 'ok';
}

/** `saveRatingsResult` as a boolean: false on any failure. */
export async function saveRatings(qc: QueryClient, set: RatingSet, payload: SavePayload): Promise<boolean> {
  return (await saveRatingsResult(qc, set, payload)) === 'ok';
}

// ---- Close calls (number-first, docs/plans/2026-11-16-phase5-number-first.md N6, N7) ----------

/** "Ask me to compare close ratings" (Ruling N9): on for Both and Only for new ratings. */
export const askCloseCalls = (settings: Pick<UserSettings, 'compareAsk'>): boolean =>
  settings.compareAsk === 'Both' || settings.compareAsk === 'Only for new ratings';

/** GET /api/ratings/:set/close/:id: the title just rated and at most 2 close titles to ask about. */
export interface CloseFor { item: SetItem; others: SetItem[] }
export const fetchCloseFor = (set: RatingSet, id: string): Promise<CloseFor> =>
  api.get<CloseFor>(`/api/ratings/${encodeURIComponent(set)}/close/${encodeURIComponent(id)}`);

/** GET /api/ratings/:set/close: a Sharpen session's pairs, nearest numbers first. */
export interface ClosePairsData { pairs: [string, string][]; total: number; items: SetItem[] }
export const closePairsKey = (set: RatingSet) => ['close-pairs', set] as const;
export function useClosePairs(set: RatingSet | null) {
  return useQuery({
    queryKey: closePairsKey(set ?? 'anime'),
    queryFn: () => api.get<ClosePairsData>(`/api/ratings/${encodeURIComponent(set!)}/close`),
    enabled: set !== null,
    // A session works from the pairs as they were when it opened; reopening loads them fresh.
    staleTime: Infinity, gcTime: 0,
  });
}

export const CLOSE_COUNTS_KEY = ['close-counts'] as const;
/** GET /api/ratings/close-counts: unanswered close pairs per rating set. */
export function useCloseCounts() {
  return useQuery({
    queryKey: CLOSE_COUNTS_KEY,
    queryFn: async () => (await api.get<{ counts: Partial<Record<RatingSet, number>> }>('/api/ratings/close-counts')).counts,
  });
}

export interface ClosePick { winnerId: string; loserId: string; isTie: boolean }

/**
 * Saves one close-call answer at once (N6). Returns the titles whose shown numbers changed, or
 * null when it failed (after one retry on a 409). Writes the returned entries to the caches.
 */
export async function saveClosePick(qc: QueryClient, set: RatingSet, pick: ClosePick): Promise<SetItem[] | null> {
  let res: { items: SetItem[]; entries: Entry[] };
  try {
    res = await withConflictRetry(qc, set, () => api.post<{ items: SetItem[]; entries: Entry[] }>(
      `/api/ratings/${encodeURIComponent(set)}/save`, { picks: [{ ...pick, undone: false }], moves: [], done: [] }));
  } catch {
    return null;
  }
  writeEntries(qc, res.entries, listOfSet(set));
  void qc.invalidateQueries({ queryKey: ratingSetKey(set) });
  void qc.invalidateQueries({ queryKey: CLOSE_COUNTS_KEY });
  if (isSeasons(set)) {
    void qc.invalidateQueries({ queryKey: ['seasons'] });
    void refreshParents(qc, listOfSet(set));
  }
  return res.items;
}

/**
 * "Clear close calls" (Dan, 2026-11-20): undoes the person's active close-call answers, for one title (`entryId`) or a whole
 * rating set. Scores go back to the typed numbers. Same cache updates as a close-call save; the pair lists reload
 * on the next session. True when it saved (after one retry on a 409).
 */
export async function clearCloseCalls(qc: QueryClient, set: RatingSet, entryId?: string): Promise<boolean> {
  let res: { items: SetItem[]; entries: Entry[] };
  try {
    res = await withConflictRetry(qc, set, () => api.post<{ items: SetItem[]; entries: Entry[] }>(
      '/api/ratings/clear', entryId === undefined ? { category: set } : { category: set, entryId }));
  } catch {
    return false;
  }
  writeEntries(qc, res.entries, listOfSet(set));
  void qc.invalidateQueries({ queryKey: ratingSetKey(set) });
  void qc.invalidateQueries({ queryKey: closePairsKey(set) });
  void qc.invalidateQueries({ queryKey: CLOSE_COUNTS_KEY });
  if (isSeasons(set)) {
    void qc.invalidateQueries({ queryKey: ['seasons'] });
    void refreshParents(qc, listOfSet(set));
  }
  return true;
}

/** Writes returned rows to the caches; if that throws, the list is reloaded instead. */
function writeEntries(qc: QueryClient, rows: Entry[], list: Category): void {
  try {
    for (const e of rows) writeEntry(qc, e);
  } catch {
    void qc.invalidateQueries({ queryKey: ['entries', list] });
  }
}

export type DeletedRow = { kind: 'entry'; category: Category } | { kind: 'season'; category: Category; entryId: string };

/**
 * Deletes answer 204 with no rows, but the Worker re-fits the neighbours, so their cached scores are
 * stale. Refetch the list and its set; after a season delete also the seasons and the parent entry's average.
 */
export async function refetchAfterDelete(qc: QueryClient, deleted: DeletedRow): Promise<void> {
  const seasons = seasonSetOf(deleted.category);
  if (deleted.kind === 'entry') {
    // An entry's seasons go with it, so its season set changes too.
    void qc.invalidateQueries({ queryKey: ratingSetKey(deleted.category) });
    if (seasons !== null) void qc.invalidateQueries({ queryKey: ratingSetKey(seasons) });
    await refreshCategories(qc, [deleted.category]);
    return;
  }
  await refetchAfterSeasonWrite(qc, deleted.category, deleted.entryId);
}

/**
 * After a season's rating changed (or a season went): the Worker re-fitted the season set, so the
 * other seasons' scores may have moved too. Reload the set, the entry's seasons, the entry and its
 * list (season average).
 */
export async function refetchAfterSeasonWrite(qc: QueryClient, category: Category, entryId: string): Promise<void> {
  const seasons = seasonSetOf(category);
  if (seasons !== null) void qc.invalidateQueries({ queryKey: ratingSetKey(seasons) });
  void qc.invalidateQueries({ queryKey: ['seasons', entryId] });
  void qc.invalidateQueries({ queryKey: entryKey(entryId) });
  await refreshParents(qc, category);
}
