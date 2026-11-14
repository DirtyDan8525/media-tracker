import type { LookupInfo } from '@media-tracker/shared';
import { api } from '../api/client';
import { searchOnDevice } from './device';
import type { LookupQuery } from './query';

/**
 * Anime tries AniList from this device first (the Worker is blocked there); everything else, and an
 * anime search that finds nothing or fails, is POST /api/lookup. A failed call counts as "nothing
 * found" (callers offer Retry).
 */
export async function runLookup(q: LookupQuery): Promise<LookupInfo | null> {
  const local = await searchOnDevice(q);
  if (local) return local;
  try {
    return (await api.post<{ info: LookupInfo | null }>('/api/lookup', q)).info ?? null;
  } catch {
    return null;
  }
}
