/**
 * Phase 6b web push (docs/plans/2026-11-17-phase6b-notifications.md, P1-P5). `notify` is the one way the
 * app sends a push: it checks the recipient's switch for the type, loads their devices, sends to each,
 * drops devices the push service says are gone (404/410) and ignores every other failure. No-op without VAPID keys.
 */
import { buildPushHTTPRequest } from '@pushforge/builder';
import { readSettings } from '../auth/user';
import type { Env } from '../env';

export type NotifyType = 'messages' | 'friendRequests' | 'comments' | 'reactions';

export interface PushPayload {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag. */
  tag: string;
  /** App path the click opens, e.g. /messages/abc. */
  url: string;
}

export const MESSAGE_PREVIEW_MAX = 120;
export const pushConfigured = (env: Env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

/** At most `max` characters (by code point), with an ellipsis when cut. */
export const clip = (text: string, max = MESSAGE_PREVIEW_MAX) => {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
};

interface SubRow { endpoint: string; p256dh: string; auth: string }

async function deliver(env: Env, userId: string, type: NotifyType, payload: PushPayload): Promise<void> {
  const user = await env.DB.prepare('SELECT settings_json, (SELECT value_json FROM app_settings WHERE key = \'defaults\') AS app_defaults FROM users WHERE id = ? AND status = \'active\'')
    .bind(userId).first<{ settings_json: string; app_defaults: string | null }>();
  if (!user || readSettings(user.settings_json, user.app_defaults).settings.notify[type] === false) return;
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(userId).all<SubRow>();
  if (results.length === 0) return;
  const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY!) as JsonWebKey;
  await Promise.all(results.map(async (s) => {
    try {
      const req = await buildPushHTTPRequest({
        privateJWK,
        subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message: { payload: { ...payload }, adminContact: env.VAPID_SUBJECT!, options: { urgency: 'normal' } },
      });
      const res = await fetch(req.endpoint, { method: 'POST', headers: req.headers, body: req.body });
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
      } else if (res.ok) {
        await env.DB.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?').bind(new Date().toISOString(), s.endpoint).run();
      }
    } catch {
      // A bad key, a network error or a throttled push service: skip this device.
    }
  }));
}

/** Sends after the response (ctx.waitUntil); never throws, never blocks the request. */
export function notify(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, userId: string, type: NotifyType, payload: PushPayload): void {
  if (!pushConfigured(env)) return;
  ctx.waitUntil(deliver(env, userId, type, payload).catch((err) => console.error('push failed', err)));
}

/**
 * Reaction throttle (P3): true when this post has not had a reaction push in the last 10 minutes, and records
 * this one. 1 query (an upsert that only takes the row when the old time is past the window).
 */
export async function reactionWindowOpen(db: D1Database, postId: string, now = Date.now()): Promise<boolean> {
  const res = await db.prepare(
    `INSERT INTO push_throttle (key, sent_at) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET sent_at = ?2 WHERE push_throttle.sent_at < ?3`,
  ).bind(`reaction:${postId}`, new Date(now).toISOString(), new Date(now - 10 * 60_000).toISOString()).run();
  return (res.meta.changes ?? 0) > 0;
}

type Ctx = Pick<ExecutionContext, 'waitUntil'>;
/** The request's execution context; a caller without one (app.fetch(req, env) in tests) gets a fire-and-forget stand-in. */
export function ctxOf(c: { executionCtx: Ctx }): Ctx {
  try {
    return c.executionCtx;
  } catch {
    return { waitUntil: (p) => void Promise.resolve(p).catch(() => undefined) };
  }
}
