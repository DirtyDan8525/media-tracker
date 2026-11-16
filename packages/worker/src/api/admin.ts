import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { ACCESS_SEATS, type PublicUser } from '@media-tracker/shared';
import type { AppEnv } from '../auth/access';
import { allowEmail, CloudflareError, LastRule, NotConfigured, removeEmail } from '../cloudflare/access';
import { ensureInviteCode } from '../social/inviteCode';
import { publicUser, PUBLIC_USER_COLS } from '../social/visibility';

export const admin = new Hono<AppEnv>();

/** Only users.is_admin reaches /api/admin/*. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user').isAdmin) return c.json({ error: 'forbidden' }, 403);
  await next();
};
admin.use('*', requireAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
};

/** Cloudflare failures become 502 { error: 'cloudflare', message }; missing config 503; anything else rethrows. */
function failure(c: { json: (b: unknown, s: 400 | 502 | 503) => Response }, e: unknown): Response {
  if (e instanceof NotConfigured) return c.json({ error: 'not_configured' }, 503);
  if (e instanceof CloudflareError) return c.json({ error: 'cloudflare', message: e.message }, 502);
  if (e instanceof LastRule) return c.json({ error: 'last_rule' }, 400);
  throw e;
}

/** GET /api/admin: 3 queries. */
admin.get('/', async (c) => {
  const db = c.env.DB;
  const [inv, usr, count] = await db.batch([
    db.prepare(
      `SELECT i.email, i.created_at, ${PUBLIC_USER_COLS.split(', ').map((k) => `u.${k} AS u_${k}`).join(', ')}
       FROM invites i LEFT JOIN users u ON u.email = i.email ORDER BY i.created_at DESC`,
    ),
    db.prepare(`SELECT ${PUBLIC_USER_COLS}, email, created_at FROM users WHERE access_removed_at IS NULL ORDER BY created_at`),
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE access_removed_at IS NULL'),
  ]);
  const invites = (inv!.results as Record<string, string | null>[]).map((r) => ({
    email: r.email as string,
    invitedAt: r.created_at as string,
    joined: r.u_id
      ? publicUser({ id: r.u_id, username: r.u_username ?? null, display_name: r.u_display_name ?? null, avatar_at: r.u_avatar_at ?? null })
      : null,
  }));
  const users: (PublicUser & { email: string; joinedAt: string | null })[] = (usr!.results as Record<string, string | null>[]).map((r) => ({
    ...publicUser({ id: r.id as string, username: r.username ?? null, display_name: r.display_name ?? null, avatar_at: r.avatar_at ?? null }),
    email: r.email as string,
    joinedAt: r.created_at ?? null,
  }));
  const used = (count!.results[0] as { n: number }).n;
  return c.json({ seats: { used, total: ACCESS_SEATS }, invites, users });
});

/** POST /api/admin/invites { email }: Cloudflare GET (+PUT), then 2 writes + invite code (<= 4 queries). Nothing is recorded if Cloudflare fails. */
admin.post('/invites', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = cleanEmail((body as { email?: unknown } | null)?.email);
  if (!email) return c.json({ error: 'bad_email' }, 400);
  let added: boolean;
  try {
    ({ added } = await allowEmail(c.env, email));
  } catch (e) {
    return failure(c, e);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO invites (email, created_at) VALUES (?, ?)').bind(email, new Date().toISOString()),
    c.env.DB.prepare('UPDATE users SET access_removed_at = NULL WHERE email = ?').bind(email),
  ]);
  const code = await ensureInviteCode(c.env.DB, c.get('user').id);
  return c.json({ email, link: `${new URL(c.req.url).origin}/add/${code}`, alreadyAllowed: !added });
});

/**
 * DELETE /api/admin/invites/:email: takes the email off the Access policy and deletes its invites row and marks the user removed (2 queries).
 * The person's data is not deleted. Refuses the admin's own email (400 self) and the last include rule (400 last_rule).
 */
admin.delete('/invites/:email', async (c) => {
  const email = cleanEmail(c.req.param('email'));
  if (!email) return c.json({ error: 'bad_email' }, 400);
  if (email === c.get('user').email.trim().toLowerCase()) return c.json({ error: 'self' }, 400);
  let removed: boolean;
  try {
    ({ removed } = await removeEmail(c.env, email));
  } catch (e) {
    return failure(c, e);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM invites WHERE email = ?').bind(email),
    c.env.DB.prepare('UPDATE users SET access_removed_at = ? WHERE email = ?').bind(new Date().toISOString(), email),
  ]);
  return c.json({ removed });
});
