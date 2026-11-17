import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { DEFAULT_TIERS, priorFromScore, round2, scoreOf, tierRange, type Entry, type TierSet } from '@media-tracker/shared';
import { spyD1 } from './d1spy';

const A = 'a@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown, db: D1Database = env.DB) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, DB: db, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

/** Creates the user row (a request that doesn't backfill) and returns its id. */
async function userId(email: string): Promise<string> {
  await as(email, '/api/compare/queue');
  return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;
}

/** Rows as a pre-0005 database holds them: rated, tier NULL. Returns the ids in order. */
async function seedLegacy(uid: string, category: string, ratings: (number | null)[]): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  const now = new Date().toISOString();
  await env.DB.batch(ids.map((id, i) =>
    env.DB.prepare('INSERT INTO entries (id, user_id, category, title, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, uid, category, `T${i}`, ratings[i], now, now)));
  return ids;
}
async function seedSeasons(entryId: string, ratings: (number | null)[]): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  await env.DB.batch(ids.map((id, i) =>
    env.DB.prepare('INSERT INTO seasons (id, entry_id, label, rating, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, entryId, `S${i + 1}`, ratings[i], new Date(Date.now() + i).toISOString())));
  return ids;
}
const setTiers = (uid: string, tiers: Record<string, TierSet>) =>
  env.DB.prepare("UPDATE users SET settings_json = json_set(settings_json, '$.tiers', json(?)) WHERE id = ?")
    .bind(JSON.stringify(tiers), uid).run();

type Row = { rating: number | null; typed: number | null; tier: number | null; prior_mean: number | null; strength: number | null; score_locked: number };

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

// Dan's Sheet values: two decimals, tier edges, and the extremes.
const DAN = [10, 10, 9.9, 9.97, 9, 8.25, 7.5, 7.49, 6, 5.99, 0];

/** A 3c-fitted pair as Phase 3c left it: two 10s in Loved, one pick, ratings 9.98 / 9.96. */
async function seed3cFitted(uid: string): Promise<[string, string]> {
  const [f, c] = await seedLegacy(uid, 'anime', [9.98, 9.96]);
  const p = priorFromScore(10, [9, 10]);
  await env.DB.batch([
    env.DB.prepare('UPDATE entries SET tier = 3, prior_mean = ?, strength = ? WHERE id = ?').bind(p, p + 0.3, f),
    env.DB.prepare('UPDATE entries SET tier = 3, prior_mean = ?, strength = ? WHERE id = ?').bind(p, p - 0.3, c),
    env.DB.prepare(
      "INSERT INTO comparisons (id, user_id, category, winner_id, loser_id, is_tie, created_at) VALUES (?, ?, 'anime', ?, ?, 0, ?)",
    ).bind(crypto.randomUUID(), uid, f, c, new Date().toISOString()),
  ]);
  return [f!, c!];
}

describe('ensureTyped (GET /api/me, Ruling N2)', () => {
  it('GET /api/me still answers when the backfill fails', async () => {
    const uid = await userId(A);
    await seedLegacy(uid, 'anime', [9]);
    const broken = new Proxy(env.DB, {
      get(t, p) {
        if (p === 'batch') return async () => { throw new Error('D1_ERROR: simulated'); };
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const res = await as(A, '/api/me', 'GET', undefined, broken);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: A });
    const row = await env.DB.prepare('SELECT typed FROM entries').first<{ typed: number | null }>();
    expect(row!.typed).toBeNull();
  });

  it('pre-3c and unfitted rows: typed = rating, every rating kept exactly', async () => {
    const uid = await userId(A);
    await seedLegacy(uid, 'anime', DAN);
    expect((await as(A, '/api/me')).status).toBe(200);
    const rows = (await env.DB.prepare('SELECT rating, typed, tier, prior_mean, strength, score_locked FROM entries ORDER BY rowid').all<Row>()).results;
    expect(rows.map((r) => r.rating)).toEqual(DAN);
    expect(rows.map((r) => r.typed)).toEqual(DAN);
    expect(rows.map((r) => r.tier)).toEqual([3, 3, 3, 3, 3, 2, 2, 1, 1, 0, 0]);
    for (const r of rows) expect([r.prior_mean, r.score_locked]).toEqual([r.typed, 0]);
    const list = (await (await as(A, '/api/entries?category=anime')).json()) as Entry[];
    expect(list.map((e) => e.rating)).toEqual(DAN);
  });

  it('a locked 3c row keeps its number as typed', async () => {
    const uid = await userId(A);
    const [x] = await seedLegacy(uid, 'movies', [8.4]);
    await env.DB.prepare('UPDATE entries SET tier = 2, prior_mean = 0.3, strength = 0.9, score_locked = 1 WHERE id = ?').bind(x).run();
    await as(A, '/api/me');
    const r = await env.DB.prepare('SELECT rating, typed, score_locked FROM entries WHERE id = ?').bind(x).first<Row>();
    expect(r).toEqual({ rating: 8.4, typed: 8.4, score_locked: 0 });
  });

  it('a 3c-fitted row reads its typed number from its prior; its old pick still counts, now number-first', async () => {
    const uid = await userId(A);
    const [f, c] = await seed3cFitted(uid);
    // Read paths already show the derived typed number before the backfill.
    const before = (await (await as(A, '/api/entries?category=anime')).json()) as Entry[];
    expect(before.map((e) => e.typed)).toEqual([round2(scoreOf(priorFromScore(10, [9, 10]), [9, 10])), 9.97]);
    await as(A, '/api/me');
    const rows = (await env.DB.prepare('SELECT id, rating, typed FROM entries ORDER BY rowid').all<Row & { id: string }>()).results;
    expect(rows).toEqual([{ id: f, rating: 9.99, typed: 9.97 }, { id: c, rating: 9.95, typed: 9.97 }]);
  });

  it('leaves unrated rows alone', async () => {
    const uid = await userId(A);
    const [unrated] = await seedLegacy(uid, 'movies', [null, 8]);
    await as(A, '/api/me');
    const u = await env.DB.prepare('SELECT rating, typed, tier, prior_mean, strength FROM entries WHERE id = ?').bind(unrated).first<Row>();
    expect(u).toEqual({ rating: null, typed: null, tier: null, prior_mean: null, strength: null });
  });

  it('is idempotent and costs 2 queries when nothing is left', async () => {
    const uid = await userId(A);
    const e = await seedLegacy(uid, 'anime', DAN);
    await seedSeasons(e[0]!, [9.5, 8.25]);
    const spy = spyD1(env.DB);
    await as(A, '/api/me', 'GET', undefined, spy.db);
    // sign-in + 2 SELECTs + loadSets (anime, anime_seasons, comparisons) + 2 UPDATEs
    expect(spy.queries).toBe(8);
    const before = (await env.DB.prepare('SELECT * FROM entries ORDER BY rowid').all()).results;
    spy.reset();
    const res = await as(A, '/api/me', 'GET', undefined, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(3);
    expect((await env.DB.prepare('SELECT * FROM entries ORDER BY rowid').all()).results).toEqual(before);
    const seasons = (await env.DB.prepare('SELECT rating, typed FROM seasons ORDER BY created_at').all<Row>()).results;
    expect(seasons).toEqual([{ rating: 9.5, typed: 9.5 }, { rating: 8.25, typed: 8.25 }]);
  });

  it('a 3c-fitted season uses its parent list tiers to read its typed number', async () => {
    const uid = await userId(A);
    const anime: TierSet = { names: ['D', 'F', 'Li', 'Lo'], bounds: [5, 7, 8.5] };
    await setTiers(uid, { anime });
    const [a] = await seedLegacy(uid, 'anime', [8.6]);
    const [s] = await seedSeasons(a!, [9.1]);
    const p = priorFromScore(9.1, tierRange(anime, 3));
    await env.DB.prepare('UPDATE seasons SET tier = 3, prior_mean = ?, strength = ? WHERE id = ?').bind(p, p + 0.1, s).run();
    await as(A, '/api/me');
    const r = await env.DB.prepare('SELECT rating, typed FROM seasons WHERE id = ?').bind(s).first<Row>();
    expect(r).toEqual({ rating: 9.1, typed: 9.1 });
    expect(DEFAULT_TIERS.bounds[2]).toBe(9);
  });

  it("only backfills the signed-in user's rows", async () => {
    const uid = await userId(A);
    const other = await userId('b@example.com');
    await seedLegacy(uid, 'anime', [9]);
    const [theirs] = await seedLegacy(other, 'anime', [9]);
    await seedSeasons(theirs!, [8]);
    await as(A, '/api/me');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE typed IS NULL').first<{ n: number }>();
    expect(n!.n).toBe(1);
    const sn = await env.DB.prepare('SELECT COUNT(*) AS n FROM seasons WHERE typed IS NULL').first<{ n: number }>();
    expect(sn!.n).toBe(1);
  });

  it('backfills a large library in one UPDATE per set, within D1 limits', async () => {
    const uid = await userId(A);
    const ratings = Array.from({ length: 1500 }, (_, i) => Math.round((i % 1001) / 10) / 10);
    for (let i = 0; i < ratings.length; i += 300) await seedLegacy(uid, 'songs', ratings.slice(i, i + 300));
    const spy = spyD1(env.DB);
    await as(A, '/api/me', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(6); // sign-in + 2 SELECTs + loadSets (songs, comparisons) + 1 UPDATE
    expect(spy.maxParams).toBeLessThanOrEqual(100);
    const rows = (await env.DB.prepare('SELECT rating, typed FROM entries ORDER BY rowid').all<Row>()).results;
    expect(rows.map((r) => r.rating)).toEqual(ratings);
    expect(rows.map((r) => r.typed)).toEqual(ratings);
  });
});
