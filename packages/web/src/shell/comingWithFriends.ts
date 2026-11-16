import { useCallback } from 'react';
import { useToast } from '../design/components/Toast';

export const COMING_WITH_FRIENDS = 'Coming with friends';

/** The "Add friend" action until Phase 4: it only says friends are on the way. */
export function useAddFriend(): () => void {
  const { show } = useToast();
  return useCallback(() => show(COMING_WITH_FRIENDS), [show]);
}
