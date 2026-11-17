import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256Hex } from '../src/auth/session';
import { spyD1 } from './d1spy';

// A7: Dan approves, declines, removes and restores people, and makes reset links.
const ADMIN = 'dan@x.com';
const PW = 'correct horse';

/** As the admin (DEV_EMAIL bypass). */
const asAdmin = (path: string, method = 'GET', db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: ADMIN, ADMIN_EMAIL: ADMIN } as Env,
  );
/** With a session cookie (no bypass). */
const asCookie = (token: string | null, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { cookie: `mt_session=${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    }),
    { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined, ADMIN_EMAIL: ADMIN } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const cookieOf = (res: Response) => /mt_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;
const signup = async (username: string) => {
  const res = await asCookie(null, '/api/auth/signup', 'POST', { username, password: PW });
  expect(res.status).toBe(201);
  const me = await json<{ id: string }>(res);
  return { id: me.id, token: cookieOf(res)! };
};
const statusOf = async (id: string) => (await env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(id).first<{ status: string }>())?.status ?? null;
const sessionsOf = async (id: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(id).first<{ n: number }>())!.n;

let adminId: string;
beforeEach(async () => {
  // Dan first, so later signups are pending.
  const me = await json<{ id: string; isAdmin: boolean }>(await asAdmin('/api/me'));
  expect(me.isAdmin).toBe(true);
  adminId = me.id;
  await env.DB.prepare("UPDATE users SET username = 'dan' WHERE id = ?").bind(adminId).run();
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users; DELETE FROM login_failures');
});

describe('admin guard', () => {
  it('a non-admin gets 403 forbidden on every admin route', async () => {
    const ren = await signup('ren');
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(ren.id).run();
    for (const [method, path] of [['GET', '/api/admin'], ['POST', `/api/admin/users/${adminId}/remove`], ['POST', `/api/admin/users/${ren.id}/approve`], ['POST', `/api/admin/users/${adminId}/reset-link`]] as const) {
      const res = await asCookie(ren.token, path, method);
      expect(res.status, path).toBe(403);
      expect(await json(res)).toEqual({ error: 'forbidden' });
    }
    expect(await statusOf(adminId)).toBe('active');
  });

  it('the old invite routes are gone', async () => {
    expect((await asAdmin('/api/admin/invites', 'POST')).status).toBe(404);
  });
});

describe('GET /api/admin', () => {
  it('lists pending (with requestedAt), active (with joinedAt, isAdmin) and removed people (1 query)', async () => {
    const ren = await signup('ren');
    const vance = await signup('vance');
    const al = await signup('alberto');
    await env.DB.prepare("UPDATE users SET status = 'active', display_name = 'Vance' WHERE id = ?").bind(vance.id).run();
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(al.id).run();
    const spy = spyD1(env.DB);
    const res = await asAdmin('/api/admin', 'GET', spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(2); // sign-in + 1
    const body = await json(res);
    expect(Object.keys(body).sort()).toEqual(['active', 'pending', 'removed']);
    expect(body.pending).toEqual([{ id: ren.id, username: 'ren', displayName: null, avatarAt: null, requestedAt: expect.stringMatching(/^\d{4}-/) }]);
    expect(body.active.map((u: { username: string }) => u.username)).toEqual(['dan', 'vance']);
    expect(body.active[0]).toMatchObject({ id: adminId, isAdmin: true, joinedAt: expect.any(String) });
    expect(body.active[1]).toEqual({ id: vance.id, username: 'vance', displayName: 'Vance', avatarAt: null, isAdmin: false, joinedAt: expect.any(String) });
    expect(body.removed).toEqual([{ id: al.id, username: 'alberto', displayName: null, avatarAt: null }]);
    expect(JSON.stringify(body)).not.toMatch(/password|email|u:/);
  });
});

describe('approve', () => {
  it('pending -> active; the person can use the app at once (2 queries)', async () => {
    const ren = await signup('ren');
    expect((await asCookie(ren.token, '/api/entries')).status).toBe(403);
    const spy = spyD1(env.DB);
    expect((await asAdmin(`/api/admin/users/${ren.id}/approve`, 'POST', spy.db)).status).toBe(204);
    expect(spy.queries).toBeLessThanOrEqual(2);
    expect(await statusOf(ren.id)).toBe('active');
    expect((await asCookie(ren.token, '/api/entries')).status).toBe(200);
  });

  it('removed -> active (restore); they sign in again with their password', async () => {
    const ren = await signup('ren');
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(ren.id).run();
    expect((await asAdmin(`/api/admin/users/${ren.id}/approve`, 'POST')).status).toBe(204);
    expect(await statusOf(ren.id)).toBe('active');
    expect((await asCookie(null, '/api/auth/login', 'POST', { username: 'ren', password: PW })).status).toBe(200);
  });

  it('active or unknown -> 404', async () => {
    expect((await asAdmin(`/api/admin/users/${adminId}/approve`, 'POST')).status).toBe(404);
    expect((await asAdmin('/api/admin/users/nope/approve', 'POST')).status).toBe(404);
  });
});

describe('decline', () => {
  it('deletes a pending person and their sessions (1 query)', async () => {
    const ren = await signup('ren');
    const spy = spyD1(env.DB);
    expect((await asAdmin(`/api/admin/users/${ren.id}/decline`, 'POST', spy.db)).status).toBe(204);
    expect(spy.queries).toBeLessThanOrEqual(2);
    expect(await statusOf(ren.id)).toBeNull();
    expect(await sessionsOf(ren.id)).toBe(0);
    expect((await asCookie(ren.token, '/api/me')).status).toBe(401);
    // the username is free again
    expect((await asCookie(null, '/api/auth/signup', 'POST', { username: 'ren', password: PW })).status).toBe(201);
  });

  it('refuses anyone who is not pending (404), keeping their data', async () => {
    const ren = await signup('ren');
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(ren.id).run();
    expect((await asAdmin(`/api/admin/users/${ren.id}/decline`, 'POST')).status).toBe(404);
    expect((await asAdmin(`/api/admin/users/${adminId}/decline`, 'POST')).status).toBe(404);
    expect(await statusOf(ren.id)).toBe('active');
  });
});

describe('remove', () => {
  it('active -> removed, every session deleted, data kept (2 queries)', async () => {
    const ren = await signup('ren');
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(ren.id).run();
    expect((await asCookie(ren.token, '/api/entries', 'POST', { category: 'anime', title: 'Frieren' })).status).toBe(201);
    const spy = spyD1(env.DB);
    expect((await asAdmin(`/api/admin/users/${ren.id}/remove`, 'POST', spy.db)).status).toBe(204);
    expect(spy.queries).toBeLessThanOrEqual(3);
    expect(await statusOf(ren.id)).toBe('removed');
    expect(await sessionsOf(ren.id)).toBe(0);
    expect((await asCookie(ren.token, '/api/me')).status).toBe(401);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id = ?').bind(ren.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('never removes yourself (400 self)', async () => {
    const res = await asAdmin(`/api/admin/users/${adminId}/remove`, 'POST');
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'self' });
    expect(await statusOf(adminId)).toBe('active');
  });

  it('pending, removed or unknown -> 404, and a pending person keeps their session', async () => {
    const ren = await signup('ren');
    expect((await asAdmin(`/api/admin/users/${ren.id}/remove`, 'POST')).status).toBe(404);
    expect(await statusOf(ren.id)).toBe('pending');
    expect(await sessionsOf(ren.id)).toBe(1);
    expect((await asAdmin('/api/admin/users/nope/remove', 'POST')).status).toBe(404);
  });
});

describe('reset-link', () => {
  it('returns <origin>/reset/<token>; only the hash is stored, valid 24 h (2 queries)', async () => {
    const ren = await signup('ren');
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(ren.id).run();
    const spy = spyD1(env.DB);
    const res = await asAdmin(`/api/admin/users/${ren.id}/reset-link`, 'POST', spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(3);
    const { link } = await json<{ link: string }>(res);
    const m = /^https:\/\/app\.test\/reset\/([A-Za-z0-9_-]{43})$/.exec(link);
    expect(m).not.toBeNull();
    const r = await env.DB.prepare('SELECT * FROM password_resets').first<Record<string, string>>();
    expect(r!.token_hash).toBe(await sha256Hex(m![1]!));
    expect(Object.values(r!)).not.toContain(m![1]);
    expect(r!.user_id).toBe(ren.id);
    expect((Date.parse(r!.expires_at!) - Date.parse(r!.created_at!)) / 3_600_000).toBeCloseTo(24, 3);
    // the link works once, and kills the other sessions
    const done = await asCookie(null, '/api/auth/reset', 'POST', { token: m![1], password: 'brand new pass' });
    expect(done.status).toBe(200);
    expect((await asCookie(ren.token, '/api/me')).status).toBe(401);
  });

  it('a new link replaces the previous one', async () => {
    const ren = await signup('ren');
    const first = (await json<{ link: string }>(await asAdmin(`/api/admin/users/${ren.id}/reset-link`, 'POST'))).link.split('/').pop()!;
    await asAdmin(`/api/admin/users/${ren.id}/reset-link`, 'POST');
    expect((await asCookie(null, `/api/auth/reset/${first}`)).status).toBe(404);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM password_resets').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('removed or unknown -> 404', async () => {
    const ren = await signup('ren');
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(ren.id).run();
    expect((await asAdmin(`/api/admin/users/${ren.id}/reset-link`, 'POST')).status).toBe(404);
    expect((await asAdmin('/api/admin/users/nope/reset-link', 'POST')).status).toBe(404);
  });
});

describe('unread requests count pending signups for the admin (A7)', () => {
  it('admin: friend requests + pending signups; others: friend requests only', async () => {
    const ren = await signup('ren');
    await signup('vance');
    expect(await json(await asAdmin('/api/activity/unread'))).toEqual({ feed: 0, requests: 2, messages: 0 });
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(ren.id).run();
    expect(await json(await asAdmin('/api/activity/unread'))).toEqual({ feed: 0, requests: 1, messages: 0 });
    expect(await json(await asCookie(ren.token, '/api/activity/unread'))).toEqual({ feed: 0, requests: 0, messages: 0 });
    expect((await asCookie(ren.token, '/api/friends/requests', 'POST', { username: 'dan' })).status).toBe(200);
    expect(await json(await asAdmin('/api/activity/unread'))).toEqual({ feed: 0, requests: 2, messages: 0 });
  });
});
