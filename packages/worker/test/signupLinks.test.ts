import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256Hex } from '../src/auth/session';
import { spyD1 } from './d1spy';
import { rawFetch } from './origin';

// Pre-approved sign-up links: Dan makes a single-use link (7 days); whoever signs up with it is
// active at once. Migration 0007.
const ADMIN = 'dan@x.com';
const PW = 'correct horse';
const DAY = 86_400_000;

const asAdmin = (path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}) }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: ADMIN, ADMIN_EMAIL: ADMIN } as Env,
  );
const asCookie = (token: string | null, path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { cookie: `mt_session=${token}` } : {}) },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
    }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'prod', DEV_EMAIL: undefined, ADMIN_EMAIL: ADMIN } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const cookieOf = (res: Response) => /mt_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;
const statusOf = async (id: string) => (await env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(id).first<{ status: string }>())?.status ?? null;
const signup = (username: string, extra: Record<string, unknown> = {}, db?: D1Database) =>
  asCookie(null, '/api/auth/signup', 'POST', { username, password: PW, ...extra }, db);

const tokenOf = (link: string) => link.split('/').pop()!;
/** Makes a link as the admin and returns its token. */
const makeLink = async () => {
  const res = await asAdmin('/api/admin/signup-links', 'POST');
  expect(res.status).toBe(200);
  const body = await json<{ link: string; expiresAt: string }>(res);
  return { ...body, token: tokenOf(body.link) };
};
const idOf = async (token: string) => (await env.DB.prepare('SELECT id FROM signup_links WHERE token_hash = ?').bind(await sha256Hex(token)).first<{ id: string }>())!.id;
const listLinks = async () => (await json<{ links: any[] }>(await asAdmin('/api/admin/signup-links'))).links;

let adminId: string;
beforeEach(async () => {
  const me = await json<{ id: string }>(await asAdmin('/api/me'));
  adminId = me.id;
  await env.DB.prepare("UPDATE users SET username = 'dan' WHERE id = ?").bind(adminId).run();
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users; DELETE FROM login_failures; DELETE FROM signup_links');
});

describe('POST /api/admin/signup-links', () => {
  it('returns <origin>/join/<token> and a 7-day expiry', async () => {
    const before = Date.now();
    const { link, expiresAt } = await makeLink();
    expect(link).toMatch(/^https:\/\/app\.test\/join\/[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(expiresAt) - before).toBeGreaterThan(7 * DAY - 5_000);
    expect(Date.parse(expiresAt) - before).toBeLessThan(7 * DAY + 5_000);
  });

  it('stores only the SHA-256 of the token, never the token', async () => {
    const { token, expiresAt } = await makeLink();
    const { results } = await env.DB.prepare('SELECT * FROM signup_links').all<Record<string, string | null>>();
    expect(results).toHaveLength(1);
    const row = results[0]!;
    expect(row.token_hash).toBe(await sha256Hex(token));
    expect(Object.values(row)).not.toContain(token);
    expect(row.created_by).toBe(adminId);
    expect(row.expires_at).toBe(expiresAt);
    expect(row.used_by).toBeNull();
    expect(row.used_at).toBeNull();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('every link is different', async () => {
    const a = await makeLink();
    const b = await makeLink();
    expect(a.token).not.toBe(b.token);
  });
});

describe('admin-only and Origin', () => {
  it('a non-admin gets 403 forbidden on every sign-up link route and delete', async () => {
    const link = await makeLink();
    const id = (await listLinks())[0].id;
    const ren = await signup('ren');
    const renToken = cookieOf(ren)!;
    const renId = (await json<{ id: string }>(ren)).id;
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(renId).run();
    for (const [method, path] of [['POST', '/api/admin/signup-links'], ['GET', '/api/admin/signup-links'], ['DELETE', `/api/admin/signup-links/${id}`], ['POST', `/api/admin/users/${adminId}/delete`]] as const) {
      const res = await asCookie(renToken, path, method);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await json(res)).toEqual({ error: 'forbidden' });
    }
    expect(await statusOf(adminId)).toBe('active');
    expect((await json(await asCookie(null, `/api/auth/join/${link.token}`))).valid).toBe(true);
  });

  it('a signed-out caller gets 401', async () => {
    expect((await asCookie(null, '/api/admin/signup-links')).status).toBe(401);
    expect((await asCookie(null, '/api/admin/signup-links', 'POST')).status).toBe(401);
  });

  it('the Origin check applies: no or foreign Origin is 403 bad_origin and nothing changes', async () => {
    const { token } = await makeLink();
    const id = (await listLinks())[0].id;
    const env2 = { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: ADMIN, ADMIN_EMAIL: ADMIN } as Env;
    const calls: [string, string][] = [['POST', '/api/admin/signup-links'], ['DELETE', `/api/admin/signup-links/${id}`], ['POST', `/api/admin/users/${adminId}/delete`]];
    for (const origin of [null, 'https://evil.test']) {
      for (const [method, path] of calls) {
        const res = await rawFetch(new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: method === 'DELETE' ? undefined : '{}' }), env2);
        expect(res.status, `${method} ${path} ${origin}`).toBe(403);
        expect(await json(res)).toEqual({ error: 'bad_origin' });
      }
    }
    const res = await rawFetch(new Request('https://app.test/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://evil.test' }, body: JSON.stringify({ username: 'ren', password: PW, joinToken: token }) }), env2);
    expect(res.status).toBe(403);
    expect(await listLinks()).toHaveLength(1);
    expect((await listLinks())[0].status).toBe('unused');
    expect(await statusOf(adminId)).toBe('active');
  });
});

