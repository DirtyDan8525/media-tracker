import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { spyD1 } from './d1spy';

const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown, db?: D1Database) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const json = async <T = any>(res: Response) => (await res.json()) as T;
const uid = async (email: string) => (await json<{ id: string }>(await as(email, '/api/me'))).id;
const setName = async (email: string, username: string) => expect((await as(email, '/api/me/username', 'PUT', { username })).status).toBe(200);
const friendsOf = async (email: string) => json<{ friends: { username: string; since: string }[]; incoming: { username: string }[]; outgoing: { username: string }[] }>(await as(email, '/api/friends'));
const befriend = async () => {
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  const id = await uid(A);
  expect((await as(B, `/api/friends/${id}/accept`, 'POST')).status).toBe(204);
};

beforeEach(async () => {
  await setName(A, 'dan');
  await setName(B, 'ren');
  await setName(C, 'rex');
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('friend requests', () => {
  it('a username request creates pending; the other side requesting makes it accepted', async () => {
    const res = await as(A, '/api/friends/requests', 'POST', { username: 'Ren' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ relation: 'pending_out' });
    expect((await friendsOf(A)).outgoing.map((u) => u.username)).toEqual(['ren']);
    expect((await friendsOf(B)).incoming.map((u) => u.username)).toEqual(['dan']);
    expect((await friendsOf(A)).friends).toEqual([]);
    // asking again changes nothing
    expect(await json(await as(A, '/api/friends/requests', 'POST', { username: 'ren' }))).toEqual({ relation: 'pending_out' });
    const crossing = await as(B, '/api/friends/requests', 'POST', { username: 'dan' });
    expect(await json(crossing)).toEqual({ relation: 'friend' });
    const fa = await friendsOf(A);
    expect(fa.friends.map((u) => u.username)).toEqual(['ren']);
    expect(fa.friends[0]!.since).toMatch(/^\d{4}-/);
    expect(fa.outgoing).toEqual([]);
    expect((await friendsOf(B)).friends.map((u) => u.username)).toEqual(['dan']);
  });

  it('self is 400, unknown is 404, an existing friend is 409', async () => {
    const self = await as(A, '/api/friends/requests', 'POST', { username: 'dan' });
    expect(self.status).toBe(400);
    expect(await json(self)).toEqual({ error: 'self' });
    expect((await as(A, '/api/friends/requests', 'POST', { username: 'nobody' })).status).toBe(404);
    expect((await as(A, '/api/friends/requests', 'POST', {})).status).toBe(400);
    await befriend();
    const again = await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual({ error: 'already_friends' });
  });

  it('accept only works for the receiver', async () => {
    await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
    const [a, b] = [await uid(A), await uid(B)];
    expect((await as(A, `/api/friends/${b}/accept`, 'POST')).status).toBe(404); // requester
    expect((await as(C, `/api/friends/${a}/accept`, 'POST')).status).toBe(404); // no request at all
    expect((await friendsOf(A)).friends).toEqual([]);
    expect((await as(B, `/api/friends/${a}/accept`, 'POST')).status).toBe(204);
    expect((await friendsOf(A)).friends.map((u) => u.username)).toEqual(['ren']);
  });

  it('DELETE by either side removes the row; a second delete is 404', async () => {
    await befriend();
    const [a, b] = [await uid(A), await uid(B)];
    expect((await as(B, `/api/friends/${a}`, 'DELETE')).status).toBe(204);
    for (const e of [A, B]) expect(await friendsOf(e)).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect((await as(A, `/api/friends/${b}`, 'DELETE')).status).toBe(404);
    // cancel and decline too
    await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
    expect((await as(A, `/api/friends/${b}`, 'DELETE')).status).toBe(204);
    await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
    expect((await as(B, `/api/friends/${a}`, 'DELETE')).status).toBe(204);
    expect((await friendsOf(B)).incoming).toEqual([]);
  });
});

describe('invite codes', () => {
  it('is 12 chars [a-z0-9], stable across GETs; POST changes it; the old code is 404, the new one adds as accepted', async () => {
    const c1 = (await json<{ code: string }>(await as(A, '/api/me/invite'))).code;
    expect(c1).toMatch(/^[a-z0-9]{12}$/);
    expect((await json<{ code: string }>(await as(A, '/api/me/invite'))).code).toBe(c1);
    const c2 = (await json<{ code: string }>(await as(A, '/api/me/invite', 'POST'))).code;
    expect(c2).toMatch(/^[a-z0-9]{12}$/);
    expect(c2).not.toBe(c1);
    expect((await as(B, `/api/friends/code/${c1}`)).status).toBe(404);
    expect((await as(B, `/api/friends/add/${c1}`, 'POST')).status).toBe(404);
    const preview = await as(B, `/api/friends/code/${c2}`);
    expect(preview.status).toBe(200);
    expect(await json(preview)).toMatchObject({ username: 'dan' });
    const added = await as(B, `/api/friends/add/${c2}`, 'POST');
    expect(await json(added)).toMatchObject({ relation: 'friend', user: { username: 'dan' } });
    expect((await friendsOf(A)).friends.map((u) => u.username)).toEqual(['ren']);
    // idempotent, and it also accepts a pending request
    expect((await as(B, `/api/friends/add/${c2}`, 'POST')).status).toBe(200);
  });

  it('adding by a code accepts an existing pending request; garbage codes are 404', async () => {
    await as(B, '/api/friends/requests', 'POST', { username: 'dan' });
    const code = (await json<{ code: string }>(await as(A, '/api/me/invite'))).code;
    expect((await as(B, `/api/friends/add/${code}`, 'POST')).status).toBe(200);
    expect((await friendsOf(A)).friends.map((u) => u.username)).toEqual(['ren']);
    expect((await as(B, '/api/friends/code/NOPE')).status).toBe(404);
  });

  it('your own code is 400 self', async () => {
    const code = (await json<{ code: string }>(await as(A, '/api/me/invite'))).code;
    for (const [path, method] of [[`/api/friends/code/${code}`, 'GET'], [`/api/friends/add/${code}`, 'POST']] as const) {
      const res = await as(A, path, method);
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: 'self' });
    }
  });

  it('ensureInviteCode retries once on a unique clash', async () => {
    const { ensureInviteCode } = await import('../src/social/inviteCode');
    const a = await uid(A);
    const b = await uid(B);
    const first = await ensureInviteCode(env.DB, a);
    // a real clash is astronomically rare; force it: B's code collides once through a stubbed random source
    const real = crypto.getRandomValues.bind(crypto);
    let n = 0;
    crypto.getRandomValues = ((arr: Uint8Array) => {
      if (n++ === 0) { arr.fill(0); for (let i = 0; i < arr.length; i++) arr[i] = first.charCodeAt(i) >= 97 ? first.charCodeAt(i) - 97 : first.charCodeAt(i) - 48 + 26; return arr; }
      return real(arr);
    }) as typeof crypto.getRandomValues;
    try {
      const second = await ensureInviteCode(env.DB, b);
      expect(second).toMatch(/^[a-z0-9]{12}$/);
      expect(second).not.toBe(first);
    } finally {
      crypto.getRandomValues = real;
    }
  });
});

