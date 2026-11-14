import type { Category, Entry } from '@media-tracker/shared';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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

/** The fetch (with cache write-through and offline fallback) behind every `['entries', category]` query. */
export function entriesQueryOptions(qc: QueryClient, category: Category) {
  return {
    queryKey: ['entries', category] as const,
    queryFn: async (): Promise<Entry[]> => {
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
  };
}

const cacheQueryOptions = (category: Category) => ({
  queryKey: ['entries-cache', category] as const,
  queryFn: () => cachedEntries(category),
  staleTime: Infinity,
});

/**
 * A category's entries: painted from the on-device cache first, then fetched; a successful fetch
 * replaces that category in the cache. Offline, the cached rows are the result.
 */
export function useEntries(category: Category) {
  const qc = useQueryClient();
  const cached = useQuery(cacheQueryOptions(category));
  return useQuery({
    ...entriesQueryOptions(qc, category),
    // An empty cache means "unknown", not "empty list": show the loading state instead.
    placeholderData: cached.data?.length ? cached.data : undefined,
  });
}

/**
 * Several lists at once, over the same `['entries', c]` queries and device cache as `useEntries`,
 * so a `writeEntry` shows up here too. A list with nothing cached stays absent until it is fetched.
 */
export function useAllEntries(categories: Category[]): {
  data: Partial<Record<Category, Entry[]>>;
  isPending: boolean;
  isError: boolean;
} {
  const qc = useQueryClient();
  const cached = useQueries({ queries: categories.map(cacheQueryOptions) });
  const lists = useQueries({
    queries: categories.map((c, i) => ({
      ...entriesQueryOptions(qc, c),
      placeholderData: cached[i]?.data?.length ? cached[i]!.data : undefined,
    })),
  });
  const data: Partial<Record<Category, Entry[]>> = {};
  categories.forEach((c, i) => {
    const rows = lists[i]?.data;
    if (rows) data[c] = rows;
  });
  return {
    data,
    isPending: lists.some((q) => q.isPending),
    isError: lists.some((q) => q.isError),
  };
}

/**
 * Several lists from the device only, never the network: the in-memory `['entries', c]` data when a
 * screen has loaded it this session, else the on-device cache. For decoration (About's cover fan).
 */
export function useDeviceEntries(categories: Category[]): Entry[] {
  const qc = useQueryClient();
  const cached = useQueries({ queries: categories.map(cacheQueryOptions) });
  return categories.flatMap((c, i) => qc.getQueryData<Entry[]>(['entries', c]) ?? cached[i]?.data ?? []);
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

/**
 * Reloads some lists after a bulk change (an import or its undo): fetches each, replaces the query
 * cache and the on-device copy, and refreshes everything derived from them. A list that can't be
 * fetched is left for the next visit to refresh.
 */
export async function refreshCategories(qc: QueryClient, categories: Category[]): Promise<void> {
  await Promise.all(categories.map(async (c) => {
    try {
      const rows = await api.get<Entry[]>(`/api/entries?category=${encodeURIComponent(c)}`);
      await storeEntries(c, rows);
      qc.setQueryData(['entries', c], rows);
    } catch {
      void qc.invalidateQueries({ queryKey: ['entries', c] });
    }
  }));
  void qc.invalidateQueries({ queryKey: ['entries-cache'] });
  void qc.invalidateQueries({ queryKey: ['backfill-entries'] });
  void qc.invalidateQueries({ queryKey: COUNTS_KEY });
}
