import { DEFAULT_USER_SETTINGS, markCustomized, type Customized, type NavSettings, type UserSettings } from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { localDb } from '../db/local';
import { useToast } from '../design/components/Toast';
import { isOffline } from './useEntries';
import { registerLists } from '../lists/registry';

export const ME_KEY = ['me'] as const;
const SETTINGS_MUTATION = ['save-settings'] as const;

/** Fills any settings the server left out with the defaults (tabs merge per key). */
export function normalizeMe(me: Me): Me {
  const s: Partial<UserSettings> = me.settings ?? {};
  const customLists = Array.isArray(me.customLists) ? me.customLists : [];
  // Before anything renders them: every list name, word and column resolves through the registry.
  registerLists(customLists);
  return {
    ...me,
    customLists,
    recentEmoji: Array.isArray(me.recentEmoji) ? me.recentEmoji : [],
    customized: me.customized ?? {},
    settings: {
      ...DEFAULT_USER_SETTINGS,
      ...s,
      colors: { ...s.colors },
      tabs: { ...DEFAULT_USER_SETTINGS.tabs, ...s.tabs },
      notify: { ...DEFAULT_USER_SETTINGS.notify, ...s.notify },
      nav: { ...DEFAULT_USER_SETTINGS.nav, ...s.nav },
      listOrder: Array.isArray(s.listOrder) ? s.listOrder : [],
    },
  };
}

export async function cachedMe(): Promise<Me | null> {
  try {
    const copy = (await localDb.me.get('me'))?.value ?? null;
    return copy ? normalizeMe(copy) : null;
  } catch {
    return null;
  }
}

export async function storeMe(me: Me): Promise<void> {
  try {
    await localDb.me.put({ key: 'me', value: me });
  } catch {
    // best-effort cache
  }
}

/** The signed-in user. Paints from the on-device copy, then refreshes; offline, the copy is the result. */
export function useMe() {
  const cached = useQuery({ queryKey: ['me-cache'], queryFn: cachedMe, staleTime: Infinity });
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const me = normalizeMe(await api.get<Me>('/api/me'));
        await storeMe(me);
        return me;
      } catch (err) {
        const copy = isOffline(err) ? await cachedMe() : null;
        if (copy) return copy;
        throw err;
      }
    },
    placeholderData: cached.data ?? undefined,
    staleTime: 60_000,
  });
}

/** Saves a partial settings change; the UI updates at once and rolls back if the save fails. */
/** A settings update: any keys; `nav` may carry just the part that changed. */
export type SettingsUpdate = Omit<Partial<UserSettings>, 'nav'> & { nav?: Partial<NavSettings> };

export const SETTINGS_SAVE_ERROR = "Couldn't save your settings. Try again.";

/**
 * Saves a partial settings update optimistically; a failure rolls back. With `errorToast`, a failure
 * also shows that toast. It runs from the hook-level onError, which TanStack still calls after the
 * calling screen has unmounted (a Custom colour edit saved as you leave), unlike mutate()'s callbacks.
 */
export function useSaveSettings(opts: { errorToast?: string } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationKey: SETTINGS_MUTATION,
    mutationFn: (partial: SettingsUpdate) =>
      api.put<{ settings: UserSettings; customized?: Customized }>('/api/me/settings', { settings: partial }),
    onMutate: async (partial) => {
      await qc.cancelQueries({ queryKey: ME_KEY });
      const prev = qc.getQueryData<Me>(ME_KEY);
      if (prev) {
        qc.setQueryData<Me>(ME_KEY, {
          ...prev,
          customized: markCustomized(prev.customized ?? {}, partial as Record<string, unknown>),
          settings: {
            ...prev.settings,
            ...partial,
            tabs: { ...prev.settings.tabs, ...partial.tabs },
            colors: { ...prev.settings.colors, ...partial.colors },
            notify: { ...prev.settings.notify, ...partial.notify },
            nav: { ...prev.settings.nav, ...partial.nav },
          },
        });
      }
      return { prev };
    },
    onError: (_err, _partial, ctx) => {
      if (ctx?.prev) qc.setQueryData(ME_KEY, ctx.prev);
      if (opts.errorToast) toast.show(opts.errorToast);
    },
    onSuccess: async ({ settings, customized }) => {
      const cur = qc.getQueryData<Me>(ME_KEY);
      // Another toggle is still in flight: keep its optimistic state; the last save to land wins.
      if (!cur || qc.isMutating({ mutationKey: SETTINGS_MUTATION }) > 1) return;
      const next = normalizeMe({ ...cur, settings, customized: customized ?? cur.customized });
      qc.setQueryData(ME_KEY, next);
      await storeMe(next);
    },
  });
}

/** Claims or changes the username. Errors are ApiError: 400 'invalid', 409 'taken'. */
export function useSaveUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.put<Me>('/api/me/username', { username }),
    onSuccess: async (me) => {
      const next = normalizeMe(me);
      qc.setQueryData(ME_KEY, next);
      await storeMe(next);
    },
  });
}
