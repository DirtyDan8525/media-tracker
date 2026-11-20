/** What each app event sends (P3, P5). Every helper is fire-and-forget: it queues its work on ctx.waitUntil and never throws. */
import type { MessageKind } from '@media-tracker/shared';
import type { Env } from '../env';
import { clip, notify, pushConfigured, reactionWindowOpen } from './send';

type Ctx = Pick<ExecutionContext, 'waitUntil'>;
interface Who { id: string; username: string | null; displayName: string | null }

const nameOf = (u: { username: string | null; displayName: string | null }) => u.displayName ?? u.username ?? 'Someone';

/** Runs `job` after the response. Without VAPID keys nothing is queued (no queries either). */
const later = (env: Env, ctx: Ctx, job: () => Promise<void>) => {
  if (!pushConfigured(env)) return;
  ctx.waitUntil(job().catch((err) => console.error('push event failed', err)));
};

export function pushNewMessage(env: Env, ctx: Ctx, conversationId: string, sender: Who, kind: MessageKind, text: string): void {
  later(env, ctx, async () => {
    const conv = await env.DB.prepare('SELECT kind, name FROM conversations WHERE id = ?').bind(conversationId).first<{ kind: string; name: string | null }>();
    const { results } = await env.DB.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?').bind(conversationId, sender.id).all<{ user_id: string }>();
    const who = nameOf(sender);
    const title = conv?.kind === 'group' ? `${who} in ${conv.name ?? 'group chat'}` : who;
    const body = kind === 'image' ? 'Sent a photo' : kind === 'voice' ? 'Sent a voice memo' : kind === 'rec' ? (text ? clip(text) : 'Recommended something') : clip(text);
    for (const r of results) notify(env, ctx, r.user_id, 'messages', { title, body, tag: `chat-${conversationId}`, url: `/messages/${conversationId}` });
  });
}

export function pushFriendRequest(env: Env, ctx: Ctx, to: string, from: Who): void {
  notify(env, ctx, to, 'friendRequests', { title: 'Friend request', body: `${nameOf(from)} wants to be friends`, tag: `friend-${from.id}`, url: '/friends' });
}

export function pushFriendAccepted(env: Env, ctx: Ctx, to: string, from: Who): void {
  notify(env, ctx, to, 'friendRequests', { title: 'Friend request accepted', body: `${nameOf(from)} accepted your friend request`, tag: `friend-${from.id}`, url: '/friends' });
}

export function pushComment(env: Env, ctx: Ctx, to: string, from: Who, postId: string, text: string): void {
  if (to === from.id) return;
  notify(env, ctx, to, 'comments', { title: `${nameOf(from)} commented on your post`, body: clip(text), tag: `post-${postId}`, url: '/activity' });
}

/** One push per post per 10 minutes. */
export function pushReaction(env: Env, ctx: Ctx, to: string, from: Who, postId: string, emoji: string): void {
  if (to === from.id) return;
  later(env, ctx, async () => {
    if (!(await reactionWindowOpen(env.DB, postId))) return;
    notify(env, ctx, to, 'reactions', { title: 'New reaction', body: `${nameOf(from)} reacted ${emoji} to your post`, tag: `post-${postId}`, url: '/activity' });
  });
}

/** To every admin: someone signed up and waits for approval. */
export function pushSignup(env: Env, ctx: Ctx, newUser: Who): void {
  later(env, ctx, async () => {
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE status = 'active' AND (is_admin = 1 OR (?1 <> '' AND lower(email) = lower(?1)))`,
    ).bind((env.ADMIN_EMAIL ?? '').trim()).all<{ id: string }>();
    for (const r of results) {
      notify(env, ctx, r.id, 'signups', { title: 'New sign-up waiting', body: `${nameOf(newUser)} is waiting for approval`, tag: 'signup', url: '/admin' });
    }
  });
}
