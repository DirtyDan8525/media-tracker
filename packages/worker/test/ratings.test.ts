import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import {
  DEFAULT_TIERS, applyMove, fitTier, priorFromScore, refitSet, scoreOf, tierFor, tierRange,
  type Comparison, type Entry, type RatedItem, type SavePayload, type Season, type SetItem, type Tier,
} from '@media-tracker/shared';
import { loadSet, planSave } from '../src/ratings/store';
import { spyD1 } from './d1spy';

const A = 'a@example.com';
const B = 'b@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown, db: D1Database = env.DB, raw?: string) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    { ...env, DB: db, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

async function userId(email: string): Promise<string> {
  await as(email, '/api/compare/queue');
  return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;
}

/** Rated rows as import leaves them (tier, prior, strength = prior). `legacy` leaves the tier NULL. */
async function seed(uid: string, category: string, ratings: (number | null)[], opts: { legacy?: boolean } = {}): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  const stmts = ids.map((id, i) => {
    const r = ratings[i]!;
    const tier = r === null || opts.legacy ? null : tierFor(r, DEFAULT_TIERS);
    const prior = tier === null ? null : priorFromScore(r!, tierRange(DEFAULT_TIERS, tier));
    return env.DB.prepare(
      `INSERT INTO entries (id, user_id, category, title, rating, tier, prior_mean, strength, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, uid, category, `T${i}`, r, tier, prior, prior, new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), '2026-01-01T00:00:00.000Z');
  });
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return ids;
}
async function seedSeasons(entryId: string, ratings: (number | null)[]): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  await env.DB.batch(ids.map((id, i) => {
    const r = ratings[i]!;
    const tier = r === null ? null : tierFor(r, DEFAULT_TIERS);
    const prior = tier === null ? null : priorFromScore(r!, tierRange(DEFAULT_TIERS, tier));
    return env.DB.prepare(
      'INSERT INTO seasons (id, entry_id, label, rating, tier, prior_mean, strength, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, entryId, `S${i + 1}`, r, tier, prior, prior, new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString());
  }));
  return ids;
}

type Row = { id: string; title: string; rating: number | null; tier: Tier | null; prior_mean: number | null; strength: number | null; score_locked: number; updated_at?: string };
const rows = async (table: 'entries' | 'seasons', ids: string[]) => {
  const all = (await env.DB.prepare(`SELECT * FROM ${table}`).all<Row>()).results;
  return ids.map((id) => all.find((r) => r.id === id)!);
};
const asItem = (r: Row): RatedItem => ({
  id: r.id, title: r.title ?? '', rating: r.rating, tier: r.tier, priorMean: r.prior_mean, strength: r.strength, scoreLocked: r.score_locked === 1,
});
const fields = (i: Pick<RatedItem, 'id' | 'rating' | 'tier' | 'priorMean' | 'strength' | 'scoreLocked'>) =>
  ({ id: i.id, rating: i.rating, tier: i.tier, priorMean: i.priorMean, strength: i.strength, scoreLocked: i.scoreLocked });

const save = (email: string, set: string, p: Partial<SavePayload>, db?: D1Database) =>
  as(email, `/api/ratings/${set}/save`, 'POST', { picks: [], moves: [], done: [], ...p }, db);
const pick = (winnerId: string, loserId: string, extra: { isTie?: boolean; undone?: boolean } = {}) =>
  ({ winnerId, loserId, isTie: extra.isTie ?? false, undone: extra.undone ?? false });
const patch = async (email: string, id: string, body: unknown) => {
  const res = await as(email, `/api/entries/${id}`, 'PATCH', body);
  return { status: res.status, entry: (await res.json()) as Entry };
};
const comparisonsOf = async (uid: string) =>
  (await env.DB.prepare('SELECT * FROM comparisons WHERE user_id = ? ORDER BY created_at, rowid').bind(uid).all<{
    id: string; category: string; winner_id: string; loser_id: string; is_tie: number; created_at: string; undone_at: string | null;
  }>()).results;
const queueOf = async (uid: string) =>
  (await env.DB.prepare('SELECT entry_id FROM compare_queue WHERE user_id = ? ORDER BY added_at, rowid').bind(uid).all<{ entry_id: string }>())
    .results.map((r) => r.entry_id);

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('GET /api/ratings/:set', () => {
  it('returns the set with covers and status, and only non-undone comparisons', async () => {
    const uid = await userId(A);
    const [a, b, u] = await seed(uid, 'anime', [9.5, 9.2, null]);
    await env.DB.prepare("UPDATE entries SET cover_url = 'https://c/a.jpg', status = 'Completed' WHERE id = ?").bind(a).run();
    await save(A, 'anime', { picks: [pick(b!, a!), pick(a!, b!, { undone: true })] });
    const res = await as(A, '/api/ratings/anime');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: SetItem[]; comparisons: Comparison[] };
    expect(body.items.map((i) => i.id).sort()).toEqual([a, b, u].sort());
    expect(body.items.find((i) => i.id === a)).toMatchObject({ cover: 'https://c/a.jpg', status: 'Completed', square: false, title: 'T0' });
    expect(body.items.find((i) => i.id === u)).toMatchObject({ rating: null, tier: null });
    expect(body.comparisons).toHaveLength(1);
    expect(body.comparisons[0]).toMatchObject({ winnerId: b, loserId: a, isTie: false, undoneAt: null });
    expect('kind' in body.items[0]!).toBe(false);
  });

  it('season sets are titled "<entry> · <label>" with the entry cover; rows with no tier get one on the fly', async () => {
    const uid = await userId(A);
    const [e] = await seed(uid, 'anime', [9]);
    await env.DB.prepare("UPDATE entries SET title = 'Frieren', cover_url = 'https://c/f.jpg' WHERE id = ?").bind(e).run();
    const [s1] = await seedSeasons(e!, [8.25]);
    await env.DB.prepare('UPDATE seasons SET tier = NULL, prior_mean = NULL, strength = NULL WHERE id = ?').bind(s1).run();
    const body = (await (await as(A, '/api/ratings/anime_seasons')).json()) as { items: SetItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: s1, title: 'Frieren · S1', cover: 'https://c/f.jpg', rating: 8.25, tier: 2, status: null });
    expect(body.items[0]!.priorMean).toBe(priorFromScore(8.25, [7.5, 9]));
    expect(body.items[0]!.strength).toBe(body.items[0]!.priorMean);
  });

  it('400 for an unknown set', async () => {
    expect((await as(A, '/api/ratings/nope')).status).toBe(400);
    expect((await as(A, '/api/ratings/animeSeasons')).status).toBe(400);
  });
});

describe('POST /api/ratings/:set/save', () => {
  it('save stores picks, moves and done; returns the Worker fit, which matches refitSet', async () => {
    const uid = await userId(A);
    const ids = await seed(uid, 'anime', [9.5, 9.4, 9.2, 8.25, 8, 7.6, 7]);
    const [e0, e1, e2, e3] = ids as [string, string, string, string];
    await env.DB.batch([e2, e3].map((id) => env.DB.prepare('INSERT INTO compare_queue (user_id, entry_id, added_at) VALUES (?, ?, ?)').bind(uid, id, new Date().toISOString())));
    const before = await rows('entries', ids);

    const payload: SavePayload = { picks: [pick(e2, e0), pick(e1, e0, { isTie: true })], moves: [{ id: e3, tier: 3 }], done: [e2] };
    const res = await save(A, 'anime', payload);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: SetItem[]; entries: Entry[] };

    // What the device's preview computes: the moves applied to the stored rows, then a full refitSet.
    const base = before.map(asItem);
    const moved = base.map((i) => (i.id === e3 ? applyMove(i, 3, DEFAULT_TIERS) : i));
    const comps: Comparison[] = payload.picks.map((p, k) => ({ id: `c${k}`, ...p, createdAt: '', undoneAt: null }));
    const fitted = new Map(moved.map((i) => [i.id, i]));
    for (const c of refitSet(moved, comps, DEFAULT_TIERS)) fitted.set(c.id, c);
    const expected = [...fitted.values()].filter((i) => {
      const b = base.find((x) => x.id === i.id)!;
      return JSON.stringify(fields(i)) !== JSON.stringify(fields(b));
    });
    expect(body.items.map(fields).sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(expected.map(fields).sort((x, y) => (x.id < y.id ? -1 : 1)));
    expect(body.items.map((i) => i.id)).toContain(e3);
    // The DB holds exactly the fit.
    const after = await rows('entries', ids);
    expect(after.map(asItem).map(fields)).toEqual(ids.map((id) => fields(fitted.get(id)!)));
    // Full Entry rows for the changed ones, with the new numbers.
    expect(body.entries.map((e) => e.id).sort()).toEqual(expected.map((i) => i.id).sort());
    for (const e of body.entries) expect(fields(e)).toEqual(fields(fitted.get(e.id)!));
    // Untouched tiers are never rewritten: the imported 8.0 and 7.6/7.0 are exactly as they were.
    expect(after.slice(4).map((r) => [r.rating, r.strength, r.updated_at])).toEqual(before.slice(4).map((r) => [r.rating, r.strength, r.updated_at]));

    const stored = await comparisonsOf(uid);
    expect(stored.map((c) => [c.category, c.winner_id, c.loser_id, c.is_tie, c.undone_at])).toEqual([
      ['anime', e2, e0, 0, null], ['anime', e1, e0, 1, null],
    ]);
    expect(stored[0]!.created_at < stored[1]!.created_at).toBe(true);
    expect(new Set(stored.map((c) => c.id)).size).toBe(2);
    expect(await queueOf(uid)).toEqual([e3]);
  });

  it('save keeps undone picks with undone_at and they count for nothing', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9.5, 9.2]);
    const before = await rows('entries', [a!, b!]);
    const res = await save(A, 'anime', { picks: [pick(b!, a!, { undone: true })] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: SetItem[] }).items).toEqual([]);
    expect(await rows('entries', [a!, b!])).toEqual(before);
    const stored = await comparisonsOf(uid);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.undone_at).not.toBeNull();
    // A later save doesn't count it either.
    await save(A, 'anime', { picks: [pick(a!, b!)] });
    const r = await rows('entries', [a!, b!]);
    expect(r[0]!.strength!).toBeGreaterThan(before[0]!.strength!);
  });

  it('a move to the stored tier does nothing; a pick across tiers counts for nothing', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9.97, 8.25]);
    const before = await rows('entries', [a!, b!]);
    const res = await save(A, 'anime', { moves: [{ id: a!, tier: 3 }], picks: [pick(b!, a!)] });
    expect(((await res.json()) as { items: SetItem[] }).items).toEqual([]);
    expect(await rows('entries', [a!, b!])).toEqual(before);
  });

  it('save with a title deleted mid-session: unknown ids dropped, 200, others fitted', async () => {
    const uid = await userId(A);
    const [a, b, c] = await seed(uid, 'anime', [9.5, 9.4, 9.2]);
    expect((await as(A, `/api/entries/${b}`, 'DELETE')).status).toBe(204);
    const res = await save(A, 'anime', {
      picks: [pick(b!, a!), pick(c!, a!), pick('gone', c!)],
      moves: [{ id: b!, tier: 0 }, { id: 'gone', tier: 1 }],
      done: [b!, 'gone'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: SetItem[]; entries: Entry[] };
    expect(body.items.map((i) => i.id).sort()).toEqual([a, c].sort());
    expect((await comparisonsOf(uid)).map((x) => [x.winner_id, x.loser_id])).toEqual([[c, a]]);
    const [ra, rc] = await rows('entries', [a!, c!]);
    expect(rc!.strength!).toBeGreaterThan(rc!.prior_mean!);
    expect(ra!.strength!).toBeLessThan(ra!.prior_mean!);
  });

  it('save of 1000 picks and 1000 moves runs in ≤ 10 queries', async () => {
    const uid = await userId(A);
    const ratings = Array.from({ length: 1000 }, (_, i) => 6 + (i % 40) / 10);
    const ids = await seed(uid, 'anime', ratings);
    const picks = Array.from({ length: 1000 }, (_, i) => pick(ids[i]!, ids[(i * 7 + 3) % 1000]!, { isTie: i % 5 === 0, undone: i % 9 === 0 }));
    const moves = ids.map((id, i) => ({ id, tier: (i % 4) as Tier }));
    const done = ids.slice(0, 50);
    const spy = spyD1(env.DB);
    const res = await save(A, 'anime', { picks, moves, done }, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(10);
    expect(spy.maxParams).toBeLessThanOrEqual(100);
    expect((await comparisonsOf(uid)).length).toBe(1000);
  });

  it('400 for > 1000 picks, a bad tier, a non-boolean undone, an unknown set', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9.5, 9.2]);
    const bad: [string, unknown][] = [
      ['anime', { picks: Array.from({ length: 1001 }, () => pick(a!, b!)), moves: [], done: [] }],
      ['anime', { picks: [], moves: Array.from({ length: 1001 }, () => ({ id: a!, tier: 1 })), done: [] }],
      ['anime', { picks: [], moves: [], done: Array.from({ length: 51 }, (_, i) => `d${i}`) }],
      ['anime', { picks: [], moves: [{ id: a!, tier: 4 }], done: [] }],
      ['anime', { picks: [], moves: [{ id: a!, tier: 1.5 }], done: [] }],
      ['anime', { picks: [], moves: [{ id: a!, tier: '2' }], done: [] }],
      ['anime', { picks: [], moves: [{ id: a!, tier: 1 }, { id: a!, tier: 2 }], done: [] }],
      ['anime', { picks: [{ winnerId: a, loserId: b, isTie: false, undone: 'no' }], moves: [], done: [] }],
      ['anime', { picks: [{ winnerId: a, loserId: b, isTie: 1, undone: false }], moves: [], done: [] }],
      ['anime', { picks: [{ winnerId: '', loserId: b, isTie: false, undone: false }], moves: [], done: [] }],
      ['anime', { picks: [{ winnerId: 'x'.repeat(65), loserId: b, isTie: false, undone: false }], moves: [], done: [] }],
      ['anime', { picks: [], moves: [], done: [5] }],
      ['anime', { picks: [], moves: [] }],
      ['anime', { picks: 'x', moves: [], done: [] }],
      ['anime', []],
      ['nope', { picks: [], moves: [], done: [] }],
    ];
    for (const [set, body] of bad) {
      expect((await as(A, `/api/ratings/${set}/save`, 'POST', body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await as(A, '/api/ratings/anime/save', 'POST', undefined, env.DB, '{nope')).status).toBe(400);
    expect(await comparisonsOf(uid)).toEqual([]);
  });

  it('is CSRF-guarded like every mutation', async () => {
    const res = await app.fetch(
      new Request('https://app.test/api/ratings/anime/save', {
        method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ picks: [], moves: [], done: [] }),
      }),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
    expect(res.status).toBe(415);
    const cross = await app.fetch(
      new Request('https://app.test/api/ratings/anime/save', {
        method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}',
      }),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
    expect(cross.status).toBe(403);
  });

  it("B can't read or change A's comparisons", async () => {
    const uidA = await userId(A);
    const uidB = await userId(B);
    const [a, b] = await seed(uidA, 'anime', [9.5, 9.2]);
    await save(A, 'anime', { picks: [pick(b!, a!)] });
    const before = await rows('entries', [a!, b!]);
    const read = (await (await as(B, '/api/ratings/anime')).json()) as { items: SetItem[]; comparisons: Comparison[] };
    expect(read).toEqual({ items: [], comparisons: [] });
    const res = await save(B, 'anime', { picks: [pick(a!, b!)], moves: [{ id: a!, tier: 0 }], done: [a!] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], entries: [] });
    expect(await rows('entries', [a!, b!])).toEqual(before);
    expect(await comparisonsOf(uidB)).toEqual([]);
    expect((await comparisonsOf(uidA)).length).toBe(1);
    const exp = (await (await as(B, '/api/export')).json()) as { comparisons: unknown[] };
    expect(exp.comparisons).toEqual([]);
  });

  it("Dan's imported scores (two decimals, tier edges) stay exactly through backfill and a save that doesn't involve them", async () => {
    const uid = await userId(A);
    const DAN = [10, 9.97, 9.9, 9, 8.99, 8.25, 7.5, 7.49, 6, 5.99, 0];
    const legacy = await seed(uid, 'anime', DAN, { legacy: true }); // as the pre-0005 database holds them
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    const [p, q] = await seed(uid, 'anime', [8.5, 8.4]);
    // A save before the backfill ran: the null-tier rows get their tier on the fly, rating untouched.
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    await as(A, '/api/me');
    await save(A, 'anime', { picks: [pick(q!, p!), pick(p!, q!, { isTie: true })] });
    const r = await rows('entries', legacy);
    expect(r.map((x) => x.rating)).toEqual(DAN);
    expect(r.map((x) => x.tier)).toEqual([3, 3, 3, 3, 2, 2, 2, 1, 1, 0, 0]);
    for (const x of r) expect(x.strength).toBe(x.prior_mean);
    for (const x of r) expect(x.prior_mean).toBe(priorFromScore(x.rating!, tierRange(DEFAULT_TIERS, x.tier!)));
    // A save with no picks touching them changes nothing either.
    const res = await save(A, 'anime', { picks: [], moves: [], done: [] });
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('CPU: a save into a 150-title tier with 600 picks', async () => {
    const uid = await userId(A);
    // 150 Loved titles spread over 9.0-10, plus the rest of a realistic list.
    const loved = Array.from({ length: 150 }, (_, i) => Math.round((9 + (i % 100) / 100) * 100) / 100);
    const others = Array.from({ length: 350 }, (_, i) => Math.round((3 + (i % 59) / 10) * 10) / 10);
    const ids = await seed(uid, 'anime', [...loved, ...others]);
    const L = ids.slice(0, 150);
    // 600 existing picks among the Loved titles (each title against its next four).
    const now = Date.now();
    const old = Array.from({ length: 600 }, (_, k) => {
      const i = k % 150, j = (i + 1 + Math.floor(k / 150)) % 150;
      return [crypto.randomUUID(), uid, L[i]!, L[j]!, k % 7 === 0 ? 1 : 0, new Date(now + k).toISOString()];
    });
    for (let k = 0; k < old.length; k += 14) {
      const part = old.slice(k, k + 14);
      await env.DB.prepare(`INSERT INTO comparisons (id, user_id, category, winner_id, loser_id, is_tie, created_at) VALUES ${part.map(() => "(?, ?, 'anime', ?, ?, ?, ?)").join(', ')}`)
        .bind(...part.flat()).run();
    }
    const payload: SavePayload = {
      picks: Array.from({ length: 10 }, (_, k) => pick(L[(k * 13) % 150]!, L[(k * 13 + 5) % 150]!)),
      moves: [{ id: L[149]!, tier: 2 }],
      done: [],
    };
    // The in-memory part of the save (moves, touched-tier re-fit, diff): the Worker's CPU.
    const loaded = await loadSet(env.DB, uid, 'anime', DEFAULT_TIERS);
    expect(loaded.comparisons.length).toBe(600);
    planSave(loaded, payload, DEFAULT_TIERS); // warm-up
    const times: number[] = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      planSave(loaded, payload, DEFAULT_TIERS);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    // The bare fit of the touched 150-title tier on the same data, for comparison.
    const lovedItems = loaded.items.filter((i) => i.tier === 3);
    const fits: number[] = [];
    for (let k = 0; k < 15; k++) {
      const t1 = performance.now();
      fitTier(lovedItems, loaded.comparisons);
      fits.push(performance.now() - t1);
    }
    fits.sort((x, y) => x - y);
    const t0 = performance.now();
    const res = await save(A, 'anime', payload);
    const wall = performance.now() - t0;
    expect(res.status).toBe(200);
    console.log(`[ratings save CPU] 150-title tier, 600 picks: planSave median ${times[7]} ms (min ${times[0]}, max ${times[14]}); bare fit median ${fits[7]} ms; whole request ${wall} ms`);
    // The median of 15 guards against one slow run on a shared machine (Workers allow 10 ms CPU).
    expect(times[7]).toBeLessThan(10);
  });
});

describe('rating edits re-fit their set', () => {
  it('PATCH rating keeps the picks and re-fits; PATCH tier moves keeping its rough place (Q23) and unlocks; scoreLocked pins the number', async () => {
    const uid = await userId(A);
    const [x, y, z] = await seed(uid, 'anime', [9.5, 9.4, 9.2]);
    await save(A, 'anime', { picks: [pick(z!, x!), pick(z!, y!)] });

    // A typed number in the same tier: new prior, picks kept, so the re-fit may move it a little.
    const r1 = await patch(A, x!, { rating: 9.6 });
    expect(r1.status).toBe(200);
    expect(r1.entry.priorMean).toBe(priorFromScore(9.6, [9, 10]));
    expect(r1.entry.tier).toBe(3);
    const items = (await rows('entries', [x!, y!, z!])).map(asItem);
    const comps = (await comparisonsOf(uid)).map((c) => ({ id: c.id, winnerId: c.winner_id, loserId: c.loser_id, isTie: c.is_tie === 1, createdAt: c.created_at, undoneAt: c.undone_at }));
    expect(refitSet(items, comps, DEFAULT_TIERS)).toEqual([]); // the DB already holds the fit
    expect(r1.entry.strength).not.toBe(r1.entry.priorMean); // x is fitted (it lost to z)
    expect(fields(r1.entry)).toEqual(fields(items[0]!));

    // Lock pins the shown number; later picks don't move it.
    const r2 = await patch(A, y!, { scoreLocked: true });
    const pinned = r2.entry.rating!;
    expect(r2.entry).toMatchObject({ scoreLocked: true, tier: 3 });
    expect(r2.entry.priorMean).toBe(priorFromScore(pinned, [9, 10]));
    expect(r2.entry.strength).toBe(r2.entry.priorMean);
    await save(A, 'anime', { picks: [pick(x!, y!), pick(y!, z!)] });
    const [ry] = await rows('entries', [y!]);
    expect(ry!.rating).toBe(pinned);

    // A tier chip: keeps its rough place (top of Liked) and unlocks.
    const r3 = await patch(A, y!, { tier: 2 });
    expect(r3.entry).toMatchObject({ tier: 2, scoreLocked: false });
    expect(r3.entry.priorMean).toBe(priorFromScore(pinned, [7.5, 9]));
    expect(r3.entry.rating).toBe(8.9);
    // y's old picks stop counting: the DB holds the fit of z and x without them.
    const all = (await rows('entries', [x!, y!, z!])).map(asItem);
    const comps2 = (await comparisonsOf(uid)).map((c) => ({ id: c.id, winnerId: c.winner_id, loserId: c.loser_id, isTie: c.is_tie === 1, createdAt: c.created_at, undoneAt: c.undone_at }));
    expect(comps2).toHaveLength(4);
    expect(refitSet(all, comps2, DEFAULT_TIERS)).toEqual([]);
  });

  it('a typed number in another tier counts as a move: old picks stop counting, and count again on return', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    const [fx] = await rows('entries', [x!]);
    expect(fx!.strength).not.toBe(fx!.prior_mean);
    const r = await patch(A, y!, { rating: 8 });
    expect(r.entry).toMatchObject({ rating: 8, tier: 2 });
    // x lost its only pick: it shows its prior again (Q6), the pick row is kept.
    const [x2] = await rows('entries', [x!]);
    expect(x2!.strength).toBe(x2!.prior_mean);
    expect(x2!.rating).toBe(Math.round(scoreOf(x2!.prior_mean!, [9, 10]) * 10) / 10);
    expect((await comparisonsOf(uid)).length).toBe(1);
    await patch(A, y!, { rating: 9.3 });
    const [x3, y3] = await rows('entries', [x!, y!]);
    expect(y3!.strength!).toBeGreaterThan(y3!.prior_mean!);
    expect(x3!.strength!).toBeLessThan(x3!.prior_mean!);
  });

  it('a rating equal to the stored one is not an edit: the tier is kept, nothing re-fits, nothing queues', async () => {
    const uid = await userId(A);
    const [x] = await seed(uid, 'anime', [9]);
    // A title that sits in Liked at 9.0 (e.g. moved there, then the number was kept): never re-derive.
    await env.DB.prepare('UPDATE entries SET tier = 2, prior_mean = 2.5, strength = 2.5 WHERE id = ?').bind(x).run();
    const [before] = await rows('entries', [x!]);
    const r = await patch(A, x!, { rating: 9, notes: 'hi' });
    expect(r.status).toBe(200);
    expect(r.entry).toMatchObject({ rating: 9, tier: 2, priorMean: 2.5, strength: 2.5, notes: 'hi' });
    expect(await queueOf(uid)).toEqual([]);
    const [after] = await rows('entries', [x!]);
    expect([after!.tier, after!.prior_mean, after!.strength]).toEqual([before!.tier, before!.prior_mean, before!.strength]);
    // scoreLocked equal to the stored value and a tier equal to the stored tier are no-ops too.
    const r2 = await patch(A, x!, { tier: 2, scoreLocked: false });
    expect(fields(r2.entry)).toEqual(fields(asItem(before!)));
  });

  it('lock is passed only when the request includes scoreLocked (Q8)', async () => {
    const uid = await userId(A);
    const [x] = await seed(uid, 'anime', [9.5]);
    await patch(A, x!, { scoreLocked: true });
    expect((await patch(A, x!, { rating: 9.6 })).entry).toMatchObject({ rating: 9.6, scoreLocked: true }); // same tier keeps the lock
    expect((await patch(A, x!, { rating: 8 })).entry).toMatchObject({ rating: 8, tier: 2, scoreLocked: false }); // another tier unlocks
    expect((await patch(A, x!, { rating: 8.2, scoreLocked: true })).entry).toMatchObject({ rating: 8.2, scoreLocked: true });
    expect((await patch(A, x!, { rating: 9.1, scoreLocked: true })).entry).toMatchObject({ rating: 9.1, tier: 3, scoreLocked: true });
    expect((await patch(A, x!, { scoreLocked: false })).entry).toMatchObject({ rating: 9.1, scoreLocked: false });
    expect((await patch(A, x!, { rating: null })).entry).toMatchObject({ rating: null, tier: null, priorMean: null, strength: null, scoreLocked: false });
  });

  it('400 for a contradictory or invalid rating edit', async () => {
    const uid = await userId(A);
    const [x, u] = await seed(uid, 'anime', [9.5, null]);
    for (const body of [{ tier: 4 }, { tier: -1 }, { tier: 1.5 }, { tier: null }, { scoreLocked: 'yes' }, { rating: 8, tier: 3 }, { rating: null, tier: 2 }]) {
      expect((await patch(A, x!, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await patch(A, u!, { scoreLocked: true })).status).toBe(400); // nothing to lock
    expect((await as(A, '/api/entries', 'POST', { category: 'anime', title: 't', rating: 8, tier: 3 })).status).toBe(400);
    expect((await as(A, '/api/entries', 'POST', { category: 'anime', title: 't', scoreLocked: true })).status).toBe(400);
  });

  it('tier-only create gets the middle score and joins the queue when Ask allows', async () => {
    const uid = await userId(A);
    const res = await as(A, '/api/entries', 'POST', { category: 'anime', title: 'New', tier: 2 });
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: Entry };
    expect(entry).toMatchObject({ tier: 2, priorMean: 0, strength: 0, scoreLocked: false, rating: 8.3 });
    expect(await queueOf(uid)).toEqual([entry.id]);
    // A typed number with a matching tier is fine, and lock may be set at create.
    const res2 = await as(A, '/api/entries', 'POST', { category: 'anime', title: 'Typed', rating: 8.25, tier: 2, scoreLocked: true });
    expect(((await res2.json()) as { entry: Entry }).entry).toMatchObject({ rating: 8.25, tier: 2, scoreLocked: true, priorMean: priorFromScore(8.25, [7.5, 9]) });
    // Giving an unrated title a tier by PATCH is a new rating too.
    const [u] = await seed(uid, 'anime', [null]);
    expect((await patch(A, u!, { tier: 0 })).entry).toMatchObject({ tier: 0, rating: 3, priorMean: 0 });
    expect(await queueOf(uid)).toContain(u);
    // Ask = Only when I start it: no queue.
    await as(A, '/api/me/settings', 'PUT', { settings: { compareAsk: 'Only when I start it' } });
    const res3 = await as(A, '/api/entries', 'POST', { category: 'movies', title: 'M', tier: 3 });
    const m = ((await res3.json()) as { entry: Entry }).entry;
    expect(m.rating).toBe(9.5);
    expect(await queueOf(uid)).not.toContain(m.id);
  });

  it('a created title next to a fitted one with the same one-decimal text makes it show two decimals', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.2]);
    await save(A, 'anime', { picks: [pick(x!, y!)] });
    const [fx] = await rows('entries', [x!]);
    const one = fx!.rating!;
    const res = await as(A, '/api/entries', 'POST', { category: 'anime', title: 'Twin', rating: Math.round(one * 10) / 10 });
    expect(res.status).toBe(201);
    const [fx2] = await rows('entries', [x!]);
    // x re-fits against its new neighbour: two decimals now unless the numbers land exactly.
    const items = (await env.DB.prepare('SELECT * FROM entries WHERE user_id = ?').bind(uid).all<Row>()).results.map(asItem);
    const comps = (await comparisonsOf(uid)).map((c) => ({ id: c.id, winnerId: c.winner_id, loserId: c.loser_id, isTie: c.is_tie === 1, createdAt: c.created_at, undoneAt: c.undone_at }));
    expect(refitSet(items, comps, DEFAULT_TIERS)).toEqual([]);
    expect(typeof fx2!.rating).toBe('number');
  });

  it('season edits re-fit the season set, never the list', async () => {
    const uid = await userId(A);
    const [e, f] = await seed(uid, 'anime', [9.5, 9.4]);
    await save(A, 'anime', { picks: [pick(f!, e!)] });
    const list = await rows('entries', [e!, f!]);
    const [s1, s2] = await seedSeasons(e!, [9.5, 9.4]);
    const r = await save(A, 'anime_seasons', { picks: [pick(s2!, s1!)], done: [] });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: SetItem[]; entries: Entry[] };
    expect(body.items.map((i) => i.id).sort()).toEqual([s1, s2].sort());
    expect(body.entries).toEqual([]);
    const c = await comparisonsOf(uid);
    expect(c.map((x) => x.category)).toEqual(['anime', 'anime_seasons']);

    // PATCH a season's number: picks kept, its set re-fits.
    const p = await as(A, `/api/seasons/${s1}`, 'PATCH', { rating: 9.7 });
    expect(p.status).toBe(200);
    const ps = (await p.json()) as Season;
    expect(ps).toMatchObject({ id: s1, tier: 3, priorMean: priorFromScore(9.7, [9, 10]), label: 'S1' });
    expect(ps.strength).not.toBe(ps.priorMean);
    // A tier-only season, and a season move.
    const add = await as(A, `/api/entries/${e}/seasons`, 'POST', { label: 'S3', tier: 1 });
    expect(add.status).toBe(201);
    expect(await add.json()).toMatchObject({ label: 'S3', tier: 1, rating: 6.8, priorMean: 0, strength: 0, scoreLocked: false });
    const mv = await as(A, `/api/seasons/${s2}`, 'PATCH', { tier: 2, label: 'Two' });
    expect(await mv.json()).toMatchObject({ tier: 2, label: 'Two', scoreLocked: false });
    expect((await as(A, `/api/seasons/${s2}`, 'PATCH', { tier: 9 })).status).toBe(400);
    // The list never moved.
    expect(await rows('entries', [e!, f!])).toEqual(list);
    // B can't edit A's seasons.
    expect((await as(B, `/api/seasons/${s1}`, 'PATCH', { rating: 1 })).status).toBe(404);
  });

  it('deleting an entry deletes its comparisons', async () => {
    const uid = await userId(A);
    const [a, b, c] = await seed(uid, 'anime', [9.5, 9.4, 9.2]);
    const [s1, s2] = await seedSeasons(a!, [9, 9.1]);
    await save(A, 'anime', { picks: [pick(a!, b!), pick(c!, a!), pick(b!, c!)] });
    await save(A, 'anime_seasons', { picks: [pick(s1!, s2!)] });
    expect((await as(A, `/api/entries/${a}`, 'DELETE')).status).toBe(204);
    const left = await comparisonsOf(uid);
    // Its own picks are gone; picks naming its (now deleted) seasons stay (Q22).
    expect(left.map((x) => [x.winner_id, x.loser_id])).toEqual([[b, c], [s1, s2]]);
  });

  it('export includes tiers on rows and every comparison', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9.5, 9.2]);
    const [s1, s2] = await seedSeasons(a!, [9, 9.1]);
    await save(A, 'anime', { picks: [pick(a!, b!), pick(b!, a!, { undone: true })] });
    await save(A, 'anime_seasons', { picks: [pick(s2!, s1!, { isTie: true })] });
    const spy = spyD1(env.DB);
    const res = await as(A, '/api/export', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(4); // sign-in + 3
    const body = (await res.json()) as { entries: Entry[]; seasons: Season[]; comparisons: (Comparison & { category: string })[] };
    expect(body.entries.find((e) => e.id === a)).toMatchObject({ tier: 3, scoreLocked: false });
    expect(typeof body.entries[0]!.strength).toBe('number');
    expect(body.seasons[0]).toMatchObject({ tier: 3 });
    expect(body.comparisons.map((c) => [c.category, c.winnerId, c.loserId, c.isTie, c.undoneAt === null])).toEqual([
      ['anime', a, b, false, true], ['anime', b, a, false, false], ['anime_seasons', s2, s1, true, true],
    ]);
  });
});
