import type { AvatarType } from '@media-tracker/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { ME_KEY, normalizeMe, storeMe } from './useMe';

/** The photo changed: `me` (with its new `avatarAt`) replaces the cached copy, in memory and on the device. */
function useStoreMe() {
  const qc = useQueryClient();
  return async (me: Me) => {
    const next = normalizeMe(me);
    qc.setQueryData(ME_KEY, next);
    await storeMe(next);
  };
}

/** PUT /api/me/avatar with the encoded square (`data` is base64). */
export function useSaveAvatar() {
  const store = useStoreMe();
  return useMutation({
    mutationFn: (photo: { type: AvatarType; data: string }) => api.put<Me>('/api/me/avatar', photo),
    onSuccess: store,
  });
}

export function useRemoveAvatar() {
  const store = useStoreMe();
  return useMutation({
    mutationFn: () => api.del<Me>('/api/me/avatar'),
    onSuccess: store,
  });
}
