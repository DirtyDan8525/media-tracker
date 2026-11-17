import {
  type Conversation, type ConversationList, type ConversationSummary, type Message, type MessagePage, type PublicUser, type RecommendedItem,
  type RecSnapshot,
} from '@media-tracker/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import { UNREAD_KEY } from './feed';
import type { FriendEntry } from '@media-tracker/shared';

/** Phase 6 (docs/plans/2026-11-17-phase6-messages.md): chats, groups, pictures and recommendations. */
export const MESSAGES_KEY = ['messages'] as const;
/** M4: an open chat checks every 5 s while the page is visible; the list every 30 s and on focus. */
export const CHAT_POLL_MS = 5_000;
export const LIST_POLL_MS = 30_000;

const listKey = [...MESSAGES_KEY, 'list'] as const;
const convKey = (id: string) => [...MESSAGES_KEY, 'conversation', id] as const;
const chatKey = (id: string) => [...MESSAGES_KEY, 'chat', id] as const;
const recommendedKey = [...MESSAGES_KEY, 'recommended'] as const;

export const messageImageUrl = (id: string): string => `/api/messages/${encodeURIComponent(id)}/image`;

export function useConversations() {
  return useQuery({
    queryKey: listKey,
    queryFn: async () => (await api.get<ConversationList>('/api/conversations')).conversations,
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    staleTime: 0,
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: convKey(id),
    queryFn: () => api.get<Conversation>(`/api/conversations/${encodeURIComponent(id)}`),
    retry: false,
    staleTime: 15_000,
  });
}

/** What the chat screen shows: every loaded message oldest first, who sent them, and paging. */
export interface Chat {
  messages: Message[];
  users: Record<string, PublicUser>;
  readOnly: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
}

/**
 * The newest page, polled every 5 s while the page is visible (the first page also marks the chat read, so the
 * unread badge refreshes whenever something new arrives). Older pages load on demand and are kept apart from the poll.
 */
export function useChat(id: string): { query: ReturnType<typeof useChatPage>; chat: Chat | null } {
  const qc = useQueryClient();
  const query = useChatPage(id);
  const [older, setOlder] = useState<{ messages: Message[]; users: Record<string, PublicUser>; next: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => setOlder(null), [id]);

  const newest = query.data?.messages[0]?.id;
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!newest || newest === seen.current) return;
    seen.current = newest;
    // The server marked it read: the badge and the list's dot are out of date.
    void qc.invalidateQueries({ queryKey: UNREAD_KEY });
    void qc.invalidateQueries({ queryKey: listKey });
  }, [newest, qc]);

  const page = query.data;
  const cursor = older ? older.next : page?.next ?? null;
  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const p = await api.get<MessagePage>(`/api/conversations/${encodeURIComponent(id)}/messages?before=${encodeURIComponent(cursor)}`);
      setOlder((o) => ({ messages: [...(o?.messages ?? []), ...p.messages], users: { ...o?.users, ...p.users }, next: p.next }));
    } finally {
      setLoadingOlder(false);
    }
  }, [cursor, id, loadingOlder]);

  if (!page) return { query, chat: null };
  const all = [...page.messages];
  const have = new Set(all.map((m) => m.id));
  for (const m of older?.messages ?? []) if (!have.has(m.id)) all.push(m);
  // The server answers newest first; the chat reads oldest first.
  const messages = all.reverse();
  return {
    query,
    chat: { messages, users: { ...older?.users, ...page.users }, readOnly: page.readOnly, hasOlder: cursor !== null, loadingOlder, loadOlder },
  };
}

function useChatPage(id: string) {
  return useQuery({
    queryKey: chatKey(id),
    queryFn: () => api.get<MessagePage>(`/api/conversations/${encodeURIComponent(id)}/messages`),
    refetchInterval: CHAT_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  });
}

/** Puts a message you just sent at the head of the newest page (a poll that already has it is not doubled). */
function addToChat(qc: QueryClient, m: Message): void {
  qc.setQueryData<MessagePage>(chatKey(m.conversationId), (old) => (old && !old.messages.some((x) => x.id === m.id) ? { ...old, messages: [m, ...old.messages] } : old));
  void qc.invalidateQueries({ queryKey: listKey });
}

export function useSendText(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.post<Message>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, { text }),
    onSuccess: (m) => addToChat(qc, m),
  });
}

/** A recommendation (the title's snapshot) with an optional note; to one chat. */
export function useSendRec(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rec, text }: { rec: RecSnapshot; text?: string }) =>
      api.post<Message>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, { rec, ...(text ? { text } : {}) }),
    onSuccess: (m) => addToChat(qc, m),
  });
}

