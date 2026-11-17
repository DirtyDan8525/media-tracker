import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';

const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown, raw?: string) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const putBio = (email: string, bio: unknown) => as(email, '/api/me/bio', 'PUT', { bio });

beforeEach(async () => {
  for (const [e, u] of [[A, 'dan'], [B, 'ren'], [C, 'rex']] as const) expect((await as(e, '/api/me/username', 'PUT', { username: u })).status).toBe(200);
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('PUT /api/me/bio', () => {
  it('saves a trimmed bio with line breaks and emoji, and /api/me returns it', async () => {
    const res = await putBio(A, '  professional anime enjoyer 🍜\nwill fight you over Frieren  ');
    expect(res.status).toBe(200);
    expect((await json(res)).bio).toBe('professional anime enjoyer 🍜\nwill fight you over Frieren');
    expect((await json(await as(A, '/api/me'))).bio).toBe('professional anime enjoyer 🍜\nwill fight you over Frieren');
  });

  it('a user who never set one has bio null', async () => {
    expect((await json(await as(A, '/api/me'))).bio).toBeNull();
  });

  it('an empty bio clears it', async () => {
    await putBio(A, 'hi');
    const res = await putBio(A, '   ');
    expect(res.status).toBe(200);
    expect((await json(res)).bio).toBeNull();
    expect((await json(await as(A, '/api/me'))).bio).toBeNull();
  });

  it('150 characters pass (an emoji counts as one), 151 is 400', async () => {
    expect((await putBio(A, '🍜'.repeat(150))).status).toBe(200);
    const res = await putBio(A, 'a'.repeat(151));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'invalid' });
  });

  it('4 lines pass, 5 lines are 400', async () => {
    expect((await putBio(A, 'a\nb\nc\nd')).status).toBe(200);
    expect((await putBio(A, 'a\nb\nc\nd\ne')).status).toBe(400);
  });

  it('a link is 400 no_links', async () => {
    for (const bio of ['http://example.com', 'see www.example.com', 'my page example.com/me']) {
      const res = await putBio(A, bio);
      expect(res.status, bio).toBe(400);
      expect(await json(res)).toEqual({ error: 'no_links' });
    }
  });

  it('400 for a non-string, a missing field or non-JSON; a failed save keeps the old bio', async () => {
    await putBio(A, 'keep me');
    expect((await putBio(A, 5)).status).toBe(400);
    expect((await as(A, '/api/me/bio', 'PUT', {})).status).toBe(400);
    expect((await as(A, '/api/me/bio', 'PUT', undefined, 'nope')).status).toBe(400);
    expect((await json(await as(A, '/api/me'))).bio).toBe('keep me');
  });
});

describe('a friend profile shows the bio', () => {
  it('to yourself and to a friend, not to a stranger', async () => {
    await putBio(A, 'hello there');
    const idA = (await json(await as(A, '/api/me'))).id;
    await as(B, '/api/friends/requests', 'POST', { username: 'dan' });
    expect((await as(A, `/api/friends/${(await json(await as(B, '/api/me'))).id}/accept`, 'POST')).status).toBe(204);
    expect(idA).toBeTruthy();
    expect((await json(await as(A, '/api/users/dan'))).bio).toBe('hello there');
    expect((await json(await as(B, '/api/users/dan'))).bio).toBe('hello there');
    expect((await json(await as(C, '/api/users/dan'))).bio).toBeNull();
  });

  it('is null for someone with no bio', async () => {
    expect((await json(await as(A, '/api/users/ren'))).bio).toBeNull();
  });
});
