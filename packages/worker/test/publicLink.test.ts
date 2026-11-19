import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { spyD1 } from './d1spy';

// Phase 5 item 34: the public profile link (/p/<token>).
const B = 'b@example.com'; // owner
const A = 'a@example.com'; // another signed-in user

const as = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
/** Nobody signed in: no DEV_EMAIL, no cookie. */
const anon = (path: string, method = 'GET', db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json' } }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'prod', DEV_EMAIL: '' } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const mk = async (email: string, body: Record<string, unknown>) => {
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', ...body });
  expect(res.status).toBe(201);
  return (await json<{ entry: { id: string } }>(res)).entry;
};
const tokenOf = (link: string) => link.split('/p/')[1]!;
const makeLink = async (email = B) => {
  const res = await as(email, '/api/me/public-link', 'POST');
  expect(res.status).toBe(200);
  const { link } = await json<{ link: string }>(res);
  return tokenOf(link);
};

const FORBIDDEN = ['strength', 'priorMean', 'scoreLocked', 'comparisons', 'isPrivate', 'notesPrivate', 'email', 'settings', 'public_token_hash', 'publicTokenHash', 'inviteCode'];
const expectClean = (text: string) => {
  for (const k of FORBIDDEN) expect(text, k).not.toContain(`"${k}"`);
};

let pub: { id: string };
let priv: { id: string };
let privNotes: { id: string };
const COVER = 'https://img.example.com/c.jpg';
const SECRET_COVER = 'https://img.example.com/secret.jpg';

