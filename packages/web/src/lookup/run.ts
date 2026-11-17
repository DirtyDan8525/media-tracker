import type { Category, LookupInfo } from '@media-tracker/shared';
import { api } from '../api/client';
import { searchOnDevice } from './device';
import type { LookupQuery } from './query';

/** Lists whose last server lookup said its title search is not set up on the server (a pasted link still works). */
const needsSetup = new Set<Category>();

/** True when the server last said this list's title search needs setup (YouTube without an API key). */
export const searchNeedsSetup = (category: Category): boolean => needsSetup.has(category);

/**
 * Anime tries AniList from this device first (the Worker is blocked there); everything else, and an
 * anime search that finds nothing or fails, is POST /api/lookup. A failed call counts as "nothing
 * found" (callers offer Retry).
 */
export async function runLookup(q: LookupQuery): Promise<LookupInfo | null> {
  const local = await searchOnDevice(q);
  if (local) return local;
  try {
    const r = await api.post<{ info: LookupInfo | null; notConfigured?: boolean }>('/api/lookup', q);
    if (r.notConfigured) needsSetup.add(q.category);
    else needsSetup.delete(q.category);
    return r.info ?? null;
  } catch {
    return null;
  }
}
