import { COMPARE_SAVE_MAX_CHANGES, type Category, type Entry, type RatingChange } from '@media-tracker/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { COMPARE_ENABLED } from '../features';
import { writeEntry } from './entryCache';

export const COMPARE_QUEUE_KEY = ['compare-queue'] as const;

export interface QueueItem { entryId: string; category: Category }

/** Entries rated since they were last compared, oldest first. Never fetched while Compare is hidden. */
export function useCompareQueue() {
  return useQuery({
    queryKey: COMPARE_QUEUE_KEY,
    enabled: COMPARE_ENABLED,
    queryFn: async () => (await api.get<{ items: QueueItem[] }>('/api/compare/queue')).items,
  });
}

/**
 * Saves new ratings in requests of at most COMPARE_SAVE_MAX_CHANGES; `doneEntryId` (the entry whose
 * pass this was) goes with the last one. Every returned entry is written to the caches. False if
 * any request failed (earlier chunks may already be saved).
 */
export async function saveCompareChanges(qc: QueryClient, changes: Pick<RatingChange, 'id' | 'rating'>[], doneEntryId?: string): Promise<boolean> {
  const chunks: { id: string; rating: number }[][] = [];
  for (let i = 0; i < changes.length; i += COMPARE_SAVE_MAX_CHANGES) chunks.push(changes.slice(i, i + COMPARE_SAVE_MAX_CHANGES).map(({ id, rating }) => ({ id, rating }))); // only what the server reads
  if (!chunks.length) chunks.push([]);
  let ok = true;
  try {
    for (const [i, chunk] of chunks.entries()) {
      const body: { changes: { id: string; rating: number }[]; doneEntryId?: string } = { changes: chunk };
      if (doneEntryId !== undefined && i === chunks.length - 1) body.doneEntryId = doneEntryId;
      const res = await api.post<{ updated: number; entries: Entry[] }>('/api/compare/save', body);
      for (const e of res.entries) writeEntry(qc, e);
    }
  } catch {
    ok = false;
  }
  void qc.invalidateQueries({ queryKey: COMPARE_QUEUE_KEY });
  return ok;
}

/** Takes an entry off the queue ("skip"). Failures are ignored: the next queue fetch is the truth. */
export async function dropFromQueue(qc: QueryClient, entryId: string): Promise<void> {
  try {
    await api.del(`/api/compare/queue/${encodeURIComponent(entryId)}`);
  } catch {
    // stays queued
  }
  await qc.invalidateQueries({ queryKey: COMPARE_QUEUE_KEY });
}