describe('search and profile header', () => {
  it('"re" finds ren and rex but not you; q "r" is 400; max 10, ordered', async () => {
    await setName(A, 'rey');
    const res = await json<{ username: string }[]>(await as(A, '/api/users/search?q=RE'));
    expect(res.map((u) => u.username)).toEqual(['ren', 'rex']);
    expect((await as(A, '/api/users/search?q=r')).status).toBe(400);
    expect((await as(A, '/api/users/search?q=a-b')).status).toBe(400);
    for (let i = 0; i < 12; i++) await as(`u${i}@example.com`, '/api/me/username', 'PUT', { username: `zed${String(i).padStart(2, '0')}` });
    const many = await json<unknown[]>(await as(A, '/api/users/search?q=ze'));
    expect(many).toHaveLength(10);
  });

  it('a stranger sees relation none and no entries field', async () => {
    await as(B, '/api/entries', 'POST', { category: 'anime', title: 'Secret', rating: 9 });
    const res = await as(A, '/api/users/ren');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ user: { username: 'ren' }, relation: 'none' });
    expect(Object.keys(body)).toEqual(['user', 'memberSince', 'bio', 'relation']);
    expect(JSON.stringify(body)).not.toContain('Secret');
    expect((await as(A, '/api/users/nobody')).status).toBe(404);
    expect(await json(await as(A, '/api/users/dan'))).toMatchObject({ relation: 'self' });
  });
});

