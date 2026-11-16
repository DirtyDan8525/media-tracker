import type { Entry } from '@media-tracker/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { entryKey } from './entryCache';
import { normalizeEntry } from './useEntries';

/** One entry: shown at once from a list that already has it, then fetched. Pre-3c rows read as unrated-tier. */
export function useEntry(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: entryKey(id),
    queryFn: async () => normalizeEntry(await api.get<Entry>(`/api/entries/${encodeURIComponent(id)}`)),
    placeholderData: () => {
      const hit = qc.getQueriesData<Entry[]>({ queryKey: ['entries'] }).flatMap(([, rows]) => rows ?? []).find((e) => e.id === id);
      return hit && normalizeEntry(hit);
    },
  });
}
