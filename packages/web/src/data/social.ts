import {
  CATEGORY_CONFIG, findDuplicate, type Category, type Entry, type FriendEntry, type PublicUser, type Relation,
} from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { useToast } from '../design/components/Toast';
import { entriesKey, writeEntry } from './entryCache';
import { entriesQueryOptions } from './useEntries';
import { ME_KEY, normalizeMe, storeMe } from './useMe';

/** Every friends/admin query lives under this key; a mutation here refreshes all of them. */
export const SOCIAL_KEY = ['social'] as const;
const STALE = 30_000;

/** Where username setup returns to after a brand-new user opened a link such as /add/<code> (sessionStorage). */
export const AFTER_SETUP_KEY = 'mt-after-setup';
export const inviteLink = (code: string): string => `${location.origin}/add/${code}`;

export type Friend = PublicUser & { since: string };
export interface FriendsData { friends: Friend[]; incoming: PublicUser[]; outgoing: PublicUser[] }
export interface ProfileData { user: PublicUser; memberSince: string | null; relation: Relation }
export interface FriendEntryData { entry: FriendEntry; seasons: { id: string; label: string; rating: number | null; notes: string | null }[] }
export interface FriendsEntries { userId: string; entries: FriendEntry[] }
export interface AdminData {
  seats: { used: number; total: number };
  invites: { email: string; invitedAt: string; joined: PublicUser | null }[];
  users: (PublicUser & { email: string; joinedAt: string | null })[];
}
export interface ApprovedInvite { email: string; link: string; alreadyAllowed: boolean }

const USERNAME_Q_RE = /^[a-z0-9_]{2,20}$/;

export function useFriends() {
  return useQuery({ queryKey: [...SOCIAL_KEY, 'friends'], queryFn: () => api.get<FriendsData>('/api/friends'), staleTime: STALE });
}

export function useInviteCode(enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...SOCIAL_KEY, 'invite'],
    queryFn: async () => (await api.get<{ code: string }>('/api/me/invite')).code,
    staleTime: Infinity,
  });
}

/** Makes a new invite link; the old one stops working at once. */
export function useRegenerateCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ code: string }>('/api/me/invite')).code,
    onSuccess: (code) => qc.setQueryData([...SOCIAL_KEY, 'invite'], code),
  });
}

/** Search by username prefix (2-20 letters, numbers, _). Disabled for anything else. */
export function useUserSearch(q: string) {
  const query = q.trim().replace(/^@/, '').toLowerCase();
  return useQuery({
    queryKey: [...SOCIAL_KEY, 'search', query],
    queryFn: () => api.get<PublicUser[]>(`/api/users/search?q=${encodeURIComponent(query)}`),
    enabled: USERNAME_Q_RE.test(query),
    staleTime: STALE,
  });
}
export const searchable = (q: string): boolean => USERNAME_Q_RE.test(q.trim().replace(/^@/, '').toLowerCase());

const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: SOCIAL_KEY });

export function useSendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.post<{ relation: Relation }>('/api/friends/requests', { username }),
    onSuccess: () => refresh(qc),
  });
}

export function useAccept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post<void>(`/api/friends/${encodeURIComponent(userId)}/accept`),
    onSuccess: () => refresh(qc),
  });
}

/** Decline, cancel and remove are the same DELETE. */
export function useRemoveFriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.del(`/api/friends/${encodeURIComponent(userId)}`),
    onSuccess: () => refresh(qc),
  });
}

/** Who owns an invite link (404: it no longer works; 400 'self': your own). */
export function useCodeOwner(code: string) {
  return useQuery({
    queryKey: [...SOCIAL_KEY, 'code', code],
    queryFn: () => api.get<PublicUser>(`/api/friends/code/${encodeURIComponent(code)}`),
    retry: false,
    staleTime: STALE,
  });
}

export function useAddByCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<{ relation: Relation; user: PublicUser }>(`/api/friends/add/${encodeURIComponent(code)}`),
    onSuccess: () => refresh(qc),
  });
}

export function useProfile(username: string) {
  return useQuery({
    queryKey: [...SOCIAL_KEY, 'profile', username.toLowerCase()],
    queryFn: () => api.get<ProfileData>(`/api/users/${encodeURIComponent(username)}`),
    staleTime: STALE,
  });
}

