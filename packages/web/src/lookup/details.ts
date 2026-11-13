import type { Details, Entry, LookupInfo } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { writeEntry } from '../data/entryCache';

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/**
 * Looks up the four detail fields for a matched entry and PATCHes them with detailsState 'filled'.
 * Best effort: any failure (or no details) leaves the entry as it is and says nothing.
 */
export async function fillDetails(qc: QueryClient, entry: Entry, info: Pick<LookupInfo, 'source' | 'sourceId'>): Promise<void> {
  if (!info.sourceId) return;
  try {
    const { details } = await api.post<{ details: Details | null }>('/api/lookup/details', { source: info.source, sourceId: info.sourceId });
    if (!details) return;
    const saved = await api.patch<Entry>(`/api/entries/${entry.id}`, {
      releaseDate: details.releaseDate,
      synopsis: clip(details.synopsis, 5000),
      lengthLabel: clip(details.lengthLabel, 300),
      origin: clip(details.origin, 300),
      detailsState: 'filled',
    });
    writeEntry(qc, saved);
  } catch {
    // leave the fields empty; the backfill (or a Re-fetch) can try again
  }
}
