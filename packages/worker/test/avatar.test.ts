import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { AVATAR_MAX_BYTES, decodeAvatar } from '@media-tracker/shared';

const A = 'a@example.com';
const B = 'b@example.com';

const call = (email: string, path: string, method = 'GET', body?: unknown, raw?: string) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const webp = (extra = 20) => {
  const out = new Uint8Array(12 + extra);
  out.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  for (let i = 12; i < out.length; i++) out[i] = i & 0xff;
  return out;
};
const jpeg = (extra = 20) => {
  const out = new Uint8Array(3 + extra);
  out.set([0xff, 0xd8, 0xff]);
  for (let i = 3; i < out.length; i++) out[i] = (i * 7) & 0xff;
  return out;
};
const put = (email: string, type: string, bytes: Uint8Array) => call(email, '/api/me/avatar', 'PUT', { type, data: b64(bytes) });

type MeJson = { avatarAt: string | null; createdAt: string | null; username: string | null };

afterEach(async () => {
  await env.DB.exec('DELETE FROM users'); // cascades to avatars
});

describe('GET /api/me', () => {
  it('includes avatarAt null and createdAt', async () => {
    const me = (await (await call(A, '/api/me')).json()) as MeJson;
    expect(me.avatarAt).toBeNull();
    expect(typeof me.createdAt).toBe('string');
  });
});

describe('PUT /api/me/avatar', () => {
  it('stores a small WebP and serves the same bytes with immutable caching', async () => {
    const bytes = webp();
    const res = await put(A, 'image/webp', bytes);
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeJson;
    expect(me.avatarAt).not.toBeNull();
    expect(((await (await call(A, '/api/me')).json()) as MeJson).avatarAt).toBe(me.avatarAt);

    const got = await call(A, `/api/me/avatar?v=${me.avatarAt}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/webp');
    expect(got.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it('accepts a JPEG', async () => {
    const bytes = jpeg();
    expect((await put(A, 'image/jpeg', bytes)).status).toBe(200);
    const got = await call(A, '/api/me/avatar');
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it('refuses PNG, mismatched type and magic, bad base64 and 65,537 bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    for (const type of ['image/png', 'image/webp', 'image/jpeg']) {
      expect((await put(A, type, png)).status).toBe(400);
    }
    expect((await put(A, 'image/jpeg', webp())).status).toBe(400);
    expect((await put(A, 'image/webp', jpeg())).status).toBe(400);
    for (const data of ['not base64!!', '@@@@', 'abc', '', 123, null]) {
      expect((await call(A, '/api/me/avatar', 'PUT', { type: 'image/webp', data })).status).toBe(400);
    }
    expect((await call(A, '/api/me/avatar', 'PUT', { data: b64(webp()) })).status).toBe(400);
    expect((await call(A, '/api/me/avatar', 'PUT', undefined, 'not json')).status).toBe(400);
    expect((await put(A, 'image/webp', webp(AVATAR_MAX_BYTES + 1 - 12))).status).toBe(400);
    expect(((await (await call(A, '/api/me')).json()) as MeJson).avatarAt).toBeNull();
  });

  it('accepts exactly 65,536 bytes', async () => {
    expect((await put(A, 'image/webp', webp(AVATAR_MAX_BYTES - 12))).status).toBe(200);
  });

  it('PUT twice keeps one row and a newer avatarAt', async () => {
    const first = (await (await put(A, 'image/webp', webp())).json()) as MeJson;
    const second = (await (await put(A, 'image/jpeg', jpeg())).json()) as MeJson;
    expect(second.avatarAt! > first.avatarAt!).toBe(true);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM avatars').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('is refused cross-site and without JSON', async () => {
    const res = await app.fetch(
      new Request('https://app.test/api/me/avatar', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({ type: 'image/webp', data: b64(webp()) }),
      }),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
    expect(res.status).toBe(403);
    const form = await app.fetch(
      new Request('https://app.test/api/me/avatar', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}' }),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
    expect(form.status).toBe(415);
  });
});

describe('PUT /api/me/avatar body size', () => {
  const send = (headers: Record<string, string>, body: string) =>
    app.fetch(
      new Request('https://app.test/api/me/avatar', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body }),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );

  it('refuses a declared content-length over the cap before reading the body', async () => {
    const res = await send({ 'content-length': '5000000' }, '{}');
    expect(res.status).toBe(400);
  });

  it('refuses an oversized body that sends no or a false content-length', async () => {
    const big = JSON.stringify({ type: 'image/webp', data: 'A'.repeat(300_000) });
    expect((await send({}, big)).status).toBe(400);
  });

  it('does not parse an oversized body (not even to find it invalid JSON)', async () => {
    const spy = vi.spyOn(Request.prototype, 'json');
    await send({}, 'x'.repeat(300_000));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still accepts a maximum-size photo', async () => {
    expect((await put(A, 'image/webp', webp(AVATAR_MAX_BYTES - 12))).status).toBe(200);
  });
});

describe('DELETE and isolation', () => {
  it('DELETE clears avatarAt and GET avatar then 404s', async () => {
    await put(A, 'image/webp', webp());
    const res = await call(A, '/api/me/avatar', 'DELETE');
    expect(res.status).toBe(200);
    expect(((await res.json()) as MeJson).avatarAt).toBeNull();
    expect((await call(A, '/api/me/avatar')).status).toBe(404);
  });

  it("B can't read A's photo", async () => {
    const bytes = webp(40);
    await put(A, 'image/webp', bytes);
    expect((await call(B, '/api/me/avatar')).status).toBe(404);
    expect(((await (await call(B, '/api/me')).json()) as MeJson).avatarAt).toBeNull();
    await put(B, 'image/jpeg', jpeg());
    expect(new Uint8Array(await (await call(A, '/api/me/avatar')).arrayBuffer())).toEqual(bytes);
  });

  it('requires sign-in', async () => {
    const res = await app.fetch(new Request('https://app.test/api/me/avatar'), { ...env, ENVIRONMENT: 'prod' } as Env);
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/me/username', () => {
  it('carries avatarAt and createdAt', async () => {
    await put(A, 'image/webp', webp());
    const res = await call(A, '/api/me/username', 'PUT', { username: 'dan_r' });
    const me = (await res.json()) as MeJson;
    expect(me.username).toBe('dan_r');
    expect(me.avatarAt).not.toBeNull();
    expect(me.createdAt).not.toBeNull();
  });
});

describe('decodeAvatar', () => {
  it('returns null for non-objects', () => {
    for (const v of [null, undefined, 'x', 3, [], {}]) expect(decodeAvatar(v)).toBeNull();
  });
});
