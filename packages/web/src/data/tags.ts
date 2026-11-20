import { TAGS_PER_ENTRY_MAX, TAGS_PER_USER_MAX, type Entry, type TagInfo } from '@media-tracker/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { writeEntry } from './entryCache';
import { refreshCategories } from './useEntries';

export const TAGS_KEY = ['tags'] as const;

/** My tags (A-Z) with how many titles carry each: the suggestions on a title page and the Settings > Tags list. */
export function useMyTags(enabled = true) {
  return useQuery({ queryKey: TAGS_KEY, queryFn: () => api.get<TagInfo[]>('/api/tags'), enabled });
}

/** The words for a refused add or remove. */
export function tagError(err: unknown): string {
  if (err instanceof ApiError && err.error === 'tag_limit') return `You can have up to ${TAGS_PER_USER_MAX} tags. Delete one in Settings → Tags first.`;
  if (err instanceof ApiError && err.error === 'entry_tag_limit') return `A title can have up to ${TAGS_PER_ENTRY_MAX} tags.`;
  if (err instanceof ApiError && err.status === 400) return 'A tag is 1 to 30 characters.';
  return "Couldn't change the tags. Try again.";
}

/** Puts a tag on a title (made on first use). Resolves to the title's new tags; throws the ApiError when refused. */
export async function addTag(qc: QueryClient, entry: Entry, name: string): Promise<string[]> {
  const { tags } = await api.post<{ tags: string[] }>(`/api/entries/${entry.id}/tags`, { name });
  writeEntry(qc, { ...entry, tags });
  void qc.invalidateQueries({ queryKey: TAGS_KEY });
  return tags;
}

export async function removeTag(qc: QueryClient, entry: Entry, name: string): Promise<string[]> {
  const { tags } = await api.del<{ tags: string[] }>(`/api/entries/${entry.id}/tags/${encodeURIComponent(name)}`);
  writeEntry(qc, { ...entry, tags });
  void qc.invalidateQueries({ queryKey: TAGS_KEY });
  return tags;
}

/** After a rename or delete in Settings, every title's tags changed: reload the tag list and the lists on show. */
export function tagsChanged(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: TAGS_KEY });
  void qc.invalidateQueries({ queryKey: ['entry'] });
  const cats = new Set<string>();
  for (const [key] of qc.getQueriesData<Entry[]>({ queryKey: ['entries'] })) if (typeof key[1] === 'string') cats.add(key[1]);
  void refreshCategories(qc, [...cats] as Parameters<typeof refreshCategories>[1]);
}
