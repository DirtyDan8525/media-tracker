import type { ActivityPage } from '@media-tracker/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export const ACTIVITY_KEY = ['activity'] as const;

type Cursor = NonNullable<ActivityPage['next']>;

/**
 * Your activity, newest first, 50 rows a page (B16). Online only: no on-device copy, and it
 * refetches on every visit (staleTime 0), so no mutation needs to invalidate it.
 */
export function useActivity(enabled = true) {
  return useInfiniteQuery({
    queryKey: ACTIVITY_KEY,
    enabled,
    staleTime: 0,
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam }) =>
      api.get<ActivityPage>(
        pageParam
          ? `/api/activity?before=${encodeURIComponent(pageParam.before)}&beforeId=${encodeURIComponent(pageParam.beforeId)}`
          : '/api/activity',
      ),
    getNextPageParam: (last) => last.next,
  });
}