beforeEach(async () => {
  for (const [email, name] of [[A, 'dan'], [B, 'ren']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  expect((await as(B, '/api/me/bio', 'PUT', { bio: 'I like anime' })).status).toBe(200);
  pub = await mk(B, { title: 'Public', rating: 8, notes: 'my notes', coverUrl: COVER });
  priv = await mk(B, { title: 'Hidden', rating: 9, isPrivate: true, notes: 'hidden notes', coverUrl: SECRET_COVER });
  privNotes = await mk(B, { title: 'QuietNotes', rating: 7, notes: 'secret notes', notesPrivate: true });
  await mk(B, { title: 'MovieOne', category: 'movies', rating: 6 });
  await mk(A, { title: 'NotRens', rating: 5 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec('DELETE FROM users');
});

describe('/api/me/public-link (signed in)', () => {
  it('is off by default, and on after POST without ever showing the link again', async () => {
    expect(await json(await as(B, '/api/me/public-link'))).toEqual({ on: false });
    const res = await as(B, '/api/me/public-link', 'POST');
    expect(res.status).toBe(200);
    const { link } = await json<{ link: string }>(res);
    expect(link).toMatch(/^https:\/\/app\.test\/p\/[A-Za-z0-9_-]{22}$/);
    // Only the hash is stored: later reads say it is on, but cannot give the link back.
    expect(await json(await as(B, '/api/me/public-link'))).toEqual({ on: true });
    const row = await env.DB.prepare("SELECT public_token_hash, public_link_at FROM users WHERE username = 'ren'").first<{ public_token_hash: string; public_link_at: string }>();
    expect(row!.public_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.public_token_hash).not.toContain(tokenOf(link));
    expect(row!.public_link_at).toBeTruthy();
  });

  it('a new link replaces the old one, and DELETE turns it off', async () => {
    const first = await makeLink();
    const second = await makeLink();
    expect(second).not.toBe(first);
    expect((await anon(`/api/public/${first}`)).status).toBe(404);
    expect((await anon(`/api/public/${second}`)).status).toBe(200);
    expect((await as(B, '/api/me/public-link', 'DELETE')).status).toBe(204);
    expect(await json(await as(B, '/api/me/public-link'))).toEqual({ on: false });
    expect((await anon(`/api/public/${second}`)).status).toBe(404);
  });

  it('needs sign-in', async () => {
    expect((await anon('/api/me/public-link')).status).toBe(401);
    expect((await anon('/api/me/public-link', 'POST')).status).toBe(401);
  });
});

describe('GET /api/public/:token (no sign-in)', () => {
  it('gives the header, bio and counts, never anything private; 1 query', async () => {
    const token = await makeLink();
    const spy = spyD1(env.DB);
    const res = await anon(`/api/public/${token}`, 'GET', spy.db);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(spy.queries).toBe(1);
    const text = await res.text();
    expectClean(text);
    const body = JSON.parse(text);
    expect(body.user).toMatchObject({ username: 'ren', displayName: null, avatarAt: null });
    expect(body.bio).toBe('I like anime');
    expect(body.counts).toEqual({ titles: 3, rated: 3 });
    expect(Object.keys(body).sort()).toEqual(['bio', 'counts', 'memberSince', 'user']);
    expect(Object.keys(body.user).sort()).toEqual(['avatarAt', 'displayName', 'id', 'username']);
  });

  it('entries: non-private only, notes only when not private, friend shape only; 1 query', async () => {
    const token = await makeLink();
    const spy = spyD1(env.DB);
    const res = await anon(`/api/public/${token}/entries`, 'GET', spy.db);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(spy.queries).toBe(1);
    const text = await res.text();
    expectClean(text);
    for (const s of ['Hidden', 'hidden notes', 'secret notes', SECRET_COVER, priv.id, 'NotRens']) expect(text, s).not.toContain(s);
    const list = JSON.parse(text) as { id: string; title: string; notes: string | null }[];
    expect(list.map((e) => e.title).sort()).toEqual(['MovieOne', 'Public', 'QuietNotes']);
    expect(list.find((e) => e.id === pub.id)!.notes).toBe('my notes');
    expect(list.find((e) => e.id === privNotes.id)!.notes).toBeNull();
  });

  it('unknown, malformed, replaced and turned-off tokens are all 404', async () => {
    const token = await makeLink();
    const unknown = 'A'.repeat(22);
    for (const t of [unknown, 'short', `${token}x`]) {
      expect((await anon(`/api/public/${t}`)).status).toBe(404);
      expect((await anon(`/api/public/${t}/entries`)).status).toBe(404);
      expect((await anon(`/api/public/${t}/avatar`)).status).toBe(404);
      expect((await anon(`/api/public/${t}/cover/${pub.id}`)).status).toBe(404);
    }
    await as(B, '/api/me/public-link', 'DELETE');
    expect((await anon(`/api/public/${token}`)).status).toBe(404);
    expect((await anon(`/api/public/${token}/entries`)).status).toBe(404);
  });

  it('a removed or pending user\'s link is 404', async () => {
    const token = await makeLink();
    for (const status of ['removed', 'pending']) {
      await env.DB.prepare("UPDATE users SET status = ? WHERE username = 'ren'").bind(status).run();
      expect((await anon(`/api/public/${token}`)).status, status).toBe(404);
      expect((await anon(`/api/public/${token}/entries`)).status, status).toBe(404);
      expect((await anon(`/api/public/${token}/avatar`)).status, status).toBe(404);
      expect((await anon(`/api/public/${token}/cover/${pub.id}`)).status, status).toBe(404);
    }
  });

  it('has no write methods: every non-GET is refused and changes nothing', async () => {
    const token = await makeLink();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of [`/api/public/${token}`, `/api/public/${token}/entries`, `/api/public/${token}/avatar`]) {
        const res = await as(A, path, method, {});
        expect(res.status, `${method} ${path}`).toBe(405);
      }
    }
    expect((await anon(`/api/public/${token}`)).status).toBe(200);
  });

  it('someone with no shared titles gets an empty list, not a 404', async () => {
    const token = await makeLink(A);
    await env.DB.prepare("UPDATE entries SET is_private = 1 WHERE user_id = (SELECT id FROM users WHERE username = 'dan')").run();
    const res = await anon(`/api/public/${token}/entries`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });

  it('works for a signed-in visitor too (the same answer)', async () => {
    const token = await makeLink();
    const res = await as(A, `/api/public/${token}/entries`);
    expect(res.status).toBe(200);
    expect((await json<unknown[]>(res)).length).toBe(3);
  });
});

describe('GET /api/public/:token/avatar and /cover/:entryId', () => {
  it('serves the photo when there is one, 404 when not', async () => {
    const token = await makeLink();
    expect((await anon(`/api/public/${token}/avatar`)).status).toBe(404);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO avatars (user_id, mime, data, updated_at) SELECT id, 'image/png', x'89504e47', 'x' FROM users WHERE username = 'ren'"),
      env.DB.prepare("UPDATE users SET avatar_at = 'x' WHERE username = 'ren'"),
    ]);
    const spy = spyD1(env.DB);
    const res = await anon(`/api/public/${token}/avatar`, 'GET', spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(1);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("proxies a public entry's cover, never a private entry's or someone else's", async () => {
    const token = await makeLink();
    const other = await mk(A, { title: 'Theirs', coverUrl: COVER });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }))) as typeof fetch);
    const spy = spyD1(env.DB);
    const ok = await anon(`/api/public/${token}/cover/${pub.id}`, 'GET', spy.db);
    expect(ok.status).toBe(200);
    expect(spy.queries).toBe(1);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(COVER);
    fetchSpy.mockClear();
    expect((await anon(`/api/public/${token}/cover/${priv.id}`)).status).toBe(404);
    expect((await anon(`/api/public/${token}/cover/${other.id}`)).status).toBe(404);
    expect((await anon(`/api/public/${token}/cover/${privNotes.id}`)).status).toBe(404); // no cover
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
