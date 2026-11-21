import type { CustomList, FriendEntry, PublicUser } from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { registerLists } from '../lists/registry';
import { useAppName } from './appSettings';
import { useCopy } from './social';

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
 * Your own link. The server stores the link (since migration 0024), so `link` is there whenever the link is on.
 * `legacy`: it was made before that and has no stored token: it still works but cannot be shown or shared;
 * make a new one (`link: null`).
 */
export interface MyPublicLink { on: boolean; link?: string | null; legacy?: boolean }
export const MY_PUBLIC_LINK_KEY = ['me', 'public-link'] as const;
const fetchMyPublicLink = () => api.get<MyPublicLink>('/api/me/public-link');

export function useMyPublicLink() {
  return useQuery({
    queryKey: MY_PUBLIC_LINK_KEY,
    queryFn: fetchMyPublicLink,
    staleTime: Infinity,
  });
}

/** Always asks the server (the link may have changed on another device) and returns the current state. */
export function useFreshPublicLink() {
  const qc = useQueryClient();
  return () => qc.fetchQuery({ queryKey: MY_PUBLIC_LINK_KEY, queryFn: fetchMyPublicLink, staleTime: 0 });
}

/** "Share" for a link: the device's share sheet when it has one, else copy with the toast "Link copied". */
export function useShareLink() {
  const copy = useCopy();
  const appName = useAppName();
  return async (url: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try { await navigator.share({ title: appName, text: `My lists on ${appName}`, url }); } catch { /* cancelled */ }
      return;
    }
    await copy(url);
  };
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
