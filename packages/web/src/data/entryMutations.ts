import type { Entry } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { COMPARE_QUEUE_KEY } from './compare';
import { patchLocal, restoreLocal, writeEntry } from './entryCache';

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
  try {
    const saved = await api.patch<Entry>(`/api/entries/${entry.id}`, patch);
    writeEntry(qc, saved);
    // A new rating can put the entry on the Compare queue.
    if ('rating' in patch) void qc.invalidateQueries({ queryKey: COMPARE_QUEUE_KEY });
    return saved;
  } catch (err) {
    if (prev) restoreLocal(qc, prev);
    onFail?.(err);
    return null;
  }
}
