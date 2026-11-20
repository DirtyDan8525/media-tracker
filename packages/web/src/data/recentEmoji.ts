import { withRecentEmoji } from '@media-tracker/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Me } from '../api/types';
import { ME_KEY, storeMe } from './useMe';

/**
 * Your "Recent" custom emoji (newest first, at most 4, none from the quick set). The server records them with each reaction
 * (activity and chats) and returns them with /api/me; `useNoteRecentEmoji` updates the cached copy at once so the row is
 * right before the next /api/me.
 */
export function useNoteRecentEmoji(): (emoji: string) => void {
  const qc = useQueryClient();
  return useCallback((emoji: string) => {
    const prev = qc.getQueryData<Me>(ME_KEY);
    if (!prev) return;
    const list = prev.recentEmoji ?? [];
    const next = withRecentEmoji(list, emoji);
    if (next.join() === list.join()) return;
    const me = { ...prev, recentEmoji: next };
    qc.setQueryData(ME_KEY, me);
    void storeMe(me);
  }, [qc]);
}
