import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { app } from '../src/index';
import type { Env } from '../src/env';

const TEAM = 'team.example.cloudflareaccess.com';
const AUD = 'test-aud-tag';
const KID = 'test-key';

const call = (path: string, overrides: Partial<Env> = {}, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`https://app.test${path}`, { headers }), { ...env, ...overrides } as Env);

const prod: Partial<Env> = { ENVIRONMENT: 'prod', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

let goodKey: CryptoKeyPair;
let wrongKey: CryptoKeyPair;

async function sign(key: CryptoKey, claims: Record<string, unknown> = { email: 'dan@example.com' }, opts: { iss?: string; aud?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

beforeAll(async () => {
  goodKey = (await generateKeyPair('RS256', { extractable: true })) as CryptoKeyPair;
  wrongKey = (await generateKeyPair('RS256', { extractable: true })) as CryptoKeyPair;
  const jwk: JWK = { ...(await exportJWK(goodKey.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  const realFetch = globalThis.fetch;
  // The Worker runs in the same isolate as the tests, so a global stub also
  // serves the Access certs URL to the Worker's jose JWKS fetch.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new Request(input as RequestInfo).url;
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return realFetch(input, init);
  });
});

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('GET /api/health', () => {
  it('is public', async () => {
    const res = await call('/api/health', prod);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/auth/reauth', () => {
  it('redirects to / with no auth and returns no data', async () => {
    const res = await call('/api/auth/reauth', prod);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type') ?? '').not.toContain('json');
    expect(await res.text()).toBe('');
    const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(users?.n).toBe(0);
  });
});

describe('dev bypass', () => {
  it('signs in DEV_EMAIL in dev and makes the admin email an admin', async () => {
    const res = await call('/api/me', { ENVIRONMENT: 'dev', DEV_EMAIL: 'dan@example.com', ADMIN_EMAIL: 'dan@example.com' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ email: 'dan@example.com', username: null, isAdmin: true });
    expect(body.settings).toMatchObject({ theme: 'Midnight' });
    const row = await env.DB.prepare('SELECT is_admin FROM users WHERE email = ?').bind('dan@example.com').first<{ is_admin: number }>();
    expect(row?.is_admin).toBe(1);
  });

  it('does not make other users admins, and does not duplicate rows on repeat sign-in', async () => {
    const o = { ENVIRONMENT: 'dev', DEV_EMAIL: 'friend@example.com', ADMIN_EMAIL: 'dan@example.com' } as const;
    expect(((await (await call('/api/me', o)).json()) as { isAdmin: boolean }).isAdmin).toBe(false);
    await call('/api/me', o);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('fills in defaults for settings keys missing from an older row', async () => {
    await env.DB.prepare("INSERT INTO users (id, email, settings_json, is_admin, created_at) VALUES ('u1', 'old@example.com', '{\"theme\":\"Sunset\"}', 0, 'x')").run();
    const res = await call('/api/me', { ENVIRONMENT: 'dev', DEV_EMAIL: 'old@example.com' });
    const { settings } = (await res.json()) as { settings: Record<string, unknown> };
    expect(settings.theme).toBe('Sunset');
    expect(settings.compareWindow).toBe(1);
  });

  it('is ignored in prod', async () => {
    const res = await call('/api/me', { ...prod, DEV_EMAIL: 'dan@example.com' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

describe('Access JWT', () => {
  it('401 with no header in prod', async () => {
    const res = await call('/api/me', prod);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('accepts a correctly signed token', async () => {
    const token = await sign(goodKey.privateKey);
    const res = await call('/api/me', prod, { 'Cf-Access-Jwt-Assertion': token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'dan@example.com', isAdmin: false });
  });

  it('rejects a token signed by the wrong key', async () => {
    const token = await sign(wrongKey.privateKey);
    expect((await call('/api/me', prod, { 'Cf-Access-Jwt-Assertion': token })).status).toBe(401);
  });

  it('rejects the wrong audience and the wrong issuer', async () => {
    const badAud = await sign(goodKey.privateKey, undefined, { aud: 'other' });
    const badIss = await sign(goodKey.privateKey, undefined, { iss: 'https://evil.example.com' });
    expect((await call('/api/me', prod, { 'Cf-Access-Jwt-Assertion': badAud })).status).toBe(401);
    expect((await call('/api/me', prod, { 'Cf-Access-Jwt-Assertion': badIss })).status).toBe(401);
  });

  it('rejects a valid token that has no email claim', async () => {
    const token = await sign(goodKey.privateKey, { sub: 'service-token' });
    expect((await call('/api/me', prod, { 'Cf-Access-Jwt-Assertion': token })).status).toBe(401);
  });
});

describe('Access JWT hardening', () => {
  const send = (token: string, overrides: Partial<Env> = prod) => call('/api/me', overrides, { 'Cf-Access-Jwt-Assertion': token });

  it('rejects an HS256 token (algorithm pinned to RS256)', async () => {
    const token = await new SignJWT({ email: 'dan@example.com' })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-of-sufficient-length-1234'));
    expect((await send(token)).status).toBe(401);
  });

  it('rejects a correctly signed token that has no exp', async () => {
    const token = await new SignJWT({ email: 'dan@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: KID }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt()
      .sign(goodKey.privateKey);
    expect((await send(token)).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ email: 'dan@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: KID }).setIssuer(`https://${TEAM}`).setAudience(AUD)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(goodKey.privateKey);
    expect((await send(token)).status).toBe(401);
  });

  it('prod with an empty ACCESS_AUD or ACCESS_TEAM_DOMAIN refuses even a valid-looking token', async () => {
    const token = await sign(goodKey.privateKey);
    expect((await send(token, { ...prod, ACCESS_AUD: '' })).status).toBe(401);
    expect((await send(token, { ...prod, ACCESS_TEAM_DOMAIN: '' })).status).toBe(401);
    const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(users?.n).toBe(0);
  });

  it('ENVIRONMENT unset plus DEV_EMAIL does not bypass auth', async () => {
    const res = await call('/api/me', { ENVIRONMENT: undefined, DEV_EMAIL: 'dan@example.com', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as Partial<Env>);
    expect(res.status).toBe(401);
  });

  it('unknown /api paths, a trailing slash, HEAD and OPTIONS are all 401 when unauthenticated', async () => {
    expect((await call('/api/nope', prod)).status).toBe(401);
    expect((await call('/api/me/', prod)).status).toBe(401);
    for (const method of ['HEAD', 'OPTIONS']) {
      const res = await app.fetch(new Request('https://app.test/api/me', { method }), { ...env, ...prod } as Env);
      expect(res.status).toBe(401);
    }
  });
});

describe('CSRF hardening on mutations', () => {
  const dev = { ENVIRONMENT: 'dev', DEV_EMAIL: 'dan@example.com' } as const;
  const mutate = (method: string, path: string, headers: Record<string, string>, body?: string) =>
    app.fetch(new Request(`https://app.test${path}`, { method, headers, body }), { ...env, ...dev } as Env);

  it.each(['POST', 'PUT', 'PATCH'])('%s with a non-JSON content type is 415 (text/plain, form, none)', async (method) => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await mutate(method, '/api/me/username', { 'Content-Type': type }, '{"username":"dan"}');
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: 'unsupported_media_type' });
    }
    expect((await mutate(method, '/api/me/username', {})).status).toBe(415);
  });

  it('a DELETE with a non-JSON content type is 415', async () => {
    const res = await mutate('DELETE', '/api/entries/x', { 'Content-Type': 'text/plain' }, 'x');
    expect(res.status).toBe(415);
  });

  it('Sec-Fetch-Site: cross-site is 403, even with a JSON body and for a bodyless DELETE', async () => {
    const json = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' };
    for (const [method, path] of [['PUT', '/api/me/username'], ['POST', '/api/entries'], ['PATCH', '/api/entries/x'], ['DELETE', '/api/entries/x']] as const) {
      const res = await mutate(method, path, json, method === 'DELETE' ? undefined : '{}');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    expect((await mutate('DELETE', '/api/entries/x', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(users?.n).toBe(0);
  });

  it('a bodyless DELETE is allowed with no Sec-Fetch-Site, same-origin or none; same-site needs JSON', async () => {
    for (const site of [undefined, 'same-origin', 'none']) {
      const res = await mutate('DELETE', '/api/entries/nope', site ? { 'Sec-Fetch-Site': site } : {});
      expect(res.status).toBe(404); // got past the guard to the handler
    }
    expect((await mutate('DELETE', '/api/entries/nope', { 'Sec-Fetch-Site': 'same-site' })).status).toBe(415);
  });

  it('the web client\'s calls (same-origin, JSON, with charset too) still pass', async () => {
    const same = { 'Sec-Fetch-Site': 'same-origin' };
    const put = await mutate('PUT', '/api/me/username', { ...same, 'Content-Type': 'application/json' }, '{"username":"dandan"}');
    expect(put.status).toBe(200);
    const patch = await mutate('PUT', '/api/me/settings', { ...same, 'Content-Type': 'application/json; charset=utf-8' }, '{"theme":"Sunset"}');
    expect(patch.status).not.toBe(415);
    expect(patch.status).not.toBe(403);
    const del = await mutate('DELETE', '/api/entries/nope', { ...same, 'Content-Type': 'application/json' });
    expect(del.status).toBe(404);
  });

  it('GET, HEAD and OPTIONS are never blocked by the guard', async () => {
    const res = await app.fetch(new Request('https://app.test/api/me', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), { ...env, ...dev } as Env);
    expect(res.status).toBe(200);
  });
});

describe('routing', () => {
  it('falls back to assets for non-API paths', async () => {
    const res = await call('/anything', prod);
    expect(await res.text()).toBe('asset-stub');
  });

  it('404 JSON for unknown API paths when signed in', async () => {
    const res = await call('/api/nope', { ENVIRONMENT: 'dev', DEV_EMAIL: 'dan@example.com' });
    expect(res.status).toBe(404);
  });
});
