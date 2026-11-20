import type { Conversation, ConversationSummary, Message, PublicUser, RecSnapshot } from '@media-tracker/shared';
import type { Handler, MockResponse } from './mockApi';

export const ME: PublicUser = { id: 'u1', username: 'dan', displayName: null, avatarAt: null };
export const REN_U: PublicUser = { id: 'id-ren', username: 'ren', displayName: 'Ren', avatarAt: null };
export const ALBERTO: PublicUser = { id: 'id-alb', username: 'alberto', displayName: null, avatarAt: null };
export const VANCE: PublicUser = { id: 'id-van', username: 'vance', displayName: 'Vance', avatarAt: null };

let n = 0;
export function makeMessage(over: Partial<Message> = {}): Message {
  n++;
  return {
    id: `m${n}`, conversationId: 'c1', senderId: REN_U.id, kind: 'text', text: `hello ${n}`, rec: null, image: false, deleted: false, replyTo: null,
    createdAt: new Date(Date.now() - (1000 - n) * 60_000).toISOString(), ...over,
  };
}

export const FRIEREN_REC: RecSnapshot = { category: 'anime', title: 'Frieren', creator: 'Madhouse', coverUrl: '', rating: 9, source: null, sourceId: null };

export function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return { id: 'c1', kind: 'direct', name: null, createdBy: ME.id, createdAt: '2026-11-01T00:00:00Z', members: [ME, REN_U], readOnly: false, ...over };
}

export function makeSummary(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return { ...makeConversation(), last: null, lastMessageAt: '2026-11-01T00:00:00Z', unread: false, ...over };
}

/**
 * An in-memory stand-in for the Worker's conversations and messages routes (docs/plans/2026-11-17-phase6-messages.md).
 * `messages` are oldest first here; the page answer is newest first like the real one.
 */
export function messagesBackend(opts: { conversations?: Conversation[]; messages?: Record<string, Message[]>; recommended?: { message: Message; sender: PublicUser; unread?: boolean }[]; sendFail?: MockResponse } = {}) {
  const conversations = [...(opts.conversations ?? [makeConversation()])];
  const messages: Record<string, Message[]> = { ...(opts.messages ?? {}) };
  const state = { recommended: (opts.recommended ?? []).map((r) => ({ unread: true, ...r })), sendFail: opts.sendFail, readOnly: false, unread: 0, pageSize: 50 };
  const find = (id: string) => conversations.find((c) => c.id === id);
  const notFound = { status: 404, body: { error: 'not_found' } } as const;
  const handlers: Record<string, Handler | MockResponse> = {
    'GET /api/activity/unread': () => ({ body: { feed: 0, requests: 0, messages: state.unread } }),
    'GET /api/conversations': () => ({
      body: {
        conversations: conversations.map((c): ConversationSummary => {
          const list = messages[c.id] ?? [];
          const last = list[list.length - 1];
          return {
            ...c, lastMessageAt: last?.createdAt ?? c.createdAt, unread: false,
            last: last ? { kind: last.kind, text: last.text.slice(0, 80), ...(last.kind === 'rec' ? { recTitle: last.rec?.title ?? null } : {}), senderId: last.senderId, deleted: last.deleted, createdAt: last.createdAt } : null,
          };
        }),
      },
    }),
    'GET /api/conversations/:id': (_b, _u, p) => (find(p.id!) ? { body: find(p.id!) } : notFound),
    'GET /api/conversations/:id/messages': (_b, url, p) => {
      if (!find(p.id!)) return notFound;
      const all = [...(messages[p.id!] ?? [])].reverse();
      const before = url.searchParams.get('before');
      // Like the Worker: the first page marks the chat read.
      if (!before) state.unread = 0;
      const start = before ? all.findIndex((m) => m.id === before) + 1 : 0;
      const page = all.slice(start, start + state.pageSize);
      const next = start + state.pageSize < all.length ? page[page.length - 1]!.id : null;
      const users = Object.fromEntries(find(p.id!)!.members.map((u) => [u.id, u]));
      return { body: { messages: page, users, next, readOnly: state.readOnly } };
    },
    'POST /api/conversations/:id/messages': (b, _u, p) => {
      if (state.sendFail) return state.sendFail;
      const body = b as { text?: string; rec?: RecSnapshot; replyTo?: string };
      const orig = body.replyTo ? (messages[p.id!] ?? []).find((x) => x.id === body.replyTo) : undefined;
      if (body.replyTo && (!orig || orig.deleted)) return { status: 400, body: { error: 'invalid_reply' } };
      const sender = orig && [ME, REN_U, ALBERTO, VANCE].find((u) => u.id === orig.senderId);
      const replyTo = orig ? { id: orig.id, senderId: orig.senderId, senderName: sender?.displayName || `@${sender?.username}`, kind: orig.kind, snippet: orig.kind === 'rec' ? orig.rec?.title ?? '' : orig.text.slice(0, 100), deleted: false } : null;
      const m = makeMessage({ conversationId: p.id!, senderId: ME.id, kind: body.rec ? 'rec' : 'text', text: body.text ?? '', rec: body.rec ?? null, replyTo, createdAt: new Date().toISOString() });
      (messages[p.id!] ??= []).push(m);
      return { status: 201, body: m };
    },
    'DELETE /api/messages/:id': (_b, _u, p) => {
      for (const list of Object.values(messages)) {
        const m = list.find((x) => x.id === p.id);
        if (m) { m.deleted = true; m.text = ''; m.rec = null; m.image = false; return { status: 204 }; }
      }
      return notFound;
    },
    'GET /api/messages/recommended': () => ({ body: { items: state.recommended } }),
    'POST /api/conversations': (b) => {
      const { userIds, name } = b as { userIds: string[]; name?: string };
      if (userIds.length === 1) {
        const hit = conversations.find((c) => c.kind === 'direct' && c.members.some((m) => m.id === userIds[0]));
        if (hit) return { status: 200, body: hit };
      }
      const all = [ME, REN_U, ALBERTO, VANCE];
      const c = makeConversation({ id: `c${conversations.length + 1}`, kind: userIds.length === 1 ? 'direct' : 'group', name: name ?? null, members: [ME, ...userIds.map((id) => all.find((u) => u.id === id)!)] });
      conversations.push(c);
      return { status: 201, body: c };
    },
    'PATCH /api/conversations/:id': (b, _u, p) => { const c = find(p.id!)!; c.name = (b as { name: string }).name || null; return { body: c }; },
    'POST /api/conversations/:id/members': (b, _u, p) => {
      const c = find(p.id!)!;
      const all = [ME, REN_U, ALBERTO, VANCE];
      for (const id of (b as { userIds: string[] }).userIds) if (!c.members.some((m) => m.id === id)) c.members.push(all.find((u) => u.id === id)!);
      return { body: c };
    },
    'DELETE /api/conversations/:id/members/me': (_b, _u, p) => { conversations.splice(conversations.findIndex((c) => c.id === p.id), 1); return { status: 204 }; },
  };
  return { handlers, conversations, messages, state };
}
