import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { DEFAULT_TIERS, priorFromScore, tierRange, type Entry, type Tier, type TierSet } from '@media-tracker/shared';
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

type Row = { rating: number | null; tier: number | null; prior_mean: number | null; strength: number | null; score_locked: number };

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

// Dan's Sheet values: two decimals, tier edges, and the extremes (Review Focus 3).
const DAN = [10, 10, 9.9, 9.97, 9, 8.25, 7.5, 7.49, 6, 5.99, 0];

describe('ensureTiers (GET /api/me)', () => {
  it('GET /api/me still answers when the backfill fails', async () => {
    const uid = await userId(A);
    await seedLegacy(uid, 'anime', [9]);
    // Every batch fails (ensureTiers is the only batch GET /api/me runs).
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
    const row = await env.DB.prepare('SELECT tier FROM entries').first<{ tier: number | null }>();
    expect(row!.tier).toBeNull();
  });

  it('backfill keeps every rating exactly and assigns tier + prior', async () => {
    const uid = await userId(A);
    await seedLegacy(uid, 'anime', DAN);
    expect((await as(A, '/api/me')).status).toBe(200);
    const rows = (await env.DB.prepare('SELECT rating, tier, prior_mean, strength, score_locked FROM entries ORDER BY rowid').all<Row>()).results;
    expect(rows.map((r) => r.rating)).toEqual(DAN);
    expect(rows.map((r) => r.tier)).toEqual([3, 3, 3, 3, 3, 2, 2, 1, 1, 0, 0]);
    for (const r of rows) expect(r.prior_mean).toBe(priorFromScore(r.rating!, tierRange(DEFAULT_TIERS, r.tier as Tier)));
    for (const r of rows) expect(r.strength).toBe(r.prior_mean);
    for (const r of rows) expect(r.score_locked).toBe(0);

    // …and the API shows exactly the same numbers, with the new fields.
    const list = (await (await as(A, '/api/entries?category=anime')).json()) as Entry[];
    expect(list.map((e) => e.rating)).toEqual(DAN);
    expect(list[5]).toMatchObject({ rating: 8.25, tier: 2, scoreLocked: false });
    expect(list[5]!.strength).toBe(list[5]!.priorMean);
  });

  it('leaves unrated rows alone and never touches a row that already has a tier', async () => {
    const uid = await userId(A);
    const [unrated, tiered] = await seedLegacy(uid, 'movies', [null, 8]);
    await env.DB.prepare('UPDATE entries SET tier = 3, prior_mean = 1.5, strength = 2, score_locked = 1 WHERE id = ?').bind(tiered).run();
    await as(A, '/api/me');
    const u = await env.DB.prepare('SELECT rating, tier, prior_mean, strength FROM entries WHERE id = ?').bind(unrated).first<Row>();
    expect(u).toEqual({ rating: null, tier: null, prior_mean: null, strength: null });
    const t = await env.DB.prepare('SELECT rating, tier, prior_mean, strength, score_locked FROM entries WHERE id = ?').bind(tiered).first<Row>();
    expect(t).toEqual({ rating: 8, tier: 3, prior_mean: 1.5, strength: 2, score_locked: 1 });
  });

  it('backfill is idempotent and costs 2 queries when nothing is left', async () => {
    const uid = await userId(A);
    const e = await seedLegacy(uid, 'anime', DAN);
    await seedSeasons(e[0]!, [9.5, 8.25]);
    const spy = spyD1(env.DB);
    await as(A, '/api/me', 'GET', undefined, spy.db);
    // sign-in select + 2 SELECTs + 2 UPDATEs
    expect(spy.queries).toBe(5);
    const before = (await env.DB.prepare('SELECT * FROM entries ORDER BY rowid').all()).results;
    spy.reset();
    const res = await as(A, '/api/me', 'GET', undefined, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBe(3); // sign-in select + the 2 SELECTs
    expect((await env.DB.prepare('SELECT * FROM entries ORDER BY rowid').all()).results).toEqual(before);
  });

  it('backfill uses the parent list tiers for seasons', async () => {
    const uid = await userId(A);
    const anime: TierSet = { names: ['D', 'F', 'Li', 'Lo'], bounds: [5, 7, 8.5] };
    await setTiers(uid, { anime });
    const [a] = await seedLegacy(uid, 'anime', [8.6]);
    const [t] = await seedLegacy(uid, 'tv', [8.6]);
    const as1 = await seedSeasons(a!, [8.6, 6.5, null]);
    const ts1 = await seedSeasons(t!, [8.6]);
    await as(A, '/api/me');
    const s = async (id: string) => (await env.DB.prepare('SELECT rating, tier, prior_mean, strength FROM seasons WHERE id = ?').bind(id).first<Row>())!;
    expect(await s(as1[0]!)).toEqual({ rating: 8.6, tier: 3, prior_mean: priorFromScore(8.6, [8.5, 10]), strength: priorFromScore(8.6, [8.5, 10]) });
    expect(await s(as1[1]!)).toMatchObject({ rating: 6.5, tier: 1 });
    expect(await s(as1[2]!)).toEqual({ rating: null, tier: null, prior_mean: null, strength: null });
    // TV seasons use TV's tiers (the defaults here): 8.6 is Liked.
    expect(await s(ts1[0]!)).toEqual({ rating: 8.6, tier: 2, prior_mean: priorFromScore(8.6, [7.5, 9]), strength: priorFromScore(8.6, [7.5, 9]) });
    // The anime entry itself uses anime's tiers too.
    const e = await env.DB.prepare('SELECT tier FROM entries WHERE id = ?').bind(a).first<{ tier: number }>();
    expect(e!.tier).toBe(3);
  });

  it("only backfills the signed-in user's rows", async () => {
    const uid = await userId(A);
    const other = await userId('b@example.com');
    await seedLegacy(uid, 'anime', [9]);
    const [theirs] = await seedLegacy(other, 'anime', [9]);
    await seedSeasons(theirs!, [8]);
    await as(A, '/api/me');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE tier IS NULL').first<{ n: number }>();
    expect(n!.n).toBe(1);
    const sn = await env.DB.prepare('SELECT COUNT(*) AS n FROM seasons WHERE tier IS NULL').first<{ n: number }>();
    expect(sn!.n).toBe(1);
  });

  it('backfills a large library in one UPDATE per table', async () => {
    const uid = await userId(A);
    const ratings = Array.from({ length: 1500 }, (_, i) => Math.round((i % 1001) / 10) / 10);
    for (let i = 0; i < ratings.length; i += 300) await seedLegacy(uid, 'songs', ratings.slice(i, i + 300));
    const spy = spyD1(env.DB);
    await as(A, '/api/me', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(4); // sign-in + 2 SELECTs + 1 UPDATE (no seasons)
    expect(spy.maxParams).toBeLessThanOrEqual(100);
    const rows = (await env.DB.prepare('SELECT rating, tier FROM entries ORDER BY rowid').all<Row>()).results;
    expect(rows.map((r) => r.rating)).toEqual(ratings);
    expect(rows.every((r) => r.tier !== null)).toBe(true);
  });
});
