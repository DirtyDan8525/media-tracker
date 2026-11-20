/**
 * Custom lists (Phase 7): make, edit and delete your own lists. Your lists ride on /api/me (`me.customLists`), so every
 * write here puts the server's answer back into the `me` cache (and its on-device copy); the nav, menus and Settings follow.
 */
import { CUSTOM_LISTS_MAX, type CustomList, type CustomListInput } from '@media-tracker/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';
import type { Me } from '../api/types';
import { localDb } from '../db/local';
import { forgetCurrentList, CURRENT_LIST_KEY } from '../shell/currentList';
import { COUNTS_KEY } from './useEntries';
import { ME_KEY, normalizeMe, storeMe } from './useMe';

export { CUSTOM_LISTS_MAX };

/** Shown when a seventh list is asked for (the button says it first). */
export const LIMIT_TEXT = `You can have up to ${CUSTOM_LISTS_MAX} custom lists. Delete one to make another.`;

async function putLists(qc: QueryClient, lists: CustomList[]): Promise<void> {
  const cur = qc.getQueryData<Me>(ME_KEY);
  if (!cur) return;
  const next = normalizeMe({ ...cur, customLists: lists });
  qc.setQueryData(ME_KEY, next);
  await storeMe(next);
}

/** What went wrong, in words for the form. */
export function listErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return (err.body as { message?: string } | undefined)?.message ?? LIMIT_TEXT;
    if (err.status === 403) return 'New lists are switched off right now.';
    if (err.status === 400) {
      const field = (err.body as { field?: string } | undefined)?.field;
      if (field === 'name') return 'Give the list a name (up to 40 characters).';
      if (field === 'noun') return 'Say what one item is (up to 24 characters).';
      if (field === 'icon') return 'The icon must be one emoji.';
      if (field === 'creatorLabel') return 'The second line\'s name can be up to 24 characters.';
      return "Something in the form isn't right. Check it and try again.";
    }
  }
  return "Couldn't save the list. Check your connection and try again.";
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomListInput) => api.post<{ list: CustomList; lists: CustomList[] }>('/api/lists', input),
    onSuccess: async ({ lists }) => putLists(qc, lists),
  });
}

export function useEditList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CustomListInput> }) =>
      api.patch<{ list: CustomList; lists: CustomList[] }>(`/api/lists/${encodeURIComponent(id)}`, patch),
    onSuccess: async ({ lists }) => putLists(qc, lists),
  });
}

/** Deletes a list and every title on it. The device's copy of its titles goes too, and settings are re-read (the server tidied them). */
export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (list: CustomList) => api.del<{ lists: CustomList[] }>(`/api/lists/${encodeURIComponent(list.id)}`),
    onSuccess: async ({ lists }, list) => {
      await putLists(qc, lists);
      qc.removeQueries({ queryKey: ['entries', list.key] });
      try {
        await localDb.entries.where('category').equals(list.key).delete();
      } catch {
        // no device copy
      }
      try {
        if (localStorage.getItem(CURRENT_LIST_KEY) === list.key) forgetCurrentList();
      } catch {
        // storage unavailable
      }
      void qc.invalidateQueries({ queryKey: COUNTS_KEY });
      void qc.invalidateQueries({ queryKey: ['entries-cache'] });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}
