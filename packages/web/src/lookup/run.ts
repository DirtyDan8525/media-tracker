import type { LookupInfo } from '@media-tracker/shared';
import { api } from '../api/client';
import type { LookupQuery } from './query';

/** POST /api/lookup. A failed call counts as "nothing found" (callers offer Retry). */
export async function runLookup(q: LookupQuery): Promise<LookupInfo | null> {
  try {
    return (await api.post<{ info: LookupInfo | null }>('/api/lookup', q)).info ?? null;
  } catch {
    return null;
  }
}
