import {
  listOfSet, seasonSetOf, type Category, type Entry, type RatingSet, type SavePayload, type SetItem, type TierSet,
  type Comparison, type UserSettings,
} from '@media-tracker/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Me } from '../api/types';
import { COMPARE_QUEUE_KEY } from './compare';
import { entryKey, writeEntry } from './entryCache';
import { refreshCategories } from './useEntries';
import { ME_KEY, normalizeMe, storeMe } from './useMe';

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
 * Saves a rating session. Writes the returned entries to the entry cache and invalidates the set,
 * the queue and, for season sets, the seasons (a season save returns `entries: []`, so the parent
 * entries are refetched for their season average). Reloads and retries once on a 409.
 */
export async function saveRatingsResult(qc: QueryClient, set: RatingSet, payload: SavePayload): Promise<SaveResult> {
  try {
    const res = await withConflictRetry(qc, set, () =>
      api.post<{ items: SetItem[]; entries: Entry[] }>(`/api/ratings/${encodeURIComponent(set)}/save`, payload));
    for (const e of res.entries) writeEntry(qc, e);
  } catch (err) {
    return isConflict(err) ? 'conflict' : 'failed';
  }
  void qc.invalidateQueries({ queryKey: ratingSetKey(set) });
  void qc.invalidateQueries({ queryKey: COMPARE_QUEUE_KEY });
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

/**
 * Sets a list's tiers (null = the defaults). Writes the returned entries and settings; the list's
 * set and its seasons set reload. Reloads and retries once on a 409. False on failure.
 */
export async function saveTiers(qc: QueryClient, list: Category, tiers: TierSet | null): Promise<boolean> {
  try {
    const res = await withConflictRetry(qc, list, () =>
      api.put<{ settings: UserSettings; entries: Entry[] }>(`/api/ratings/tiers/${encodeURIComponent(list)}`, { tiers }));
    for (const e of res.entries) writeEntry(qc, e);
    const prev = qc.getQueryData<Me>(ME_KEY);
    if (prev) {
      const next = normalizeMe({ ...prev, settings: res.settings });
      qc.setQueryData(ME_KEY, next);
      await storeMe(next);
    } else {
      void qc.invalidateQueries({ queryKey: ME_KEY });
    }
  } catch {
    return false;
  }
  void qc.invalidateQueries({ queryKey: ratingSetKey(list) });
  const seasons = seasonSetOf(list);
  if (seasons !== null) void qc.invalidateQueries({ queryKey: ratingSetKey(seasons) });
  return true;
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
