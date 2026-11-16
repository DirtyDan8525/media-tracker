/**
 * /api/admin/* (Phase 4b, A7): Dan approves sign-ups, declines them, removes and restores people,
 * and makes password-reset links. Only the admin reaches these routes.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { PublicUser } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { publicUser, PUBLIC_USER_COLS, type PublicUserRow } from '../social/visibility';
import { createResetLink, createSignupLink } from './auth';

export const admin = new Hono<AppEnv>();

/** Only the admin (users.is_admin, or the ADMIN_EMAIL row) reaches /api/admin/*. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user').isAdmin) return c.json({ error: 'forbidden' }, 403);
  await next();
};
admin.use('*', requireAdmin);

const notFound = { error: 'not_found' } as const;

export interface AdminLists {
  pending: (PublicUser & { requestedAt: string })[];
  active: (PublicUser & { joinedAt: string | null; isAdmin: boolean })[];
  removed: PublicUser[];
}

// GET /api/admin: 1 query (+ sign-in). Pending oldest first (the order they asked), the rest by join date.
admin.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLS}, status, is_admin, email, created_at FROM users ORDER BY created_at, id`,
  ).all<PublicUserRow & { status: string; is_admin: number; email: string; created_at: string | null }>();
  const adminEmail = (c.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const body: AdminLists = { pending: [], active: [], removed: [] };
  for (const r of results) {
    const u = publicUser(r);
    if (r.status === 'pending') body.pending.push({ ...u, requestedAt: r.created_at ?? '' });
    else if (r.status === 'removed') body.removed.push(u);
    else body.active.push({ ...u, joinedAt: r.created_at, isAdmin: r.is_admin === 1 || (adminEmail !== '' && r.email.toLowerCase() === adminEmail) });
  }
  return c.json(body);
});

// POST /api/admin/users/:id/approve: pending or removed -> active. 1 query (+ sign-in). 404 otherwise.
admin.post('/users/:id/approve', async (c) => {
  const res = await c.env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status IN ('pending', 'removed')")
    .bind(c.req.param('id'))
    .run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/decline: deletes a pending sign-up (sessions go with it). 1 query (+ sign-in).
admin.post('/users/:id/decline', async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").bind(c.req.param('id')).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/remove: active -> removed and every session deleted; data stays. Never yourself.
// 2 queries (+ sign-in).
admin.post('/users/:id/remove', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'self' }, 400);
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ? AND status = 'active'").bind(id),
    // Only when the row really is removed now (a pending person keeps their session).
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND (SELECT status FROM users WHERE id = ?1) = 'removed'").bind(id),
  ]);
  return res!.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/reset-link -> { link }: one-time, 24 h, replaces any earlier link. 2 queries (+ sign-in).
admin.post('/users/:id/reset-link', async (c) => {
  const link = await createResetLink(c.env.DB, c.req.param('id'), new URL(c.req.url).origin);
  return link ? c.json({ link }) : c.json(notFound, 404);
});

// POST /api/admin/users/:id/delete: deletes the person and, by cascade, everything of theirs (lists,
// sessions, friendships, activity). Never yourself. 1 query (+ sign-in).
admin.post('/users/:id/delete', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'self' }, 400);
  const res = await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

export type SignupLinkStatus = 'unused' | 'used' | 'expired' | 'revoked';
export interface SignupLinkItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: SignupLinkStatus;
  usedBy: string | null;
  usedAt: string | null;
}

// POST /api/admin/signup-links -> { link, expiresAt, id }: single use, 7 days. 1 query (+ sign-in).
admin.post('/signup-links', async (c) => c.json(await createSignupLink(c.env.DB, c.get('user').id, new URL(c.req.url).origin)));

// GET /api/admin/signup-links -> { links }: the last 50, newest first. Never the token (only its hash is stored). 1 query (+ sign-in).
admin.get('/signup-links', async (c) => {
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.created_at, l.expires_at, l.used_at, l.revoked_at, u.username AS used_by
       FROM signup_links l LEFT JOIN users u ON u.id = l.used_by ORDER BY l.created_at DESC, l.id LIMIT 50`,
  ).all<{ id: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null; used_by: string | null }>();
  const links: SignupLinkItem[] = results.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.used_at ? 'used' : r.revoked_at ? 'revoked' : Date.parse(r.expires_at) > now ? 'unused' : 'expired',
    usedBy: r.used_by,
    usedAt: r.used_at,
  }));
  return c.json({ links });
});

// DELETE /api/admin/signup-links/:id: revokes an unused, unexpired link (404 otherwise). 1 query (+ sign-in).
admin.delete('/signup-links/:id', async (c) => {
  const res = await c.env.DB.prepare(
    'UPDATE signup_links SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1',
  ).bind(new Date().toISOString(), c.req.param('id')).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});
