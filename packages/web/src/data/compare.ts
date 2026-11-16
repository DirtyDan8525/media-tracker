import type { Category } from '@media-tracker/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export const COMPARE_QUEUE_KEY = ['compare-queue'] as const;

export interface QueueItem { entryId: string; category: Category }

/** Entries rated since they were last compared, oldest first. */
export function useCompareQueue() {
  return useQuery({
    queryKey: COMPARE_QUEUE_KEY,
    queryFn: async () => (await api.get<{ items: QueueItem[] }>('/api/compare/queue')).items,
  });
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
