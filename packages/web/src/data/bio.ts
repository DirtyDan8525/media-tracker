import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { ME_KEY, normalizeMe, storeMe } from './useMe';

/** Saves (or clears, with '') your bio. Errors are ApiError: 400 'invalid' or 'no_links'. */
export function useSaveBio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bio: string) => api.put<Me>('/api/me/bio', { bio }),
    onSuccess: async (me) => {
      const prev = qc.getQueryData<Me>(ME_KEY);
      const next = normalizeMe(prev ? { ...prev, bio: me.bio ?? null } : me);
      qc.setQueryData(ME_KEY, next);
      await storeMe(next);
    },
  });
}
