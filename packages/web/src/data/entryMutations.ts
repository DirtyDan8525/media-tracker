import type { Entry } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { patchLocal, restoreLocal, writeEntry } from './entryCache';
import { CLOSE_COUNTS_KEY, ratingSetKey } from './ratings';
import { refreshCategories } from './useEntries';

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
  // A typed number is the truth (Ruling N1): it shows at once as both the typed and the shown number.
  const prev = patchLocal(qc, entry, 'rating' in patch ? { ...patch, typed: patch.rating } : patch);
  try {
    const saved = await api.patch<Entry>(`/api/entries/${entry.id}`, patch);
    writeEntry(qc, saved);
    // A retype re-fits the entry's list on the Worker, which returns only this row: reload the list
    // (a close neighbour's nudge may change), the rating set and the close-call counts.
    if ('rating' in patch) {
      void qc.invalidateQueries({ queryKey: ratingSetKey(entry.category) });
      void qc.invalidateQueries({ queryKey: CLOSE_COUNTS_KEY });
      void refreshCategories(qc, [entry.category]);
    }
    return saved;
  } catch (err) {
    if (prev) restoreLocal(qc, prev);
    onFail?.(err);
    return null;
  }
}
