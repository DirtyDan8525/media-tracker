import type { Details, Entry, LookupInfo } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { writeEntry } from '../data/entryCache';
import { detailsOnDevice } from './device';

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** The details for a match: AniList from this device (the Worker is blocked there), any other source via the server. `failed` means the source could not answer. */
export async function lookupDetails(q: { source: LookupInfo['source']; sourceId: string }): Promise<{ details: Details | null; failed?: boolean }> {
  if (q.source === 'anilist') return detailsOnDevice(q.sourceId);
  return api.post<{ details: Details | null; failed?: boolean }>('/api/lookup/details', q);
}

/**
 * Looks up the four detail fields for a matched entry and PATCHes them with detailsState 'filled'.
 * Best effort: any failure (or no details) leaves the entry as it is and says nothing.
 */
export async function fillDetails(qc: QueryClient, entry: Entry, info: Pick<LookupInfo, 'source' | 'sourceId'>): Promise<void> {
  if (!info.sourceId) return;
  try {
    const { details } = await lookupDetails({ source: info.source, sourceId: info.sourceId });
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