describe('GET /api/admin/signup-links', () => {
  it('lists the last 50, newest first, with status and never the token or hash', async () => {
    const a = await makeLink();
    const b = await makeLink();
    const c = await makeLink();
    const d = await makeLink();
    await env.DB.prepare("UPDATE signup_links SET created_at = ? WHERE token_hash = ?").bind('2026-01-01T00:00:00.000Z', await sha256Hex(a.token)).run();
    const ren = await signup('ren', { joinToken: b.token });
    expect(ren.status).toBe(201);
    await env.DB.prepare("UPDATE signup_links SET expires_at = ? WHERE token_hash = ?").bind('2026-01-02T00:00:00.000Z', await sha256Hex(c.token)).run();
    expect((await asAdmin(`/api/admin/signup-links/${await idOf(d.token)}`, 'DELETE')).status).toBe(204);
    const spy = spyD1(env.DB);
    const res = await asAdmin('/api/admin/signup-links', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(2); // sign-in + 1
    const body = await json<{ links: any[] }>(res);
    expect(body.links.map((l) => l.status).sort()).toEqual(['expired', 'revoked', 'unused', 'used']);
    const used = body.links.find((l) => l.status === 'used');
    expect(used).toMatchObject({ usedBy: 'ren', usedAt: expect.any(String) });
    for (const l of body.links) expect(Object.keys(l).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'status', 'usedAt', 'usedBy']);
    const text = JSON.stringify(body);
    for (const t of [a.token, b.token, c.token, d.token]) expect(text).not.toContain(t);
    expect(text).not.toContain(await sha256Hex(a.token));
    // newest first: the back-dated link is last
    expect(body.links.at(-1).createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('caps the list at 50', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => env.DB.prepare("INSERT INTO signup_links (token_hash, id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(`h${i}`, `id${i}`, adminId, new Date(Date.now() - i * 1000).toISOString(), new Date(Date.now() + DAY).toISOString()));
    await env.DB.batch(rows);
    expect(await listLinks()).toHaveLength(50);
  });
});

describe('GET /api/auth/join/:token', () => {
  it('valid for an unused live link, signed out (1 query), nothing else leaks', async () => {
    const { token } = await makeLink();
    const spy = spyD1(env.DB);
    const res = await asCookie(null, `/api/auth/join/${token}`, 'GET', undefined, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(1);
    expect(await json(res)).toEqual({ valid: true });
  });

  it('invalid for unknown, malformed, used, expired and revoked links', async () => {
    const used = await makeLink();
    await signup('ren', { joinToken: used.token });
    const expired = await makeLink();
    await env.DB.prepare('UPDATE signup_links SET expires_at = ? WHERE token_hash = ?').bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(expired.token)).run();
    const revoked = await makeLink();
    expect((await asAdmin(`/api/admin/signup-links/${await idOf(revoked.token)}`, 'DELETE')).status).toBe(204);
    for (const t of [used.token, expired.token, revoked.token, 'x'.repeat(43), 'short']) {
      const res = await asCookie(null, `/api/auth/join/${t}`);
      expect(res.status, t).toBe(200);
      expect(await json(res), t).toEqual({ valid: false });
    }
  });
});

describe('signup with a joinToken', () => {
  it('a valid link makes the user active at once and marks the link used by them', async () => {
    const { token } = await makeLink();
    const res = await signup('ren', { joinToken: token });
    expect(res.status).toBe(201);
    const me = await json(res);
    expect(me.status).toBe('active');
    expect(me.joinLink).toBeUndefined();
    expect(await statusOf(me.id)).toBe('active');
    // they are in: a pending user would get 403 here
    expect((await asCookie(cookieOf(res), '/api/entries')).status).toBe(200);
    const row = await env.DB.prepare('SELECT used_by, used_at FROM signup_links WHERE token_hash = ?').bind(await sha256Hex(token)).first<{ used_by: string; used_at: string }>();
    expect(row).toEqual({ used_by: me.id, used_at: expect.stringMatching(/^\d{4}-/) });
    expect((await listLinks())[0]).toMatchObject({ status: 'used', usedBy: 'ren' });
  });

  it('is single use: a second signup with the same link is pending with joinLink invalid', async () => {
    const { token } = await makeLink();
    const first = await json(await signup('ren', { joinToken: token }));
    const secondRes = await signup('vance', { joinToken: token });
    expect(secondRes.status).toBe(201);
    const second = await json(secondRes);
    expect(second).toMatchObject({ status: 'pending', joinLink: 'invalid' });
    expect(await statusOf(second.id)).toBe('pending');
    expect(await statusOf(first.id)).toBe('active');
    const row = await env.DB.prepare('SELECT used_by FROM signup_links').first<{ used_by: string }>();
    expect(row!.used_by).toBe(first.id); // the first keeps it
  });

  it('race: the link is taken between the check and the write; the user is still created, pending', async () => {
    const { token } = await makeLink();
    const spy = spyD1(env.DB);
    spy.beforeBatch = async () => {
      // somebody else claims it just before our batch runs
      const other = await signup('alberto', { joinToken: token });
      expect(((await json(other)) as any).status).toBe('active');
    };
    const res = await signup('vance', { joinToken: token }, spy.db);
    expect(res.status).toBe(201);
    const me = await json(res);
    expect(me).toMatchObject({ status: 'pending', joinLink: 'invalid' });
    const used = await env.DB.prepare('SELECT u.username FROM signup_links l JOIN users u ON u.id = l.used_by').first<{ username: string }>();
    expect(used!.username).toBe('alberto');
  });

  it('an expired link: pending, joinLink invalid, link untouched', async () => {
    const { token } = await makeLink();
    await env.DB.prepare('UPDATE signup_links SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
    const me = await json(await signup('ren', { joinToken: token }));
    expect(me).toMatchObject({ status: 'pending', joinLink: 'invalid' });
    expect((await env.DB.prepare('SELECT used_at FROM signup_links').first<{ used_at: string | null }>())!.used_at).toBeNull();
  });

  it('a revoked link: pending, joinLink invalid', async () => {
    const { token } = await makeLink();
    expect((await asAdmin(`/api/admin/signup-links/${await idOf(token)}`, 'DELETE')).status).toBe(204);
    const me = await json(await signup('ren', { joinToken: token }));
    expect(me).toMatchObject({ status: 'pending', joinLink: 'invalid' });
  });

  it('an unknown or malformed token: pending, joinLink invalid', async () => {
    for (const [i, t] of ['A'.repeat(43), 'nope'].entries()) {
      const me = await json(await signup(`ren${i}`, { joinToken: t }));
      expect(me).toMatchObject({ status: 'pending', joinLink: 'invalid' });
    }
  });

  it('no joinToken: pending as before, and no joinLink field', async () => {
    const me = await json(await signup('ren'));
    expect(me.status).toBe('pending');
    expect('joinLink' in me).toBe(false);
  });

  it('a joinToken that is not a string is a 400 and creates nothing', async () => {
    const res = await signup('ren', { joinToken: 42 });
    expect(res.status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'ren'").first<{ n: number }>())!.n).toBe(0);
  });

  it('a taken username leaves the link unused (the whole batch rolled back)', async () => {
    const { token } = await makeLink();
    const res = await signup('dan', { joinToken: token });
    expect(res.status).toBe(409);
    expect((await listLinks())[0].status).toBe('unused');
  });

  it('the signup is still one batch', async () => {
    const { token } = await makeLink();
    const spy = spyD1(env.DB);
    expect((await signup('ren', { joinToken: token }, spy.db)).status).toBe(201);
    expect(spy.queries).toBeLessThanOrEqual(5);
  });
});

describe('DELETE /api/admin/signup-links/:id (revoke)', () => {
  it('revokes an unused link; its token stops working', async () => {
    const { token } = await makeLink();
    const id = (await listLinks())[0].id;
    expect((await asAdmin(`/api/admin/signup-links/${id}`, 'DELETE')).status).toBe(204);
    expect((await listLinks())[0].status).toBe('revoked');
    expect(await json(await asCookie(null, `/api/auth/join/${token}`))).toEqual({ valid: false });
  });

  it('a used, expired, revoked or unknown link is 404', async () => {
    const used = await makeLink();
    await signup('ren', { joinToken: used.token });
    const expired = await makeLink();
    await env.DB.prepare('UPDATE signup_links SET expires_at = ? WHERE token_hash = ?').bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(expired.token)).run();
    const ls = await listLinks();
    for (const l of ls) expect((await asAdmin(`/api/admin/signup-links/${l.id}`, 'DELETE')).status).toBe(404);
    expect((await asAdmin('/api/admin/signup-links/nope', 'DELETE')).status).toBe(404);
    expect((await listLinks()).map((l) => l.status).sort()).toEqual(['expired', 'used']);
  });
});

describe('POST /api/admin/users/:id/delete', () => {
  it('deletes the member and everything of theirs (cascade); others are untouched', async () => {
    const ren = await signup('ren');
    const renId = (await json<{ id: string }>(ren)).id;
    const renTok = cookieOf(ren)!;
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(renId).run();
    expect((await asCookie(renTok, '/api/entries', 'POST', { category: 'anime', title: 'Frieren' })).status).toBe(201);
    const [a, b] = renId < adminId ? [renId, adminId] : [adminId, renId];
    await env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)").bind(a, b, renId, new Date().toISOString()).run();
    const link = await makeLink();
    await signup('vance', { joinToken: link.token });
    const vance = await env.DB.prepare("SELECT id FROM users WHERE username = 'vance'").first<{ id: string }>();
    await asCookie(renTok, '/api/entries', 'POST', { category: 'anime', title: 'Mushishi' });
    const res = await asAdmin(`/api/admin/users/${renId}/delete`, 'POST');
    expect(res.status).toBe(204);
    const n = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'friendships' ? 'user_a = ?1 OR user_b = ?1' : 'user_id = ?1'}`).bind(renId).first<{ n: number }>())!.n;
    for (const t of ['sessions', 'entries', 'activity', 'friendships']) expect(await n(t), t).toBe(0);
    expect(await statusOf(renId)).toBeNull();
    expect((await asCookie(renTok, '/api/me')).status).toBe(401);
    expect(await statusOf(adminId)).toBe('active');
    expect(await statusOf(vance!.id)).toBe('active');
  });

  it('deleting a person who used a link keeps the link row, used, with no name', async () => {
    const link = await makeLink();
    const ren = await json<{ id: string }>(await signup('ren', { joinToken: link.token }));
    expect((await asAdmin(`/api/admin/users/${ren.id}/delete`, 'POST')).status).toBe(204);
    expect((await listLinks())[0]).toMatchObject({ status: 'used', usedBy: null });
  });

  it('works on a removed member too, and the username is free again', async () => {
    const ren = await json<{ id: string }>(await signup('ren'));
    await env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(ren.id).run();
    expect((await asAdmin(`/api/admin/users/${ren.id}/delete`, 'POST')).status).toBe(204);
    expect((await signup('ren')).status).toBe(201);
  });

  it('never yourself (400 self); unknown is 404', async () => {
    const res = await asAdmin(`/api/admin/users/${adminId}/delete`, 'POST');
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'self' });
    expect(await statusOf(adminId)).toBe('active');
    expect((await asAdmin('/api/admin/users/nope/delete', 'POST')).status).toBe(404);
  });
});
