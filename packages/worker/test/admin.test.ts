import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';

const ADMIN = 'dan@x.com';
const BASE = 'https://api.cloudflare.com/client/v4/accounts/acc/access/policies/pol';
const CF = { CF_API_TOKEN: 'tok', CF_ACCOUNT_ID: 'acc', ACCESS_POLICY_ID: 'pol' };

const as = (email: string, path: string, method = 'GET', body?: unknown, over: Partial<Env> = {}) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email, ADMIN_EMAIL: ADMIN, ...CF, ...over } as Env,
  );

const policy = (include: unknown[]) => ({
  success: true,
  errors: [],
  result: {
    id: 'pol',
    name: 'Friends',
    decision: 'allow',
    include,
    exclude: [{ ip: { ip: '1.2.3.4/32' } }],
    require: [{ everyone: {} }],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    app_count: 1,
    reusable: true,
  },
});

/** Stubs fetch: GET answers `get`, PUT answers `put`. Returns the recorded calls. */
function stubCf(get: object | { status: number; body: string }, put: object = { success: true, errors: [], result: {} }) {
  const calls: { method: string; url: string; headers: Headers; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url: String(input),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const v = method === 'PUT' ? put : get;
    if ('status' in v && 'body' in v) return new Response(String(v.body), { status: Number(v.status) });
    return new Response(JSON.stringify(v), { status: 200 });
  });
  return calls;
}

const cfError = { status: 403, body: JSON.stringify({ success: false, errors: [{ message: 'Authentication error' }] }) };
const invitesCount = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM invites').first<{ n: number }>())!.n;

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec('DELETE FROM invites');
  await env.DB.exec('DELETE FROM users');
});

describe('admin guard', () => {
  it('non-admin gets 403 and Cloudflare is never called', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await as('ren@x.com', '/api/admin')).status).toBe(403);
    const res = await as('ren@x.com', '/api/admin/invites', 'POST', { email: 'a@b.co' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect((await as('ren@x.com', '/api/admin/invites/a%40b.co', 'DELETE')).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/invites', () => {
  it('adds an email: GET then PUT, Bearer header, full-replace body', async () => {
    const calls = stubCf(policy([{ email: { email: 'dan@x.com' } }]));
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: '  Ren@X.com ' });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls.every((c) => c.url === BASE)).toBe(true);
    expect(calls.every((c) => c.headers.get('authorization') === 'Bearer tok')).toBe(true);
    expect(calls[1]!.headers.get('content-type')).toBe('application/json');
    expect(calls[1]!.body).toEqual({
      name: 'Friends',
      decision: 'allow',
      include: [{ email: { email: 'dan@x.com' } }, { email: { email: 'ren@x.com' } }],
      exclude: [{ ip: { ip: '1.2.3.4/32' } }],
      require: [{ everyone: {} }],
    });
    const body = (await res.json()) as { email: string; alreadyAllowed: boolean };
    expect(body).toMatchObject({ email: 'ren@x.com', alreadyAllowed: false });
    expect(await invitesCount()).toBe(1);
  });

  it('email already in include (different case): no PUT, alreadyAllowed true', async () => {
    const calls = stubCf(policy([{ email: { email: 'Ren@X.com' } }]));
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { alreadyAllowed: boolean }).alreadyAllowed).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('rejects a bad email with 400 and no Cloudflare call', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const email of ['not an email', '', 5, `${'a'.repeat(250)}@x.co`]) {
      expect((await as(ADMIN, '/api/admin/invites', 'POST', { email })).status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('Cloudflare 403 -> 502 with its message, nothing recorded', async () => {
    stubCf(cfError);
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'cloudflare', message: 'Authentication error' });
    expect(await invitesCount()).toBe(0);
  });

  it('a failing PUT -> 502 and nothing recorded', async () => {
    stubCf(policy([]), cfError);
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    expect(res.status).toBe(502);
    expect(await invitesCount()).toBe(0);
  });

  it('HTTP 200 with success:false is a failure too', async () => {
    stubCf({ success: false, errors: [{ message: 'Nope' }] });
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toBe('Nope');
  });

  it('timeout -> 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('cloudflare');
    expect(await invitesCount()).toBe(0);
  });

  it('missing CF_API_TOKEN (or ids) -> 503 not_configured', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const over of [{ CF_API_TOKEN: '' }, { CF_ACCOUNT_ID: '' }, { ACCESS_POLICY_ID: undefined }]) {
      const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' }, over);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_configured' });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("link is <origin>/add/<admin's code>", async () => {
    stubCf(policy([]));
    const res = await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    const { link } = (await res.json()) as { link: string };
    const code = (await env.DB.prepare('SELECT invite_code FROM users WHERE email = ?').bind(ADMIN).first<{ invite_code: string }>())!.invite_code;
    expect(code).toMatch(/^[a-z0-9]{12}$/);
    expect(link).toBe(`https://app.test/add/${code}`);
  });
});

