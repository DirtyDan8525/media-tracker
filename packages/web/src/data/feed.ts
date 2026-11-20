import {
  type ActivityPage, type Comment, type FeedScope, type PostSocial, type PublicUser, type Reaction, type Target,
} from '@media-tracker/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';
import { registerLists } from '../lists/registry';
import { useToast } from '../design/components/Toast';

export const ACTIVITY_KEY = ['activity'] as const;
export const UNREAD_KEY = ['activity-unread'] as const;
type Cursor = NonNullable<ActivityPage['next']>;

/** A target's stable key (one of activityId / entryId). */
export const targetKey = (t: Target): string => ('activityId' in t ? `a:${t.activityId}` : `e:${t.entryId}`);
const targetQuery = (t: Target): string =>
  'activityId' in t ? `activityId=${encodeURIComponent(t.activityId)}` : `entryId=${encodeURIComponent(t.entryId)}`;

const EMPTY_SOCIAL: PostSocial = { reactions: {}, mine: [], comments: 0 };

/** S6: 30 posts a page for one scope, newest first. Online only; refetches on every visit. */
/** Discover filters on the feed (2026-11-20): one list and/or a minimum rating; both optional. */
export interface FeedFilters { list?: string | null; min?: number | null }

export function useFeed(scope: FeedScope, filters: FeedFilters = {}) {
  const list = filters.list ?? null;
  const min = filters.min ?? null;
  const extra = `${list ? `&list=${encodeURIComponent(list)}` : ''}${min !== null ? `&min=${min}` : ''}`;
  return useInfiniteQuery({
    queryKey: [...ACTIVITY_KEY, scope, list, min],
    staleTime: 0,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }) => {
      const page = await api.get<ActivityPage>(
        pageParam
          ? `/api/activity?show=${scope}${extra}&before=${encodeURIComponent(pageParam.before)}&beforeId=${encodeURIComponent(pageParam.beforeId)}`
          : `/api/activity?show=${scope}${extra}`,
      );
      // Custom lists these posts sit on (names, words), before the posts render.
      registerLists(page.lists);
      return page;
    },
    getNextPageParam: (last) => last.next,
  });
}

/** The badge counts: `messages` is the number of conversations with something new (Phase 6; absent from an older Worker). */
export interface Unread { feed: number; requests: number; messages?: number }

/** S8: the badge counts. Refetches on window focus and every minute while visible. */
export function useUnread() {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => api.get<Unread>('/api/activity/unread'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

/** Marks the feed seen and zeroes the badge at once. */
export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/api/activity/seen'),
    onSuccess: () => qc.setQueryData<Unread>(UNREAD_KEY, (old) => (old ? { ...old, feed: 0 } : old)),
  });
}

/** Reactions and the comment count of an entry's own thread (EntryDetail, FriendEntryDetail). */
export function useEntrySocial(entryId: string) {
  return useQuery({
    queryKey: ['entry-social', entryId],
    queryFn: () => api.get<PostSocial>(`/api/reactions?entryId=${encodeURIComponent(entryId)}`),
    staleTime: 30_000,
  });
}

export function useComments(target: Target | null) {
  return useQuery({
    queryKey: ['comments', target ? targetKey(target) : null],
    enabled: target !== null,
    queryFn: () => api.get<Comment[]>(`/api/comments?${targetQuery(target!)}`),
  });
}

export interface ReactionGroup { emoji: string; users: PublicUser[] }

/** Who reacted, per emoji (most first). Only fetched while `target` is given (the sheet is open). */
export function useReactionsWho(target: Target | null) {
  return useQuery({
    queryKey: ['reactions-who', target ? targetKey(target) : null],
    enabled: target !== null,
    queryFn: () => api.get<ReactionGroup[]>(`/api/reactions/who?${targetQuery(target!)}`),
    gcTime: 0,
  });
}

