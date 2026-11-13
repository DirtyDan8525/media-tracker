import type { Entry } from '@media-tracker/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { entryKey } from './entryCache';

/** One entry: shown at once from a list that already has it, then fetched. */
export function useEntry(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: entryKey(id),
    queryFn: () => api.get<Entry>(`/api/entries/${encodeURIComponent(id)}`),
    placeholderData: () => qc.getQueriesData<Entry[]>({ queryKey: ['entries'] })
      .flatMap(([, rows]) => rows ?? []).find((e) => e.id === id),
  });
}