describe('DELETE /api/admin/invites/:email', () => {
  it('drops the matching rule (case-insensitive): GET then PUT without it, deletes the invites row', async () => {
    await env.DB.prepare('INSERT INTO invites (email, created_at) VALUES (?, ?)').bind('ren@x.com', '2026-11-16T10:00:00Z').run();
    const calls = stubCf(policy([{ email: { email: 'dan@x.com' } }, { email: { email: 'Ren@X.com' } }, { email_domain: { domain: 'x.org' } }]));
    const res = await as(ADMIN, '/api/admin/invites/Ren%40x.com', 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer tok');
    expect(calls[1]!.body).toEqual({
      name: 'Friends',
      decision: 'allow',
      include: [{ email: { email: 'dan@x.com' } }, { email_domain: { domain: 'x.org' } }],
      exclude: [{ ip: { ip: '1.2.3.4/32' } }],
      require: [{ everyone: {} }],
    });
    expect(await invitesCount()).toBe(0);
  });

  it('absent from the policy: no PUT, removed false, invites row still deleted', async () => {
    await env.DB.prepare('INSERT INTO invites (email, created_at) VALUES (?, ?)').bind('ren@x.com', '2026-11-16T10:00:00Z').run();
    const calls = stubCf(policy([{ email: { email: 'dan@x.com' } }]));
    const res = await as(ADMIN, '/api/admin/invites/ren%40x.com', 'DELETE');
    expect(await res.json()).toEqual({ removed: false });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(await invitesCount()).toBe(0);
  });

  it('refuses to empty include: 400 last_rule, no PUT, row kept', async () => {
    await env.DB.prepare('INSERT INTO invites (email, created_at) VALUES (?, ?)').bind('ren@x.com', '2026-11-16T10:00:00Z').run();
    const calls = stubCf(policy([{ email: { email: 'ren@x.com' } }]));
    const res = await as(ADMIN, '/api/admin/invites/ren%40x.com', 'DELETE');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'last_rule' });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(await invitesCount()).toBe(1);
  });

  it("refuses the admin's own email: 400 self, Cloudflare never called", async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await as(ADMIN, '/api/admin/invites/DAN%40x.com', 'DELETE');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'self' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('Cloudflare error -> 502 and the invites row stays', async () => {
    await env.DB.prepare('INSERT INTO invites (email, created_at) VALUES (?, ?)').bind('ren@x.com', '2026-11-16T10:00:00Z').run();
    stubCf(cfError);
    const res = await as(ADMIN, '/api/admin/invites/ren%40x.com', 'DELETE');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'cloudflare', message: 'Authentication error' });
    expect(await invitesCount()).toBe(1);
  });

  it('failing PUT -> 502 and the invites row stays', async () => {
    await env.DB.prepare('INSERT INTO invites (email, created_at) VALUES (?, ?)').bind('ren@x.com', '2026-11-16T10:00:00Z').run();
    stubCf(policy([{ email: { email: 'dan@x.com' } }, { email: { email: 'ren@x.com' } }]), cfError);
    expect((await as(ADMIN, '/api/admin/invites/ren%40x.com', 'DELETE')).status).toBe(502);
    expect(await invitesCount()).toBe(1);
  });

  it('bad email -> 400; missing config -> 503; user data is not deleted', async () => {
    expect((await as(ADMIN, '/api/admin/invites/nope', 'DELETE')).status).toBe(400);
    expect((await as(ADMIN, '/api/admin/invites/ren%40x.com', 'DELETE', undefined, { CF_API_TOKEN: '' })).status).toBe(503);
    await as('ren@x.com', '/api/me'); // creates Ren
    stubCf(policy([{ email: { email: 'dan@x.com' } }, { email: { email: 'ren@x.com' } }]));
    await as(ADMIN, '/api/admin/invites/ren%40x.com', 'DELETE');
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'ren@x.com'").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});

describe('GET /api/admin', () => {
  it('lists invites with the joined user once that email signs in; seats.used counts users', async () => {
    await as(ADMIN, '/api/me'); // admin user
    const calls = stubCf(policy([]));
    await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    await as(ADMIN, '/api/admin/invites', 'POST', { email: 'vance@x.com' });
    expect(calls.length).toBeGreaterThan(0);

    let body = (await (await as(ADMIN, '/api/admin')).json()) as {
      seats: { used: number; total: number };
      invites: { email: string; invitedAt: string; joined: { username: string } | null }[];
      users: { email: string; joinedAt: string | null }[];
    };
    expect(body.seats).toEqual({ used: 1, total: 50 });
    expect(body.invites.map((i) => i.email).sort()).toEqual(['ren@x.com', 'vance@x.com']);
    expect(body.invites.every((i) => i.joined === null && typeof i.invitedAt === 'string')).toBe(true);

    await as('ren@x.com', '/api/me');
    await as('ren@x.com', '/api/me/username', 'PUT', { username: 'ren' });
    body = (await (await as(ADMIN, '/api/admin')).json()) as typeof body;
    expect(body.seats.used).toBe(2);
    expect(body.invites.find((i) => i.email === 'ren@x.com')!.joined).toMatchObject({ username: 'ren' });
    expect(body.invites.find((i) => i.email === 'vance@x.com')!.joined).toBeNull();
    expect(body.users.map((u) => u.email).sort()).toEqual([ADMIN, 'ren@x.com']);
    expect(body.users[0]).toHaveProperty('joinedAt');
  });

  it('a removed person drops out of users and seats; approving again brings them back', async () => {
    await as(ADMIN, '/api/me');
    await as('ren@x.com', '/api/me');
    stubCf(policy([{ email: { email: ADMIN } }, { email: { email: 'ren@x.com' } }]));
    expect((await as(ADMIN, '/api/admin/invites/ren@x.com', 'DELETE')).status).toBe(200);
    let body = (await (await as(ADMIN, '/api/admin')).json()) as { seats: { used: number }; users: { email: string }[] };
    expect(body.seats.used).toBe(1);
    expect(body.users.map((u) => u.email)).toEqual([ADMIN]);
    vi.restoreAllMocks();
    stubCf(policy([{ email: { email: ADMIN } }]));
    await as(ADMIN, '/api/admin/invites', 'POST', { email: 'ren@x.com' });
    body = (await (await as(ADMIN, '/api/admin')).json()) as typeof body;
    expect(body.seats.used).toBe(2);
  });
});