/** Applies `fn` to the social summary of `target` wherever it is cached (every feed scope, the entry query). */
function patchSocial(qc: QueryClient, target: Target, fn: (s: PostSocial) => PostSocial): void {
  if ('activityId' in target) {
    qc.setQueriesData<InfiniteData<ActivityPage>>({ queryKey: ACTIVITY_KEY }, (data) => {
      if (!data?.pages.some((p) => p.social[target.activityId] !== undefined || p.items.some((i) => i.postId === target.activityId))) return data;
      return {
        ...data,
        pages: data.pages.map((p) => ({ ...p, social: { ...p.social, [target.activityId]: fn(p.social[target.activityId] ?? EMPTY_SOCIAL) } })),
      };
    });
  } else {
    qc.setQueryData<PostSocial>(['entry-social', target.entryId], (old) => fn(old ?? EMPTY_SOCIAL));
  }
}

/** Sets the social summary of `target` to the server's answer. */
function setSocial(qc: QueryClient, target: Target, value: PostSocial): void {
  patchSocial(qc, target, () => value);
}

export function toggleReaction(s: PostSocial, emoji: Reaction): PostSocial {
  const on = s.mine.includes(emoji);
  const count = Math.max(0, (s.reactions[emoji] ?? 0) + (on ? -1 : 1));
  const reactions = { ...s.reactions };
  if (count === 0) delete reactions[emoji];
  else reactions[emoji] = count;
  return { ...s, reactions, mine: on ? s.mine.filter((m) => m !== emoji) : [...s.mine, emoji] };
}

/** Toggles a reaction: the count and aria-pressed change at once, roll back with a toast on error. */
export function useReact() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ target, emoji }: { target: Target; emoji: Reaction }) =>
      api.post<PostSocial>('/api/reactions', { ...target, emoji }),
    onMutate: async ({ target, emoji }) => {
      await qc.cancelQueries({ queryKey: ACTIVITY_KEY });
      const snapshot = qc.getQueriesData<InfiniteData<ActivityPage>>({ queryKey: ACTIVITY_KEY });
      const entry = 'entryId' in target ? qc.getQueryData<PostSocial>(['entry-social', target.entryId]) : undefined;
      patchSocial(qc, target, (s) => toggleReaction(s, emoji));
      return { snapshot, entry };
    },
    onError: (_e, { target }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if ('entryId' in target) qc.setQueryData(['entry-social', target.entryId], ctx?.entry);
      toast.show("Couldn't save your reaction. Try again.");
    },
    onSuccess: (social, { target }) => setSocial(qc, target, social),
  });
}

export function usePostComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, body }: { target: Target; body: string }) => api.post<Comment>('/api/comments', { ...target, body }),
    onSuccess: (comment, { target }) => {
      qc.setQueryData<Comment[]>(['comments', targetKey(target)], (old) => (old ? [...old, comment] : [comment]));
      patchSocial(qc, target, (s) => ({ ...s, comments: s.comments + 1 }));
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { target: Target; id: string }) => api.del(`/api/comments/${encodeURIComponent(id)}`),
    onSuccess: (_r, { target, id }) => {
      qc.setQueryData<Comment[]>(['comments', targetKey(target)], (old) => old?.filter((c) => c.id !== id));
      patchSocial(qc, target, (s) => ({ ...s, comments: Math.max(0, s.comments - 1) }));
    },
  });
}

/** Drops the posts `ids` (anchor ids) from every cached feed scope. */
function removePosts(qc: QueryClient, ids: string[]): void {
  const gone = new Set(ids);
  qc.setQueriesData<InfiniteData<ActivityPage>>({ queryKey: ACTIVITY_KEY }, (data) =>
    data && { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((i) => !gone.has(i.postId)) })) });
}

/**
 * Deletes your own posts (the entries stay): one post with `DELETE /api/activity/:id`, a selection
 * (`batch`) with `POST /api/activity/delete`. A post that is already gone (404) counts as deleted.
 */
export function useDeletePosts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, batch }: { ids: string[]; batch: boolean }) => {
      if (batch) await api.post<{ deleted: number }>('/api/activity/delete', { postIds: ids });
      else {
        try {
          await api.del(`/api/activity/${encodeURIComponent(ids[0]!)}`);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
    },
    onSuccess: (_r, { ids }) => removePosts(qc, ids),
  });
}
