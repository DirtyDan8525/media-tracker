/** Phase 6b (P2): this browser's push subscription. Mounted at /api/push. Needs a signed-in user. */
import { Hono } from 'hono';
import type { AppEnv } from '../auth/user';
import { pushConfigured } from '../push/send';

export const push = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
export const PUSH_DEVICES_MAX = 10;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 1000) return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

// 200 { key } when push is set up, 503 { error: 'not_configured' } otherwise (the app shows "Not set up yet").
push.get('/key', (c) => {
  if (!pushConfigured(c.env)) return c.json({ error: 'not_configured' }, 503);
  return c.json({ key: c.env.VAPID_PUBLIC_KEY });
});

// Body: a PushSubscription JSON { endpoint, keys: { p256dh, auth } }. Upsert by endpoint (a device that
// signs in as someone else moves to them); at most PUSH_DEVICES_MAX per user (409 too_many).
push.post('/subscribe', async (c) => {
  if (!pushConfigured(c.env)) return c.json({ error: 'not_configured' }, 503);
  const body = await readJson(c.req.raw);
  const keys = body?.keys;
  const endpoint = httpsUrl(body?.endpoint);
  if (!endpoint || typeof keys !== 'object' || keys === null) return c.json(invalid, 400);
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !B64URL.test(p256dh) || !B64URL.test(auth)
    || p256dh.length < 80 || p256dh.length > 100 || auth.length < 16 || auth.length > 32) return c.json(invalid, 400);
  const me = c.var.user.id;
  const db = c.env.DB;
  const row = await db.prepare(
    `SELECT COUNT(*) AS n, MAX(endpoint = ?2) AS has FROM push_subscriptions WHERE user_id = ?1`,
  ).bind(me, endpoint).first<{ n: number; has: number | null }>();
  if (row?.has !== 1 && (row?.n ?? 0) >= PUSH_DEVICES_MAX) return c.json({ error: 'too_many' }, 409);
  await db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = ?2, p256dh = ?3, auth = ?4`,
  ).bind(endpoint, me, p256dh, auth, new Date().toISOString()).run();
  return c.body(null, 204);
});

// Body: { endpoint }. Only your own device; unknown = already gone (204 either way).
push.post('/unsubscribe', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || typeof body.endpoint !== 'string' || body.endpoint === '' || body.endpoint.length > 1000) return c.json(invalid, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, c.var.user.id).run();
  return c.body(null, 204);
});
