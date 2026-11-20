import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIERS, tierFor, type Entry, type SetItem } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';

const A = 'clear-a@example.com';
const B = 'clear-b@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const userId = async (email: string) => {
  await as(email, '/api/me');
  return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;
};
async function seed(uid: string, category: string, ratings: number[]): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  await env.DB.batch(ids.map((id, i) => env.DB.prepare(
    `INSERT INTO entries (id, user_id, category, title, rating, typed, tier, prior_mean, strength, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, uid, category, `T${i}`, ratings[i], ratings[i], tierFor(ratings[i]!, DEFAULT_TIERS), ratings[i], ratings[i],
    new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), '2026-01-01T00:00:00.000Z')));
  return ids;
}
const pick = (winnerId: string, loserId: string, isTie = false) => ({ winnerId, loserId, isTie, undone: false });
const save = (email: string, set: string, picks: unknown[]) => as(email, `/api/ratings/${set}/save`, 'POST', { picks, moves: [], done: [] });
const clear = (email: string, body: unknown) => as(email, '/api/ratings/clear', 'POST', body);
const shown = async (ids: string[]) => {
  const all = (await env.DB.prepare('SELECT id, rating FROM entries').all<{ id: string; rating: number }>()).results;
  return ids.map((id) => all.find((r) => r.id === id)!.rating);
};
const activeCount = async (uid: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM comparisons WHERE user_id = ? AND undone_at IS NULL').bind(uid).first<{ n: number }>())!.n;

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('POST /api/ratings/clear', () => {
  it('by title: undoes every active pick naming it; it and its nudged neighbours show their typed numbers; other picks stay', async () => {
    const uid = await userId(A);
    const [a, b, c, d, e] = await seed(uid, 'anime', [9.6, 9.6, 9.5, 7, 7]);
    expect((await save(A, 'anime', [pick(a!, b!), pick(c!, a!), pick(d!, e!)])).status).toBe(200);
    expect((await shown([a!, b!, c!])).every((r, i) => r === [9.6, 9.6, 9.5][i])).toBe(false);
    const res = await clear(A, { category: 'anime', entryId: a });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: SetItem[]; entries: Entry[] };
    expect(body.items.map((i) => i.id).sort()).toEqual([a, b, c].sort());
    expect(body.entries.map((x) => [x.id, x.rating, x.typed]).sort()).toEqual([[a, 9.6, 9.6], [b, 9.6, 9.6], [c, 9.5, 9.5]].sort());
    expect(await shown([a!, b!, c!])).toEqual([9.6, 9.6, 9.5]);
    expect(await activeCount(uid)).toBe(1);
    const undone = (await env.DB.prepare('SELECT COUNT(*) AS n FROM comparisons WHERE user_id = ? AND undone_at IS NOT NULL').bind(uid).first<{ n: number }>())!.n;
    expect(undone).toBe(2);
    // The pick between d and e still counts.
    expect((await shown([d!, e!])).join()).not.toBe('7,7');
  });

  it('by list: undoes all of the person’s active picks in that set only', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9, 9]);
    const [m, n] = await seed(uid, 'movies', [8, 8]);
    await save(A, 'anime', [pick(a!, b!)]);
    await save(A, 'movies', [pick(m!, n!)]);
    expect((await clear(A, { category: 'anime' })).status).toBe(200);
    expect(await shown([a!, b!])).toEqual([9, 9]);
    expect(await shown([m!, n!])).not.toEqual([8, 8]);
    expect(await activeCount(uid)).toBe(1);
  });

  it('a set with nothing to clear answers empty', async () => {
    const uid = await userId(A);
    await seed(uid, 'anime', [9]);
    expect(await (await clear(A, { category: 'anime' })).json()).toEqual({ items: [], entries: [] });
  });

  it('is owner-only: B cannot clear A’s picks or name A’s title', async () => {
    const uidA = await userId(A);
    await userId(B);
    const [a, b] = await seed(uidA, 'anime', [9, 9]);
    await save(A, 'anime', [pick(a!, b!)]);
    const before = await shown([a!, b!]);
    expect(await (await clear(B, { category: 'anime' })).json()).toEqual({ items: [], entries: [] });
    expect((await clear(B, { category: 'anime', entryId: a })).status).toBe(404);
    expect(await shown([a!, b!])).toEqual(before);
    expect(await activeCount(uidA)).toBe(1);
  });

  it('works for a season set', async () => {
    const uid = await userId(A);
    const [e] = await seed(uid, 'anime', [9]);
    const sid = [crypto.randomUUID(), crypto.randomUUID()];
    await env.DB.batch(sid.map((id, i) => env.DB.prepare(
      'INSERT INTO seasons (id, entry_id, label, rating, typed, tier, prior_mean, strength, created_at) VALUES (?, ?, ?, 8, 8, ?, 8, 8, ?)',
    ).bind(id, e, `S${i + 1}`, tierFor(8, DEFAULT_TIERS), new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString())));
    await save(A, 'anime_seasons', [pick(sid[0]!, sid[1]!)]);
    const mid = (await env.DB.prepare('SELECT rating FROM seasons ORDER BY created_at').all<{ rating: number }>()).results.map((r) => r.rating);
    expect(mid).not.toEqual([8, 8]);
    expect((await clear(A, { category: 'anime_seasons' })).status).toBe(200);
    expect((await env.DB.prepare('SELECT rating FROM seasons').all<{ rating: number }>()).results.map((r) => r.rating)).toEqual([8, 8]);
  });

  it('posts nothing to Activity', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9, 9]);
    await save(A, 'anime', [pick(a!, b!)]);
    await clear(A, { category: 'anime' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM activity').first<{ n: number }>())!.n).toBe(0);
  });

  it('400 for a bad body, an unknown set, a bad entryId', async () => {
    await userId(A);
    for (const body of [{}, { category: 'nope' }, { category: 5 }, { category: 'anime', entryId: '' }, { category: 'anime', entryId: 7 }, [], 'x']) {
      expect((await clear(A, body)).status).toBe(400);
    }
    expect((await clear(A, { category: 'anime', entryId: 'missing' })).status).toBe(404);
  });
});