/** A picture (already resized): the raw bytes with their content type. */
export function useSendImage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages/image`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob,
      });
      const text = await res.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
      if (!res.ok) {
        const code = typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `http_${res.status}`;
        throw new ApiError(res.status, code, data);
      }
      return data as Message;
    },
    onSuccess: (m) => addToChat(qc, m),
  });
}

/** What to tell someone when a send failed. */
export function sendErrorText(e: unknown, what: 'message' | 'picture' = 'message'): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "You're sending too fast. Wait a minute and try again.";
    if (e.status === 503) return 'Pictures need setup.';
    if (e.status === 403) return "You can't message them any more.";
    if (e.status === 413 || e.status === 415) return "That picture can't be sent.";
  }
  return what === 'picture' ? "Couldn't send the picture. Try again." : "Couldn't send. Try again.";
}

/** Deletes your own message (soft: the chat shows "Message deleted"). */
export function useDeleteMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/messages/${encodeURIComponent(id)}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<MessagePage>(chatKey(conversationId), (old) =>
        old && { ...old, messages: old.messages.map((m) => (m.id === id ? { ...m, deleted: true, text: '', rec: null, image: false } : m)) });
      void qc.invalidateQueries({ queryKey: [...MESSAGES_KEY, 'recommended'] });
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

/** One friend: opens (or finds) the direct chat. 2-19 friends: a group, with an optional name. */
export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, name }: { userIds: string[]; name?: string }) =>
      api.post<Conversation>('/api/conversations', { userIds, ...(name ? { name } : {}) }),
    onSuccess: (c) => {
      qc.setQueryData(convKey(c.id), c);
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

function useConversationEdit<V>(id: string, run: (v: V) => Promise<Conversation>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (c) => {
      qc.setQueryData(convKey(id), c);
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useRenameConversation(id: string) {
  return useConversationEdit(id, (name: string) => api.patch<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { name }));
}

export function useAddMembers(id: string) {
  return useConversationEdit(id, (userIds: string[]) => api.post<Conversation>(`/api/conversations/${encodeURIComponent(id)}/members`, { userIds }));
}

export function useLeaveConversation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/api/conversations/${encodeURIComponent(id)}/members/me`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: convKey(id) });
      qc.removeQueries({ queryKey: chatKey(id) });
      qc.setQueryData<ConversationSummary[]>(listKey, (old) => old?.filter((c) => c.id !== id));
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });
}

/** Recs sent to you, newest first. */
export function useRecommended() {
  return useQuery({
    queryKey: recommendedKey,
    queryFn: async () => (await api.get<{ items: RecommendedItem[] }>('/api/messages/recommended')).items,
    refetchOnMount: 'always',
    staleTime: 0,
  });
}

/** The chat's name in the list and the header: a group's name, else its members' names; a direct chat is the other person. */
export function conversationTitle(c: Pick<Conversation, 'kind' | 'name' | 'members'>, meId: string): string {
  const others = c.members.filter((m) => m.id !== meId);
  const name = (u: PublicUser) => u.displayName || `@${u.username}`;
  if (c.kind === 'direct') return others[0] ? name(others[0]) : 'Chat';
  return c.name || others.map(name).join(', ') || 'Group';
}

/** A title's snapshot for a recommendation (M7). */
export function recFromEntry(e: { category: RecSnapshot['category']; title: string; creator: string | null; coverUrl: string; rating: number | null; source: RecSnapshot['source']; sourceId: string | null }): RecSnapshot {
  return { category: e.category, title: e.title, creator: e.creator || null, coverUrl: e.coverUrl, rating: e.rating, source: e.source, sourceId: e.sourceId };
}

export interface ShareResult { sent: number; failed: number; rateLimited: boolean }

/**
 * Share a title (M7): to each friend's direct chat (opened or found first) and each group, one message each, with an
 * optional note. Failures do not stop the rest; the result counts them.
 */
export function useShareRec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ friendIds, groupIds, rec, text }: { friendIds: string[]; groupIds: string[]; rec: RecSnapshot; text: string }): Promise<ShareResult> => {
      const out: ShareResult = { sent: 0, failed: 0, rateLimited: false };
      const body = { rec, ...(text ? { text } : {}) };
      const send = async (conversationId: string) => {
        try {
          const m = await api.post<Message>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, body);
          addToChat(qc, m);
          out.sent++;
        } catch (e) {
          out.failed++;
          if (e instanceof ApiError && e.status === 429) out.rateLimited = true;
        }
      };
      for (const id of friendIds) {
        try {
          const c = await api.post<Conversation>('/api/conversations', { userIds: [id] });
          await send(c.id);
        } catch {
          out.failed++;
        }
      }
      for (const id of groupIds) await send(id);
      void qc.invalidateQueries({ queryKey: listKey });
      return out;
    },
  });
}
