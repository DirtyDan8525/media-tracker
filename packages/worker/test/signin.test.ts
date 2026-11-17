import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { hashPassword, verifyPassword, PBKDF2_ITERATIONS } from '../src/auth/password';
import { sha256Hex } from '../src/auth/session';
import { spyD1 } from './d1spy';
import { rawFetch } from './origin';

// Phase 4b rulings A1-A6, A10: own sign-in with username + password. Requests run as production
// (no DEV_EMAIL), so only the session cookie signs anyone in.
const PROD: Partial<Env> = { ENVIRONMENT: 'prod', DEV_EMAIL: undefined, ADMIN_EMAIL: '' };

type Opts = { method?: string; body?: unknown; cookie?: string | null; headers?: Record<string, string>; over?: Partial<Env>; db?: D1Database };
const req = (path: string, o: Opts = {}) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method: o.method ?? 'GET',
      headers: {
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(o.cookie ? { cookie: `mt_session=${o.cookie}` } : {}),
        ...o.headers,
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    }),
    { ...env, ...PROD, ...(o.db ? { DB: o.db } : {}), ...o.over } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const cookieOf = (res: Response) => /(?:^|,\s*)mt_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;

const PW = 'correct horse';
const signup = (username: string, password = PW, extra: Record<string, unknown> = {}, o: Opts = {}) =>
  req('/api/auth/signup', { ...o, method: 'POST', body: { username, password, ...extra } });
const login = (username: string, password = PW, o: Opts = {}) =>
  req('/api/auth/login', { ...o, method: 'POST', body: { username, password } });
/** Signs up and returns the session token. */
const join = async (username: string, password = PW) => {
  const res = await signup(username, password);
  expect(res.status).toBe(201);
  return cookieOf(res)!;
};
const row = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await row<{ n: number }>(sql, ...binds))!.n;
const setStatus = (username: string, status: string) => env.DB.prepare('UPDATE users SET status = ? WHERE username = ?').bind(status, username).run();

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec('DELETE FROM users; DELETE FROM login_failures');
});