describe('avatars', () => {
  const png = btoa(String.fromCharCode(0xff, 0xd8, 0xff, ...Array.from({ length: 20 }, (_, i) => (i * 7 + 21) & 0xff)));
  it('friend 200, pending 404, stranger 404, self 200', async () => {
    expect((await as(B, '/api/me/avatar', 'PUT', { type: 'image/jpeg', data: png })).status).toBe(200);
    const b = await uid(B);
    expect((await as(A, `/api/users/${b}/avatar`)).status).toBe(404);
    await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
    expect((await as(A, `/api/users/${b}/avatar`)).status).toBe(404); // pending
    await as(B, `/api/friends/${await uid(A)}/accept`, 'POST');
    const ok = await as(A, `/api/users/${b}/avatar`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect((await as(C, `/api/users/${b}/avatar`)).status).toBe(404);
    expect((await as(B, `/api/users/${b}/avatar`)).status).toBe(200);
    await as(A, `/api/friends/${b}`, 'DELETE');
    expect((await as(A, `/api/users/${b}/avatar`)).status).toBe(404); // removed
  });
});

describe('display name', () => {
  it('trims, rejects empty and 41 chars, null clears, shows in /api/me', async () => {
    const ok = await as(A, '/api/me/display-name', 'PUT', { displayName: '  Dan R  ' });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ displayName: 'Dan R', username: 'dan' });
    expect(await json(await as(A, '/api/me'))).toMatchObject({ displayName: 'Dan R' });
    expect((await as(A, '/api/me/display-name', 'PUT', { displayName: 'x'.repeat(41) })).status).toBe(400);
    expect((await as(A, '/api/me/display-name', 'PUT', { displayName: '   ' })).status).toBe(400);
    expect((await as(A, '/api/me/display-name', 'PUT', { displayName: 5 })).status).toBe(400);
    expect((await as(A, '/api/me/display-name', 'PUT', { displayName: 'x'.repeat(40) })).status).toBe(200);
    expect(await json(await as(A, '/api/me/display-name', 'PUT', { displayName: null }))).toMatchObject({ displayName: null });
    // friends see it
    await befriend();
    await as(B, '/api/me/display-name', 'PUT', { displayName: 'Ren' });
    expect((await friendsOf(A)).friends[0]).toMatchObject({ displayName: 'Ren' });
  });
});

describe('query counts (excluding sign-in, which costs 1 for an existing user)', () => {
  it('every route stays at or under 6', async () => {
    await befriend();
    const [a, b] = [await uid(A), await uid(B)];
    const code = (await json<{ code: string }>(await as(B, '/api/me/invite'))).code;
    const cases: [string, string, unknown?][] = [
      ['GET', '/api/friends'],
      ['GET', '/api/users/search?q=re'],
      ['GET', '/api/users/ren'],
      ['GET', `/api/users/${b}/avatar`],
      ['GET', '/api/me/invite'],
      ['POST', '/api/me/invite'],
      ['PUT', '/api/me/display-name', { displayName: 'D' }],
      ['GET', `/api/friends/code/${code}`],
      ['POST', `/api/friends/add/${code}`],
      ['POST', '/api/friends/requests', { username: 'rex' }],
      ['POST', `/api/friends/${a}/accept`],
      ['DELETE', `/api/friends/${b}`],
    ];
    for (const [method, path, body] of cases) {
      const spy = spyD1(env.DB);
      const res = await as(A, path, method, body, spy.db);
      expect(res.status, `${method} ${path}`).toBeLessThan(500);
      expect(spy.queries, `${method} ${path}`).toBeLessThanOrEqual(6);
    }
  });
});
