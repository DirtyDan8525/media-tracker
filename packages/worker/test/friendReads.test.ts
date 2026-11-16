import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { spyD1 } from './d1spy';

const A = 'a@example.com'; // viewer
const B = 'b@example.com'; // owner, friend of A
const P = 'p@example.com'; // pending request to B
const S = 's@example.com'; // stranger

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
const mk = async (email: string, body: Record<string, unknown>) => {
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', ...body });
  expect(res.status).toBe(201);
  return (await json<{ entry: { id: string } }>(res)).entry;
};

const FORBIDDEN = ['strength', 'priorMean', 'scoreLocked', 'comparisons', 'isPrivate', 'notesPrivate'];
const expectClean = (body: unknown) => {
  const text = JSON.stringify(body);
  for (const k of FORBIDDEN) expect(text, k).not.toContain(`"${k}"`);
};

let pub: { id: string };
let priv: { id: string };
let privNotes: { id: string };

beforeEach(async () => {
  for (const [email, name] of [[A, 'dan'], [B, 'ren'], [P, 'pat'], [S, 'sam']] as const) {
    expect((await as(email, '/api/me/username', 'PUT', { username: name })).status).toBe(200);
  }
  await as(A, '/api/friends/requests', 'POST', { username: 'ren' });
  await as(B, `/api/friends/${await uid(A)}/accept`, 'POST');
  await as(P, '/api/friends/requests', 'POST', { username: 'ren' }); // pending, never accepted
  pub = await mk(B, { title: 'Public', rating: 8, notes: 'my notes' });
  priv = await mk(B, { title: 'Hidden', rating: 9, isPrivate: true });
  privNotes = await mk(B, { title: 'QuietNotes', rating: 7, notes: 'secret notes', notesPrivate: true });
  await mk(B, { title: 'Unrated' });
  await mk(B, { title: 'MovieOne', category: 'movies', rating: 6 });
  await as(B, `/api/entries/${pub.id}/seasons`, 'POST', { label: 'S1', rating: 8, notes: 'season note' });
  await as(B, `/api/entries/${privNotes.id}/seasons`, 'POST', { label: 'S1', rating: 7, notes: 'season secret' });
});
afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('GET /api/users/:username/entries', () => {
  it('stranger and pending friend get 403 on the list and 404 on an entry', async () => {
    for (const who of [S, P]) {
      const list = await as(who, '/api/users/ren/entries');
      expect(list.status).toBe(403);
      expect(await json(list)).toEqual({ error: 'not_friends' });
      expect((await as(who, `/api/users/ren/entries/${pub.id}`)).status).toBe(404);
    }
    expect((await as(A, '/api/users/nobody/entries')).status).toBe(404);
  });

  it('a friend sees the public ones, without the private entry, and notes null on the private-notes one', async () => {
    const res = await as(A, '/api/users/ren/entries');
    expect(res.status).toBe(200);
    const list = await json<{ title: string; notes: string | null }[]>(res);
    expect(list.map((e) => e.title).sort()).toEqual(['MovieOne', 'Public', 'QuietNotes', 'Unrated']);
    expect(list.find((e) => e.title === 'QuietNotes')!.notes).toBeNull();
    expect(list.find((e) => e.title === 'Public')!.notes).toBe('my notes');
    expectClean(list);
    expect(JSON.stringify(list)).not.toContain('secret notes');
    const anime = await json<{ title: string }[]>(await as(A, '/api/users/ren/entries?category=movies'));
    expect(anime.map((e) => e.title)).toEqual(['MovieOne']);
    expect((await as(A, '/api/users/ren/entries?category=nope')).status).toBe(400);
  });

  it('unfriending cuts the list at once', async () => {
    await as(A, `/api/friends/${await uid(B)}`, 'DELETE');
    expect((await as(A, '/api/users/ren/entries')).status).toBe(403);
    expect((await as(A, `/api/users/ren/entries/${pub.id}`)).status).toBe(404);
  });

  it('you can read your own list through the same route', async () => {
    const mine = await json<{ title: string }[]>(await as(B, '/api/users/ren/entries'));
    expect(mine.map((e) => e.title)).toContain('Hidden');
  });
});

