import type { Entry, LookupInfo } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { lookupRunning, patchLocal, writeEntry } from '../data/entryCache';
import { fillDetails } from './details';
import { buildInfoPatch } from './query';

/**
 * Applies a chosen lookup match to an entry (cover, genres, creator, album, source; the title by the
 * title rule; never rating, status or notes), then fetches its details. The row changes at once and
 * the server's copy replaces it. `settle` also marks the details as done (detailsState 'filled'), for
 * a match the user picked by hand. Resolves to false (after reloading the list) if the save failed.
 */
export async function applyLookupMatch(
  qc: QueryClient,
  entry: Entry,
  typed: string,
  info: LookupInfo,
  opts: { settle?: boolean } = {},
): Promise<boolean> {
  const patch = { ...buildInfoPatch(entry, typed, info, 'add'), ...(opts.settle ? { detailsState: 'filled' as const } : {}) };
  patchLocal(qc, entry, patch);
  lookupRunning.delete(entry.id);
  let current: Entry;
  try {
    current = await api.patch<Entry>(`/api/entries/${entry.id}`, patch);
    writeEntry(qc, current);
  } catch {
    void qc.invalidateQueries({ queryKey: ['entries', entry.category] });
    return false;
  }
  await fillDetails(qc, current, info);
  return true;
}
