import { DEFAULT_USER_SETTINGS, tierFor, tiersFor, type Category, type Entry, type TierSet } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { COMPARE_QUEUE_KEY } from './compare';
import { patchLocal, restoreLocal, writeEntry } from './entryCache';
import { ratingSetKey } from './ratings';
import { ME_KEY } from './useMe';
import type { Me } from '../api/types';
import { refreshCategories } from './useEntries';

/** The list's tiers from the cached profile (the defaults before it has loaded). */
export function cachedTiers(qc: QueryClient, category: Category): TierSet {
  return tiersFor(qc.getQueryData<Me>(ME_KEY)?.settings ?? DEFAULT_USER_SETTINGS, category);
}

export const SAVE_FAILED = "Couldn't save that change";

/**
 * PATCH an entry: the change shows at once; the server's row replaces it on success, and on failure
 * the old row comes back and `onFail` runs. Resolves to the saved entry, or null on failure.
 */
export async function saveEntryChange(
  qc: QueryClient,
  entry: Pick<Entry, 'id' | 'category'>,
  patch: Partial<Entry>,
  onFail?: (err: unknown) => void,
): Promise<Entry | null> {
  const prev = patchLocal(qc, entry, patch);
  // What the Worker will work out, shown now (the server's row replaces it). It is not part of the request:
  // a typed number is sent alone so the Worker picks the tier, and a tier chip sends no lock.
  if (prev && !('scoreLocked' in patch)) {
    const tier = typeof patch.rating === 'number' ? tierFor(patch.rating, cachedTiers(qc, entry.category)) : patch.tier;
    if (tier !== undefined && tier !== prev.tier) patchLocal(qc, entry, { tier, scoreLocked: false });
  }
  try {
    const saved = await api.patch<Entry>(`/api/entries/${entry.id}`, patch);
    writeEntry(qc, saved);
    // A new rating can put the entry on the Compare queue.
    if ('rating' in patch) void qc.invalidateQueries({ queryKey: COMPARE_QUEUE_KEY });
    // A rating, tier or lock edit re-fits the entry's tiers on the Worker, which returns only this
    // row: reload the list (its neighbours' scores) and the rating set.
    if ('rating' in patch || 'tier' in patch || 'scoreLocked' in patch) {
      void qc.invalidateQueries({ queryKey: ratingSetKey(entry.category) });
      void refreshCategories(qc, [entry.category]);
    }
    return saved;
  } catch (err) {
    if (prev) restoreLocal(qc, prev);
    onFail?.(err);
    return null;
  }
}