describe('GET /api/users/:username/entries/:id', () => {
  it('returns the entry and its seasons; the private entry is 404; private notes hide season notes too', async () => {
    const ok = await json<{ entry: { title: string; notes: string }; seasons: { label: string; notes: string | null; rating: number }[] }>(
      await as(A, `/api/users/ren/entries/${pub.id}`),
    );
    expect(ok.entry).toMatchObject({ title: 'Public', notes: 'my notes' });
    expect(ok.seasons).toEqual([{ id: expect.any(String), label: 'S1', rating: 8, notes: 'season note' }]);
    expectClean(ok);

    const quiet = await json<{ entry: { notes: string | null }; seasons: { notes: string | null }[] }>(
      await as(A, `/api/users/ren/entries/${privNotes.id}`),
    );
    expect(quiet.entry.notes).toBeNull();
    expect(quiet.seasons[0]!.notes).toBeNull();
    expect(JSON.stringify(quiet)).not.toContain('secret');

    expect((await as(A, `/api/users/ren/entries/${priv.id}`)).status).toBe(404);
    expect((await as(A, '/api/users/ren/entries/no-such-id')).status).toBe(404);
    // an id of someone else's entry under ren's name is not found either
    const mine = await mk(A, { title: 'Mine' });
    expect((await as(A, `/api/users/ren/entries/${mine.id}`)).status).toBe(404);
  });

  it('turning an entry private hides it from friends at once', async () => {
    expect((await as(A, `/api/users/ren/entries/${pub.id}`)).status).toBe(200);
    await as(B, `/api/entries/${pub.id}`, 'PATCH', { isPrivate: true });
    expect((await as(A, `/api/users/ren/entries/${pub.id}`)).status).toBe(404);
  });
});

describe('picks are never readable by friends', () => {
  it('no friend response carries strength, priorMean, scoreLocked or comparisons; B reads only its own set', async () => {
    // A rates two titles and saves picks
    const x = await mk(A, { title: 'AX', rating: 8 });
    const y = await mk(A, { title: 'AY', rating: 7 });
    const save = await as(A, '/api/ratings/anime/save', 'POST', {
      picks: [{ winnerId: x.id, loserId: y.id, isTie: false, undone: false }], moves: [], done: [],
    });
    expect(save.status).toBe(200);
    const aId = await uid(A);
    const bodies = [
      await json(await as(B, '/api/users/dan/entries')),
      await json(await as(B, `/api/users/dan/entries/${x.id}`)),
      await json(await as(B, '/api/users/dan')),
      await json(await as(B, '/api/friends/entries')),
      await json(await as(B, '/api/friends')),
    ];
    for (const b of bodies) expectClean(b);
    expect(JSON.stringify(bodies)).not.toContain(aId + '","winner');
    const own = await json<{ items: { id: string; title: string }[]; comparisons: unknown[] }>(await as(B, '/api/ratings/anime'));
    expect(own.comparisons).toEqual([]);
    expect(own.items.map((i) => i.title).sort()).toEqual(['Hidden', 'Public', 'QuietNotes', 'Unrated']);
    expect(own.items.some((i) => i.id === x.id || i.id === y.id)).toBe(false);
  });
});

describe('GET /api/friends/entries', () => {
  it('lists rated, visible entries of accepted friends only', async () => {
    await mk(S, { title: 'Stranger', rating: 9 });
    await mk(P, { title: 'Pending', rating: 9 });
    await mk(A, { title: 'Mine', rating: 9 });
    const res = await as(A, '/api/friends/entries');
    expect(res.status).toBe(200);
    const body = await json<{ userId: string; entries: { title: string; notes: string | null }[] }[]>(res);
    expect(body).toHaveLength(1);
    expect(body[0]!.userId).toBe(await uid(B));
    expect(body[0]!.entries.map((e) => e.title).sort()).toEqual(['MovieOne', 'Public', 'QuietNotes']); // no Hidden, no Unrated
    expect(body[0]!.entries.find((e) => e.title === 'QuietNotes')!.notes).toBeNull();
    expectClean(body);
    const movies = await json<{ entries: { title: string }[] }[]>(await as(A, '/api/friends/entries?category=movies'));
    expect(movies[0]!.entries.map((e) => e.title)).toEqual(['MovieOne']);
    expect(await json(await as(S, '/api/friends/entries'))).toEqual([]);
  });
});

describe('query counts (sign-in excluded)', () => {
  it('stays at or under 5', async () => {
    for (const path of ['/api/users/ren/entries', `/api/users/ren/entries/${pub.id}`, '/api/friends/entries']) {
      const spy = spyD1(env.DB);
      expect((await as(A, path, 'GET', undefined, spy.db)).status).toBe(200);
      expect(spy.queries, path).toBeLessThanOrEqual(5 + 1); // + 1 sign-in
    }
  });
});
