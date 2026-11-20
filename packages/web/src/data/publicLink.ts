import type { CustomList, FriendEntry, PublicUser } from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { registerLists } from '../lists/registry';

/** GET /api/public/:token (item 34): the read-only header of a public profile link. */
export interface PublicProfileData {
  user: PublicUser;
  memberSince: string | null;
  bio: string | null;
  counts: { titles: number; rated: number };
  /** Their custom lists (names, words, columns); absent from older servers. */
  lists?: CustomList[];
}

const PUBLIC_KEY = ['public'] as const;
const enc = encodeURIComponent;

export function usePublicProfile(token: string) {
  return useQuery({
    queryKey: [...PUBLIC_KEY, token, 'profile'],
    queryFn: async () => {
      const data = await api.get<PublicProfileData>(`/api/public/${enc(token)}`);
      registerLists(data.lists);
      return data;
    },
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Their visible entries, with each cover pointed at the token-scoped proxy (the page loads nothing of
 * theirs except through the link's own routes).
 */
export function usePublicEntries(token: string, enabled = true) {
  return useQuery({
    queryKey: [...PUBLIC_KEY, token, 'entries'],
    queryFn: async () => (await api.get<FriendEntry[]>(`/api/public/${enc(token)}/entries`))
      .map((e) => ({ ...e, coverUrl: e.coverUrl ? publicCoverSrc(token, e.id) : e.coverUrl })),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export const publicCoverSrc = (token: string, entryId: string): string => `/api/public/${enc(token)}/cover/${enc(entryId)}`;
export const publicAvatarSrc = (token: string): string => `/api/public/${enc(token)}/avatar`;

/**
 * Your own link. The server keeps only its hash, so `link` is known only in this session, right after
 * it was made (the POST's answer is written into this query's cache); later it is `{ on: true }`.
 */
export interface MyPublicLink { on: boolean; link?: string }
export const MY_PUBLIC_LINK_KEY = ['me', 'public-link'] as const;

export function useMyPublicLink() {
  return useQuery({
    queryKey: MY_PUBLIC_LINK_KEY,
    queryFn: () => api.get<MyPublicLink>('/api/me/public-link'),
    staleTime: Infinity,
  });
}

/** Turns the link on, or replaces it (the old one stops working). */
export function useMakePublicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ link: string }>('/api/me/public-link'),
    onSuccess: ({ link }) => qc.setQueryData<MyPublicLink>(MY_PUBLIC_LINK_KEY, { on: true, link }),
  });
}

export function useTurnOffPublicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del('/api/me/public-link'),
    onSuccess: () => qc.setQueryData<MyPublicLink>(MY_PUBLIC_LINK_KEY, { on: false }),
  });
}