/** A friend's visible entries (all categories, or one). */
export function useFriendEntries(username: string, category?: Category, enabled = true) {
  return useQuery({
    queryKey: [...SOCIAL_KEY, 'entries', username.toLowerCase(), category ?? 'all'],
    queryFn: () => api.get<FriendEntry[]>(`/api/users/${encodeURIComponent(username)}/entries${category ? `?category=${category}` : ''}`),
    enabled,
    staleTime: STALE,
  });
}

export function useFriendEntry(username: string, id: string) {
  return useQuery({
    queryKey: [...SOCIAL_KEY, 'entry', username.toLowerCase(), id],
    queryFn: () => api.get<FriendEntryData>(`/api/users/${encodeURIComponent(username)}/entries/${encodeURIComponent(id)}`),
    staleTime: STALE,
  });
}

/** Every accepted friend's rated, visible entries (friends with none are left out by the server). */
export function useFriendsEntries(category?: Category) {
  return useQuery({
    queryKey: [...SOCIAL_KEY, 'friends-entries', category ?? 'all'],
    queryFn: () => api.get<FriendsEntries[]>(`/api/friends/entries${category ? `?category=${category}` : ''}`),
    staleTime: STALE,
  });
}

/** What the server accepts when copying a friend's title to your list (S11): no rating, no notes. */
function addBody(e: FriendEntry) {
  return {
    category: e.category, title: e.title, creator: e.creator, album: e.album, coverUrl: e.coverUrl, genres: e.genres,
    releaseDate: e.releaseDate, synopsis: e.synopsis, lengthLabel: e.lengthLabel, origin: e.origin,
    source: e.source, sourceId: e.sourceId, lookupState: 'ok', detailsState: e.detailsState,
    ...(CATEGORY_CONFIG[e.category].hasStatus ? { status: 'Plan to watch' } : {}),
  };
}

export type AddToMineResult = { entryId: string; duplicate: boolean };

/**
 * Add to mine (S11). A title already on your list answers `duplicate: true` with your entry's id and
 * adds nothing: checked against your list first, and again from the server's `duplicateOf` (then the
 * row it just made is removed).
 */
export function useAddToMine(): (e: FriendEntry) => Promise<AddToMineResult> {
  const qc = useQueryClient();
  return async (e) => {
    try {
      const mine = await qc.fetchQuery({ ...entriesQueryOptions(qc, e.category), staleTime: STALE });
      const dup = findDuplicate(mine, { title: e.title, creator: e.creator }, e.category);
      if (dup) return { entryId: dup, duplicate: true };
    } catch {
      // can't read your list right now: the server's answer below still tells
    }
    const res = await api.post<{ entry: Entry; duplicateOf: string | null }>('/api/entries', addBody(e));
    if (res.duplicateOf) {
      await api.del(`/api/entries/${res.entry.id}`).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: entriesKey(e.category) });
      return { entryId: res.duplicateOf, duplicate: true };
    }
    writeEntry(qc, res.entry);
    return { entryId: res.entry.id, duplicate: false };
  };
}

/** Saves (or clears, with null) your display name. */
export function useSaveDisplayName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string | null) => api.put<Me>('/api/me/display-name', { displayName }),
    onSuccess: async (me) => {
      const prev = qc.getQueryData<Me>(ME_KEY);
      const next = normalizeMe(prev ? { ...prev, displayName: me.displayName } : me);
      qc.setQueryData(ME_KEY, next);
      await storeMe(next);
    },
  });
}

export function useAdmin(enabled = true) {
  return useQuery({ queryKey: [...SOCIAL_KEY, 'admin'], queryFn: () => api.get<AdminData>('/api/admin'), enabled, staleTime: 0 });
}

export function useApproveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.post<ApprovedInvite>('/api/admin/invites', { email }),
    onSuccess: () => refresh(qc),
  });
}

export function useRemoveAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.del<{ removed: boolean }>(`/api/admin/invites/${encodeURIComponent(email)}`),
    onSuccess: () => refresh(qc),
  });
}

/** Copies text; a toast says so. Falls back to a "couldn't copy" toast when the browser refuses. */
export function useCopy() {
  const toast = useToast();
  return async (text: string, done = 'Link copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(done);
    } catch {
      toast.show("Couldn't copy. Select it and copy by hand.");
    }
  };
}
