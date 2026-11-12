import type { Category, Entry } from '@media-tracker/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { localDb } from '../db/local';
import { LIST_ORDER } from '../nav';

/** Network failure (offline, DNS, aborted) as opposed to an HTTP error answer. */
export const isOffline = (err: unknown): boolean => !(err instanceof ApiError);

export async function cachedEntries(category: Category): Promise<Entry[]> {
  try {
    return await localDb.entries.where('category').equals(category).toArray();
  } catch {
    return []; // IndexedDB unavailable (e.g. some private modes): no cache, not an error
  }
}

async function storeEntries(category: Category, rows: Entry[]): Promise<void> {
  try {
    await localDb.transaction('rw', localDb.entries, async () => {
      await localDb.entries.where('category').equals(category).delete();
      await localDb.entries.bulkPut(rows);
    });
  } catch {
    // The cache is best-effort.
  }
}

/**
 * A category's entries: painted from the on-device cache first, then fetched; a successful fetch
 * replaces that category in the cache. Offline, the cached rows are the result.
 */
export function useEntries(category: Category) {
  const qc = useQueryClient();
  const cached = useQuery({
    queryKey: ['entries-cache', category],
    queryFn: () => cachedEntries(category),
    staleTime: Infinity,
  });
  return useQuery({
    queryKey: ['entries', category],
    queryFn: async () => {
      try {
        const rows = await api.get<Entry[]>(`/api/entries?category=${encodeURIComponent(category)}`);
        await storeEntries(category, rows);
        void qc.invalidateQueries({ queryKey: COUNTS_KEY });
        return rows;
      } catch (err) {
        if (isOffline(err)) {
          const rows = await cachedEntries(category);
          if (rows.length) return rows;
        }
        throw err;
      }
    },
    // An empty cache means "unknown", not "empty list": show the loading state instead.
    placeholderData: cached.data?.length ? cached.data : undefined,
  });
}

export const COUNTS_KEY = ['list-counts'] as const;

/** Titles per list, from the on-device cache (shown beside nav items; unknown lists are absent). */
export function useListCounts() {
  return useQuery({
    queryKey: COUNTS_KEY,
    queryFn: async () => {
      const out: Partial<Record<Category, number>> = {};
      try {
        await Promise.all(LIST_ORDER.map(async (c) => {
          const n = await localDb.entries.where('category').equals(c).count();
          if (n > 0) out[c] = n;
        }));
      } catch {
        // no cache available
      }
      return out;
    },
    staleTime: Infinity,
  });
}
