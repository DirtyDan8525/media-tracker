import type { Entry } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { writeEntry } from '../data/entryCache';
import { fillDetails } from './details';
import { buildInfoPatch, buildLookupQuery } from './query';
import { runLookup } from './run';

/**
 * Looks an entry up again (with `term` if given) and overwrites what came from the lookup: title (by
 * the title rule), cover, genres, creator, album, source, then the four detail fields. Rating, status
 * and notes are never touched. Resolves to 'not_found' (nothing changed) or 'ok'; throws if saving fails.
 */
export async function refetchEntry(qc: QueryClient, entry: Entry, term?: string): Promise<'ok' | 'not_found'> {
  const typed = term?.trim() || entry.typedTitle || entry.title;
  const info = await runLookup(buildLookupQuery(entry.category, term?.trim() || entry.title, entry.creator));
  if (!info) return 'not_found';
  const saved = await api.patch<Entry>(`/api/entries/${entry.id}`, buildInfoPatch(entry, typed, info, 'refetch'));
  writeEntry(qc, saved);
  await fillDetails(qc, saved, info);
  return 'ok';
}