describe('passwords (A2)', () => {
  it('stores pbkdf2$30000$<16-byte salt>$<32-byte hash> and verifies only the right password', async () => {
    expect(PBKDF2_ITERATIONS).toBe(30_000);
    const stored = await hashPassword('hunter2hunter2');
    expect(stored).toMatch(/^pbkdf2\$30000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(stored).not.toContain('hunter2');
    expect(await verifyPassword('hunter2hunter2', stored)).toBe(true);
    expect(await verifyPassword('hunter2hunter3', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('refuses malformed stored values and iteration counts over the Workers cap', async () => {
    const good = await hashPassword('abcdefgh');
    for (const bad of ['', 'nope', good.replace('pbkdf2$', 'sha1$'), good.replace('$30000$', '$100001$'), good.replace('$30000$', '$9999$'), good.replace('$30000$', '$0$'), `${good}$x`]) {
      expect(await verifyPassword('abcdefgh', bad)).toBe(false);
    }
  });

  it('verifies a hash made with another allowed iteration count (raising the count later needs no resets)', async () => {
    const salt = new Uint8Array(16);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('abcdefgh'), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const stored = `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
    expect(await verifyPassword('abcdefgh', stored)).toBe(true);
    expect(await verifyPassword('abcdefgx', stored)).toBe(false);
  });

  it('uses crypto.subtle PBKDF2 with SHA-256 and 30000 iterations', async () => {
    const spy = vi.spyOn(crypto.subtle, 'deriveBits');
    await hashPassword('abcdefgh');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 30_000 });
    expect(spy.mock.calls[0]![2]).toBe(256);
  });
});

describe('signup (A1)', () => {
  it('the first signup on a fresh database is the active admin, and is signed in', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
    const res = await signup('Dan', PW, { displayName: '  Dan R  ' });
    expect(res.status).toBe(201);
    const me = await json(res);
    expect(me).toMatchObject({ username: 'dan', displayName: 'Dan R', isAdmin: true, status: 'active' });
    expect(me.email).toBe(`u:${me.id}`);
    const token = cookieOf(res)!;
    expect(await json(await req('/api/me', { cookie: token }))).toMatchObject({ id: me.id, isAdmin: true, status: 'active' });
  });

  it('later signups are pending and not admin', async () => {
    await join('dan');
    const res = await signup('ren');
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ username: 'ren', isAdmin: false, status: 'pending', displayName: null });
    expect(await row<{ status: string; is_admin: number }>('SELECT status, is_admin FROM users WHERE username = ?', 'ren')).toEqual({ status: 'pending', is_admin: 0 });
  });

  it('an existing database (Dan from the Access days) makes the first new signup pending', async () => {
    await env.DB.prepare("INSERT INTO users (id, email, username, settings_json, is_admin, created_at) VALUES ('d', 'dan@x.com', 'dan', '{}', 1, 'x')").run();
    expect(await json(await signup('ren'))).toMatchObject({ status: 'pending', isAdmin: false });
  });

  it('validates username (as PUT /api/me/username), password 8-128 and displayName', async () => {
    await join('dan');
    for (const [u, p, extra] of [
      ['ab', PW, {}], ['has space', PW, {}], ['x'.repeat(21), PW, {}], [42, PW, {}],
      ['ren', 'short12', {}], ['ren', 'x'.repeat(129), {}], ['ren', 12345678, {}],
      ['ren', PW, { displayName: 'x'.repeat(41) }], ['ren', PW, { displayName: '   ' }], ['ren', PW, { displayName: 5 }],
    ] as const) {
      const res = await req('/api/auth/signup', { method: 'POST', body: { username: u, password: p, ...extra } });
      expect(res.status, JSON.stringify([u, p, extra])).toBe(400);
      expect(await json(res)).toEqual({ error: 'invalid' });
      expect(cookieOf(res)).toBeNull();
    }
    expect((await signup('ren', 'x'.repeat(8))).status).toBe(201);
    expect((await signup('vance', 'é'.repeat(128))).status).toBe(201);
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(3);
  });

  it('a taken username (any case) is 409 taken and creates nothing', async () => {
    await join('dan');
    const res = await signup('DAN');
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'taken' });
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
  });

  it('runs at most 4 queries (the app settings, then the batch of 3)', async () => {
    const spy = spyD1(env.DB);
    expect((await signup('dan', PW, {}, { db: spy.db })).status).toBe(201);
    expect(spy.queries).toBeLessThanOrEqual(4);
  });
});

describe('sessions (A3)', () => {
  it('sets mt_session: 32 random bytes base64url, HttpOnly, Secure, SameSite=Lax, Path=/, one year', async () => {
    const res = await signup('dan');
    const header = res.headers.get('set-cookie')!;
    const parts = header.split(';').map((s) => s.trim());
    expect(parts[0]).toMatch(/^mt_session=[A-Za-z0-9_-]{43}$/);
    expect(parts).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000']));
    expect(header).not.toMatch(/Domain=/i);
  });

  it('stores only the SHA-256 of the token, with created, expiry (365 days) and last-used times', async () => {
    const token = await join('dan');
    const s = await row<Record<string, string>>('SELECT * FROM sessions');
    expect(s!.token_hash).toBe(await sha256Hex(token));
    expect(s!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(s!)).not.toContain(token);
    const days = (Date.parse(s!.expires_at!) - Date.parse(s!.created_at!)) / 86_400_000;
    expect(days).toBeCloseTo(365, 3);
    expect(s!.last_used_at).toBe(s!.created_at);
  });

  it('no cookie, an unknown cookie or a garbage cookie is 401 unauthorized', async () => {
    await join('dan');
    for (const cookie of [null, 'A'.repeat(43), 'x', '']) {
      const res = await req('/api/me', { cookie });
      expect(res.status).toBe(401);
      expect(await json(res)).toEqual({ error: 'unauthorized' });
    }
  });

  it('an expired session is 401, its row is deleted and the cookie cleared', async () => {
    const token = await join('dan');
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
    const res = await req('/api/me', { cookie: token });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^mt_session=; .*Max-Age=0/);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });

  it('used within a day: nothing is written and no cookie is re-sent (1 query to sign in)', async () => {
    const token = await join('dan');
    const before = await row<Record<string, string>>('SELECT * FROM sessions');
    const spy = spyD1(env.DB);
    const res = await req('/api/activity/unread', { cookie: token, db: spy.db });
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(2); // sign-in + the route's 1
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await row('SELECT * FROM sessions')).toEqual(before);
  });

  it('used more than a day after last use: rolls expiry to 365 days from now and re-sends the cookie', async () => {
    const token = await join('dan');
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await env.DB.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ?').bind(old, soon).run();
    const spy = spyD1(env.DB);
    const res = await req('/api/activity/unread', { cookie: token, db: spy.db });
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(3); // sign-in, renewal, route
    expect(cookieOf(res)).toBe(token);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=31536000/);
    const s = await row<{ expires_at: string; last_used_at: string }>('SELECT expires_at, last_used_at FROM sessions');
    expect(Date.parse(s!.last_used_at)).toBeGreaterThan(Date.now() - 60_000);
    expect((Date.parse(s!.expires_at) - Date.now()) / 86_400_000).toBeCloseTo(365, 1);
  });

  it('logout deletes the session row and clears the cookie; the old token is then refused', async () => {
    const token = await join('dan');
    const other = cookieOf(await login('dan'))!;
    const res = await req('/api/auth/logout', { method: 'POST', body: {}, cookie: token });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/^mt_session=; .*Max-Age=0/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect((await req('/api/me', { cookie: token })).status).toBe(401);
    expect((await req('/api/me', { cookie: other })).status).toBe(200); // only this device signs out
    expect((await req('/api/auth/logout', { method: 'POST', body: {} })).status).toBe(204); // signed out already: fine
  });
});

describe('login (A2, A5)', () => {
  it('right password signs in with a fresh session; pending users can sign in too', async () => {
    await join('dan');
    await join('ren');
    const res = await login('REN ');
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ username: 'ren', status: 'pending' });
    expect(cookieOf(res)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(3);
  });

  it('wrong password and unknown username give the same 401 bad_credentials, and no cookie', async () => {
    await join('dan');
    const wrong = await login('dan', 'wrong password');
    const unknown = await login('nobody', PW);
    const malformed = await login('no such user!', PW);
    for (const res of [wrong, unknown, malformed]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    const bodies = await Promise.all([wrong, unknown, malformed].map((r) => r.text()));
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify({ error: 'bad_credentials' })]));
  });

  it('an unknown username still runs one password hash (no timing oracle)', async () => {
    await join('dan');
    const spy = vi.spyOn(crypto.subtle, 'deriveBits');
    await login('nobody', PW);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await login('dan', 'wrong password');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a user without a password (pre-cutover row) cannot sign in', async () => {
    await env.DB.prepare("INSERT INTO users (id, email, username, settings_json, is_admin, created_at) VALUES ('d', 'dan@x.com', 'dan', '{}', 1, 'x')").run();
    expect(await json(await login('dan', ''))).toEqual({ error: 'invalid' });
    expect(await json(await login('dan', PW))).toEqual({ error: 'bad_credentials' });
  });

  it('10 failures within 15 minutes lock the username for 15 minutes with 429, even with the right password', async () => {
    await join('dan');
    for (let i = 0; i < 10; i++) expect((await login('dan', `wrong ${i}xxxx`)).status).toBe(401);
    const locked = await login('dan', PW);
    expect(locked.status).toBe(429);
    expect(await json(locked)).toEqual({ error: 'too_many_attempts' });
    expect(cookieOf(locked)).toBeNull();
    // attempts while locked are not counted, so the lock ends 15 minutes after the 10th failure
    expect(await count('SELECT COUNT(*) AS n FROM login_failures')).toBe(10);
    await env.DB.prepare('UPDATE login_failures SET at = ?').bind(new Date(Date.now() - 15 * 60_000 - 1000).toISOString()).run();
    expect((await login('dan', PW)).status).toBe(200);
  });

  it('locks unknown usernames the same way (no oracle), and other usernames are unaffected', async () => {
    await join('dan');
    for (let i = 0; i < 10; i++) await login('ghost', `wrong ${i}xxxx`);
    expect((await login('ghost', PW)).status).toBe(429);
    expect((await login('dan', PW)).status).toBe(200);
  });

  it('failures spread over more than 15 minutes do not lock', async () => {
    await join('dan');
    const old = new Date(Date.now() - 16 * 60_000).toISOString();
    for (let i = 0; i < 9; i++) await env.DB.prepare('INSERT INTO login_failures (username, at) VALUES (?, ?)').bind('dan', old).run();
    await login('dan', 'wrong password');
    expect((await login('dan', PW)).status).toBe(200);
  });

  it('a successful sign-in clears the failures', async () => {
    await join('dan');
    for (let i = 0; i < 9; i++) await login('dan', `wrong ${i}xxxx`);
    expect((await login('dan', PW)).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM login_failures')).toBe(0);
    for (let i = 0; i < 9; i++) await login('dan', `wrong ${i}xxxx`);
    expect((await login('dan', PW)).status).toBe(200);
  });

  it('a removed user with the right password gets 403 removed; with a wrong one, bad_credentials', async () => {
    await join('dan');
    await join('ren');
    await setStatus('ren', 'removed');
    const res = await login('ren', PW);
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'removed' });
    expect(cookieOf(res)).toBeNull();
    expect(await json(await login('ren', 'wrong password'))).toEqual({ error: 'bad_credentials' });
  });

  it('runs at most 4 queries', async () => {
    await join('dan');
    const spy = spyD1(env.DB);
    expect((await login('dan', PW, { db: spy.db })).status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(4);
    spy.reset();
    expect((await login('dan', 'wrong password', { db: spy.db })).status).toBe(401);
    expect(spy.queries).toBeLessThanOrEqual(4);
  });
});

describe('Origin check on non-GET /api requests (A4)', () => {
  const raw = (method: string, path: string, headers: Record<string, string>, body?: unknown, over: Partial<Env> = {}) =>
    rawFetch(
      new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { ...env, ...PROD, ...over } as Env,
    );

  it('a missing or foreign Origin is 403 bad_origin, for auth and API routes, before anything runs', async () => {
    for (const headers of [{}, { Origin: 'https://evil.test' }, { Origin: 'http://app.test' }, { Origin: 'https://app.test.evil.test' }, { Origin: 'null' }] as Record<string, string>[]) {
      for (const [method, path, body] of [
        ['POST', '/api/auth/signup', { username: 'dan', password: PW }],
        ['POST', '/api/auth/login', { username: 'dan', password: PW }],
        ['POST', '/api/auth/logout', {}],
        ['PUT', '/api/me/username', { username: 'dan' }],
        ['DELETE', '/api/entries/x', undefined],
        ['PATCH', '/api/entries/x', {}],
      ] as const) {
        const res = await raw(method, path, headers, body);
        expect(res.status, `${method} ${path} ${JSON.stringify(headers)}`).toBe(403);
        expect(await json(res)).toEqual({ error: 'bad_origin' });
      }
    }
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
  });

  it('applies to the DEV_EMAIL bypass too', async () => {
    const res = await raw('PUT', '/api/me/username', {}, { username: 'dan' }, { ENVIRONMENT: 'dev', DEV_EMAIL: 'dan@x.com' });
    expect(res.status).toBe(403);
  });

  it('the matching Origin passes', async () => {
    const res = await raw('POST', '/api/auth/signup', { Origin: 'https://app.test' }, { username: 'dan', password: PW });
    expect(res.status).toBe(201);
  });

  it('GET is unaffected, with or without a foreign Origin', async () => {
    const token = await join('dan');
    for (const headers of [{}, { Origin: 'https://evil.test' }] as Record<string, string>[]) {
      const res = await rawFetch(new Request('https://app.test/api/me', { headers: { ...headers, cookie: `mt_session=${token}` } }), { ...env, ...PROD } as Env);
      expect(res.status).toBe(200);
    }
  });
});

describe('pending and removed (A6)', () => {
  it('pending may call GET /api/me, PUT /api/me/username and /display-name; everything else is 403 pending', async () => {
    await join('dan');
    const t = await join('ren');
    expect((await req('/api/me', { cookie: t })).status).toBe(200);
    expect((await req('/api/me/username', { method: 'PUT', body: { username: 'renny' }, cookie: t })).status).toBe(200);
    expect(await json(await req('/api/me/display-name', { method: 'PUT', body: { displayName: 'Ren' }, cookie: t }))).toMatchObject({ username: 'renny', displayName: 'Ren', status: 'pending' });
    for (const [method, path, body] of [
      ['GET', '/api/entries', undefined],
      ['POST', '/api/entries', { category: 'anime', title: 'x' }],
      ['GET', '/api/friends', undefined],
      ['GET', '/api/users/search?q=da', undefined],
      ['GET', '/api/activity', undefined],
      ['GET', '/api/activity/unread', undefined],
      ['PUT', '/api/me/settings', { settings: { theme: 'Sunset' } }],
      ['GET', '/api/me/invite', undefined],
      ['GET', '/api/me/avatar', undefined],
      ['GET', '/api/admin', undefined],
      ['POST', '/api/lookup', { category: 'anime', term: 'x' }],
    ] as const) {
      const res = await req(path, { method, body, cookie: t });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await json(res)).toEqual({ error: 'pending' });
    }
    expect((await req('/api/auth/logout', { method: 'POST', body: {}, cookie: t })).status).toBe(204);
  });

  it('a removed user\'s sessions are deleted on their next request, which gets 401 removed', async () => {
    await join('dan');
    const t1 = await join('ren');
    const t2 = cookieOf(await login('ren'))!;
    await setStatus('ren', 'removed');
    const res = await req('/api/me', { cookie: t1 });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'removed' });
    expect(res.headers.get('set-cookie')).toMatch(/^mt_session=; .*Max-Age=0/);
    expect(await count("SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'ren'")).toBe(0);
    expect((await req('/api/me', { cookie: t2 })).status).toBe(401);
  });

  it('approval takes effect on the next request without signing in again', async () => {
    await join('dan');
    const t = await join('ren');
    expect((await req('/api/entries', { cookie: t })).status).toBe(403);
    await setStatus('ren', 'active');
    expect((await req('/api/entries', { cookie: t })).status).toBe(200);
  });
});

describe('admin email (A1)', () => {
  it("Dan's existing ADMIN_EMAIL row stays admin after setting a password", async () => {
    const hash = await hashPassword(PW);
    await env.DB.prepare("INSERT INTO users (id, email, username, settings_json, is_admin, created_at, password_hash) VALUES ('d', 'dan@x.com', 'dan', '{}', 1, 'x', ?)").bind(hash).run();
    const res = await login('dan', PW, { over: { ADMIN_EMAIL: 'dan@x.com' } });
    expect(await json(res)).toMatchObject({ id: 'd', email: 'dan@x.com', isAdmin: true, status: 'active' });
    expect((await req('/api/admin', { cookie: cookieOf(res), over: { ADMIN_EMAIL: 'dan@x.com' } })).status).toBe(200);
  });

  it('the ADMIN_EMAIL row is admin even if is_admin was never set', async () => {
    const hash = await hashPassword(PW);
    await env.DB.prepare("INSERT INTO users (id, email, username, settings_json, is_admin, created_at, password_hash) VALUES ('d', 'Dan@X.com', 'dan', '{}', 0, 'x', ?)").bind(hash).run();
    const res = await login('dan', PW, { over: { ADMIN_EMAIL: ' dan@x.com ' } });
    expect(await json(res)).toMatchObject({ isAdmin: true });
  });
});

describe('password reset (A7)', () => {
  const insertReset = async (username: string, token: string, expiresInMs = 86_400_000) => {
    const u = await row<{ id: string }>('SELECT id FROM users WHERE username = ?', username);
    await env.DB.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), u!.id, new Date().toISOString(), new Date(Date.now() + expiresInMs).toISOString())
      .run();
  };
  const TOKEN = 'resetresetresetresetresetresetresetresetres';

  it('GET /api/auth/reset/:token names the user; unknown or expired is 404', async () => {
    await join('dan');
    await join('ren');
    await insertReset('ren', TOKEN);
    expect(await json(await req(`/api/auth/reset/${TOKEN}`))).toEqual({ username: 'ren' });
    expect((await req('/api/auth/reset/nope')).status).toBe(404);
    await env.DB.exec("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await req(`/api/auth/reset/${TOKEN}`)).status).toBe(404);
  });

  it('sets the new password, signs this device in, kills every other session, and works once', async () => {
    await join('dan');
    const old = await join('ren');
    await insertReset('ren', TOKEN);
    const res = await req('/api/auth/reset', { method: 'POST', body: { token: TOKEN, password: 'brand new pass' } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ username: 'ren' });
    const fresh = cookieOf(res)!;
    expect((await req('/api/me', { cookie: fresh })).status).toBe(200);
    expect((await req('/api/me', { cookie: old })).status).toBe(401);
    expect((await login('ren', PW)).status).toBe(401);
    expect((await login('ren', 'brand new pass')).status).toBe(200);
    const again = await req('/api/auth/reset', { method: 'POST', body: { token: TOKEN, password: 'another pass' } });
    expect(again.status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM password_resets')).toBe(0);
  });

  it('an expired token (24 h) is refused and changes nothing', async () => {
    await join('dan');
    await join('ren');
    await insertReset('ren', TOKEN, -1000);
    expect((await req('/api/auth/reset', { method: 'POST', body: { token: TOKEN, password: 'brand new pass' } })).status).toBe(404);
    expect((await login('ren', PW)).status).toBe(200);
  });

  it('validates the new password (8-128) without using the token up', async () => {
    await join('dan');
    await join('ren');
    await insertReset('ren', TOKEN);
    expect((await req('/api/auth/reset', { method: 'POST', body: { token: TOKEN, password: 'short' } })).status).toBe(400);
    expect((await req('/api/auth/reset', { method: 'POST', body: { password: 'long enough' } })).status).toBe(400);
    expect((await req(`/api/auth/reset/${TOKEN}`)).status).toBe(200);
  });

  it('a removed user cannot use a reset link', async () => {
    await join('dan');
    await join('ren');
    await insertReset('ren', TOKEN);
    await setStatus('ren', 'removed');
    expect((await req(`/api/auth/reset/${TOKEN}`)).status).toBe(404);
    expect((await req('/api/auth/reset', { method: 'POST', body: { token: TOKEN, password: 'brand new pass' } })).status).toBe(404);
  });

  it('runs at most 6 queries', async () => {
    await join('dan');
    await join('ren');
    await insertReset('ren', TOKEN);
    const spy = spyD1(env.DB);
    expect((await req('/api/auth/reset', { method: 'POST', body: { token: TOKEN, password: 'brand new pass' }, db: spy.db })).status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(6);
  });
});

describe('DEV_EMAIL bypass (A10)', () => {
  it('still works in dev, creating the user active', async () => {
    const res = await req('/api/me', { over: { ENVIRONMENT: 'dev', DEV_EMAIL: 'dev@x.com' } });
    expect(await json(res)).toMatchObject({ email: 'dev@x.com', status: 'active' });
  });

  it('is ignored in prod', async () => {
    expect((await req('/api/me', { over: { ENVIRONMENT: 'prod', DEV_EMAIL: 'dev@x.com' } })).status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
  });
});
