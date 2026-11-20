import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import {
  DEFAULT_TIERS, priorFromScore, tierFor, tierRange,
  type Comparison, type Entry, type SavePayload, type Season, type SetItem, type Tier,
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

/**
 * Rated rows as the app writes them now (typed = rating, tier from it). `legacy` writes a 3c-era
 * row instead: typed NULL, tier and prior as the 3c import left them.
 */
async function seed(uid: string, category: string, ratings: (number | null)[], opts: { legacy?: boolean; status?: string } = {}): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  const stmts = ids.map((id, i) => {
    const r = ratings[i]!;
    const tier = r === null ? null : tierFor(r, DEFAULT_TIERS);
    const prior = r === null ? null : opts.legacy ? priorFromScore(r, tierRange(DEFAULT_TIERS, tier!)) : r;
    return env.DB.prepare(
      `INSERT INTO entries (id, user_id, category, title, status, rating, typed, tier, prior_mean, strength, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, uid, category, `T${i}`, opts.status ?? null, r, opts.legacy ? null : r, tier, prior, prior,
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), '2026-01-01T00:00:00.000Z');
  });
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return ids;
}
async function seedSeasons(entryId: string, ratings: (number | null)[]): Promise<string[]> {
  const ids = ratings.map(() => crypto.randomUUID());
  await env.DB.batch(ids.map((id, i) => {
    const r = ratings[i]!;
    return env.DB.prepare(
      'INSERT INTO seasons (id, entry_id, label, rating, typed, tier, prior_mean, strength, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, entryId, `S${i + 1}`, r, r, r === null ? null : tierFor(r, DEFAULT_TIERS), r, r, new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString());
  }));
  return ids;
}

type Row = { id: string; title: string; rating: number | null; typed: number | null; tier: Tier | null; prior_mean: number | null; strength: number | null; score_locked: number; notes?: string };
const rows = async (table: 'entries' | 'seasons', ids: string[]) => {
  const all = (await env.DB.prepare(`SELECT * FROM ${table}`).all<Row>()).results;
  return ids.map((id) => all.find((r) => r.id === id)!);
};
const ratingsOf = async (table: 'entries' | 'seasons', ids: string[]) => (await rows(table, ids)).map((r) => r.rating);

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

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('GET /api/ratings/:set', () => {
  it('returns the set with covers, status and typed numbers, and only non-undone comparisons', async () => {
    const uid = await userId(A);
    const [a, b, u] = await seed(uid, 'anime', [9.5, 9.4, null]);
    await env.DB.prepare("UPDATE entries SET cover_url = 'https://c/a.jpg', status = 'Completed' WHERE id = ?").bind(a).run();
    await save(A, 'anime', { picks: [pick(b!, a!), pick(a!, b!, { undone: true })] });
    const res = await as(A, '/api/ratings/anime');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: SetItem[]; comparisons: Comparison[] };
    expect(body.items.map((i) => i.id).sort()).toEqual([a, b, u].sort());
    expect(body.items.find((i) => i.id === a)).toMatchObject({ cover: 'https://c/a.jpg', status: 'Completed', square: false, title: 'T0', typed: 9.5 });
    expect(body.items.find((i) => i.id === u)).toMatchObject({ rating: null, typed: null });
    expect(body.comparisons).toHaveLength(1);
    expect(body.comparisons[0]).toMatchObject({ winnerId: b, loserId: a, isTie: false, undoneAt: null });
    expect('kind' in body.items[0]!).toBe(false);
  });

  it('season sets are titled "<entry> · <label>" with the entry cover', async () => {
    const uid = await userId(A);
    const [e] = await seed(uid, 'anime', [9]);
    await env.DB.prepare("UPDATE entries SET title = 'Frieren', cover_url = 'https://c/f.jpg' WHERE id = ?").bind(e).run();
    const [s1] = await seedSeasons(e!, [8.25]);
    const body = (await (await as(A, '/api/ratings/anime_seasons')).json()) as { items: SetItem[] };
    expect(body.items).toEqual([expect.objectContaining({ id: s1, title: 'Frieren · S1', cover: 'https://c/f.jpg', rating: 8.25, typed: 8.25, status: null })]);
  });

  it('400 for an unknown set', async () => {
    expect((await as(A, '/api/ratings/nope')).status).toBe(400);
    expect((await as(A, '/api/ratings/animeSeasons')).status).toBe(400);
  });
});

describe('POST /api/ratings/:set/save (close-call picks)', () => {
  it('one pick between two 9.6s stores the pick and shows 9.62 / 9.58; typed numbers stay', async () => {
    const uid = await userId(A);
    const [inv, arc, far] = await seed(uid, 'tv', [9.6, 9.6, 8.9]);
    const res = await save(A, 'tv', { picks: [pick(inv!, arc!)] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: SetItem[]; entries: Entry[] };
    expect(body.items.map((i) => [i.id, i.rating]).sort()).toEqual([[inv, 9.62], [arc, 9.58]].sort());
    expect(body.entries.map((e) => [e.id, e.rating, e.typed]).sort()).toEqual([[inv, 9.62, 9.6], [arc, 9.58, 9.6]].sort());
    expect(await ratingsOf('entries', [inv!, arc!, far!])).toEqual([9.62, 9.58, 8.9]);
    expect((await rows('entries', [inv!, arc!])).map((r) => [r.typed, r.tier, r.prior_mean, r.strength, r.score_locked]))
      .toEqual([[9.6, 3, 9.6, 9.62, 0], [9.6, 3, 9.6, 9.58, 0]]);
    expect((await comparisonsOf(uid)).map((c) => [c.category, c.winner_id, c.loser_id, c.is_tie])).toEqual([['tv', inv, arc, 0]]);
  });

  it('"About the same" between equal numbers keeps them tied and unchanged', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9, 9]);
    expect((await save(A, 'anime', { picks: [pick(a!, b!, { isTie: true })] })).status).toBe(200);
    expect(await ratingsOf('entries', [a!, b!])).toEqual([9, 9]);
    expect((await comparisonsOf(uid))[0]!.is_tie).toBe(1);
  });

  it('save keeps undone picks with undone_at and they count for nothing', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9.5, 9.5]);
    expect((await save(A, 'anime', { picks: [pick(a!, b!, { undone: true })] })).status).toBe(200);
    const comps = await comparisonsOf(uid);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.undone_at).not.toBeNull();
    expect(await ratingsOf('entries', [a!, b!])).toEqual([9.5, 9.5]);
  });

  it('a pick between titles that are not close is stored but changes nothing', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [8, 8.4]);
    const res = await save(A, 'anime', { picks: [pick(a!, b!)] });
    expect(await res.json()).toEqual({ items: [], entries: [] });
    expect(await ratingsOf('entries', [a!, b!])).toEqual([8, 8.4]);
    expect(await comparisonsOf(uid)).toHaveLength(1);
  });

  it('save with a title deleted mid-session: unknown ids dropped, 200, others nudged', async () => {
    const uid = await userId(A);
    const [a, b, c] = await seed(uid, 'anime', [9.5, 9.4, 9.5]);
    expect((await as(A, `/api/entries/${b}`, 'DELETE')).status).toBe(204);
    const res = await save(A, 'anime', { picks: [pick(b!, a!), pick(c!, a!), pick('gone', c!)], moves: [{ id: 'gone', tier: 1 }], done: ['gone'] });
    expect(res.status).toBe(200);
    expect((await comparisonsOf(uid)).map((x) => [x.winner_id, x.loser_id])).toEqual([[c, a]]);
    expect(await ratingsOf('entries', [a!, c!])).toEqual([9.48, 9.52]);
  });

  it('save of 1000 picks runs in ≤ 10 queries with ≤ 100 params per statement', async () => {
    const uid = await userId(A);
    const ids = await seed(uid, 'anime', Array.from({ length: 1000 }, (_, i) => 6 + (i % 40) / 10));
    const picks = Array.from({ length: 1000 }, (_, i) => pick(ids[i]!, ids[(i + 40) % 1000]!, { isTie: i % 5 === 0, undone: i % 9 === 0 }));
    const spy = spyD1(env.DB);
    const res = await save(A, 'anime', { picks, moves: ids.map((id) => ({ id, tier: 3 as Tier })), done: ids.slice(0, 50) }, spy.db);
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
      ['anime', { picks: [{ winnerId: a, loserId: b, isTie: false, undone: 'no' }], moves: [], done: [] }],
      ['anime', { picks: [{ winnerId: a, loserId: b, isTie: 1, undone: false }], moves: [], done: [] }],
      ['anime', { picks: [{ winnerId: '', loserId: b, isTie: false, undone: false }], moves: [], done: [] }],
      ['anime', { picks: [{ winnerId: 'x'.repeat(65), loserId: b, isTie: false, undone: false }], moves: [], done: [] }],
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

  it("B can't read or change A's comparisons or close calls", async () => {
    const uidA = await userId(A);
    const uidB = await userId(B);
    const [a, b] = await seed(uidA, 'anime', [9.5, 9.4]);
    await save(A, 'anime', { picks: [pick(b!, a!)] });
    const before = await rows('entries', [a!, b!]);
    expect(await (await as(B, '/api/ratings/anime')).json()).toEqual({ items: [], comparisons: [] });
    expect((await as(B, `/api/ratings/anime/close/${a}`)).status).toBe(404);
    expect(await (await as(B, '/api/ratings/anime/close')).json()).toEqual({ pairs: [], total: 0, items: [] });
    const res = await save(B, 'anime', { picks: [pick(a!, b!)] });
    expect(await res.json()).toEqual({ items: [], entries: [] });
    expect(await rows('entries', [a!, b!])).toEqual(before);
    expect(await comparisonsOf(uidB)).toEqual([]);
    expect((await comparisonsOf(uidA)).length).toBe(1);
  });

  it("Dan's imported scores (two decimals, edges) stay exactly through the backfill and a save that doesn't involve them", async () => {
    const uid = await userId(A);
    const DAN = [10, 9.97, 9.9, 9, 8.99, 8.25, 7.5, 7.49, 6, 5.99, 0.5, 0];
    const ids = await seed(uid, 'anime', DAN, { legacy: true });
    const [x, y] = await seed(uid, 'anime', [3.3, 3.3]);
    await as(A, '/api/me');
    expect(await ratingsOf('entries', ids)).toEqual(DAN);
    expect((await rows('entries', ids)).map((r) => r.typed)).toEqual(DAN);
    expect((await save(A, 'anime', { picks: [pick(x!, y!)] })).status).toBe(200);
    expect(await ratingsOf('entries', ids)).toEqual(DAN);
    expect(await ratingsOf('entries', [x!, y!])).toEqual([3.32, 3.28]);
  });

  it('CPU: planning a save into a 300-title list with 600 close picks stays small (median of 9 < 10 ms)', async () => {
    const uid = await userId(A);
    const ratings = Array.from({ length: 300 }, (_, i) => 6 + ((i * 37) % 40) / 10);
    const ids = await seed(uid, 'anime', ratings);
    const picks = [];
    for (let i = 0; picks.length < 600; i++) {
      const a = i % 300, b = (i * 7 + 1) % 300;
      if (a !== b && Math.abs(ratings[a]! - ratings[b]!) <= 0.3) picks.push(pick(ids[a]!, ids[b]!));
    }
    expect((await save(A, 'anime', { picks })).status).toBe(200);
    const loaded = await loadSet(env.DB, uid, 'anime', DEFAULT_TIERS);
    expect(loaded.comparisons).toHaveLength(600);
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const t0 = performance.now();
      planSave(loaded, { picks: [pick(ids[0]!, ids[40]!)], moves: [], done: [] }, DEFAULT_TIERS);
      times.push(performance.now() - t0);
    }
    expect(times.sort((p, q) => p - q)[4]!).toBeLessThan(10);
  });
});

describe('close calls (N6, N7)', () => {
  it('GET /:set/close/:id: at most 2, nearest first, never answered, never planned', async () => {
    const uid = await userId(A);
    const [x, a, b, c, far] = await seed(uid, 'anime', [9.6, 9.6, 9.5, 9.62, 9.0]);
    const [p] = await seed(uid, 'anime', [9.6], { status: 'Plan to watch' });
    const get = async (id: string) => {
      const res = await as(A, `/api/ratings/anime/close/${id}`);
      expect(res.status).toBe(200);
      return (await res.json()) as { item: SetItem; others: SetItem[] };
    };
    let body = await get(x!);
    expect(body.item).toMatchObject({ id: x, typed: 9.6 });
    expect(body.others.map((o) => o.id)).toEqual([a, c]);
    await save(A, 'anime', { picks: [pick(x!, a!)] });
    body = await get(x!);
    expect(body.others.map((o) => o.id)).toEqual([c, b]);
    expect(body.others.map((o) => o.id)).not.toContain(p);
    expect((await get(far!)).others).toEqual([]);
    expect((await get(p!)).others).toEqual([]);
    expect((await as(A, '/api/ratings/anime/close/nope')).status).toBe(404);
    expect((await as(A, `/api/ratings/nope/close/${x}`)).status).toBe(400);
  });

  it('GET /:set/close lists unanswered close pairs nearest first, with their titles and the total', async () => {
    const uid = await userId(A);
    const [a, b, c, d] = await seed(uid, 'anime', [8, 8, 8.2, 9]);
    await save(A, 'anime', { picks: [pick(a!, b!, { isTie: true })] });
    const body = (await (await as(A, '/api/ratings/anime/close')).json()) as { pairs: [string, string][]; total: number; items: SetItem[] };
    // Only neighbours in the shown order are asked (2026-11-19): c, then the tied a/b. The a–b tie is answered.
    expect(body.total).toBe(1);
    const first = [a!, b!].sort()[0]!;
    expect(body.pairs.map((pr) => [...pr].sort().join())).toEqual([[first, c!].sort().join()]);
    expect(body.items.map((i) => i.id).sort()).toEqual([first, c!].sort());
    expect(body.items.map((i) => i.id)).not.toContain(d);
  });

  it('GET /close-counts counts every set in one batch', async () => {
    const uid = await userId(A);
    await seed(uid, 'anime', [8, 8, 8.2, 9]);
    const [m] = await seed(uid, 'movies', [7, 7.3]);
    await seedSeasons(m!, [6, 6]); // seasons of a movie never count: movies have no season set
    const [t] = await seed(uid, 'tv', [5]);
    await seedSeasons(t!, [6, 6.1]);
    const spy = spyD1(env.DB);
    const res = await as(A, '/api/ratings/close-counts', 'GET', undefined, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(13);
    const { counts } = (await res.json()) as { counts: Record<string, number> };
    expect(counts).toMatchObject({ anime: 2, movies: 1, tv: 0, tv_seasons: 1, anime_seasons: 0, books: 0 });
  });
});

describe('concurrent writes', () => {
  it('a save loaded before a concurrent PATCH answers 409 and loses nothing', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    const spy = spyD1(env.DB);
    spy.beforeBatch = async (n) => { if (n === 2) expect((await patch(A, x!, { rating: 9.3 })).status).toBe(200); };
    const res = await save(A, 'anime', { picks: [pick(y!, x!)] }, spy.db);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict' });
    const [rx] = await rows('entries', [x!]);
    expect([rx!.rating, rx!.typed, rx!.prior_mean]).toEqual([9.3, 9.3, 9.3]);
    expect(await comparisonsOf(uid)).toEqual([]); // the whole batch rolled back
    expect((await save(A, 'anime', { picks: [pick(y!, x!)] })).status).toBe(200);
  });

  it('a PATCH loaded before a concurrent save answers 409 too', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    const spy = spyD1(env.DB);
    spy.beforeBatch = async (n) => { if (n === 2) expect((await save(A, 'anime', { picks: [pick(y!, x!)] })).status).toBe(200); };
    const res = await as(A, `/api/entries/${x}`, 'PATCH', { rating: 9.6, notes: 'n' }, spy.db);
    expect(res.status).toBe(409);
    const [rx] = await rows('entries', [x!]);
    expect(rx!.notes).toBe('');
    expect(rx!.rating).not.toBe(rx!.typed); // the save's nudge stands
  });

  it('a fresh write succeeds, bumps the rev and leaves no guard state behind', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    expect((await save(A, 'anime', { picks: [pick(y!, x!)] })).status).toBe(200);
    expect((await patch(A, x!, { rating: 9.6 })).status).toBe(200);
    const revs = (await env.DB.prepare('SELECT id, rating_rev FROM entries WHERE user_id = ?').bind(uid).all<{ id: string; rating_rev: number }>()).results;
    expect(new Map(revs.map((r) => [r.id, r.rating_rev])).get(x!)).toBe(2);
    const bad = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM entries WHERE rating_rev < 0) + (SELECT COUNT(*) FROM seasons WHERE rating_rev < 0) AS n').first<{ n: number }>();
    expect(bad!.n).toBe(0);
  });

  it('any other DB error in a rating write stays a 500', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    for (const msg of ['D1_ERROR: database is locked: SQLITE_BUSY', 'D1_ERROR: malformed JSON: SQLITE_ERROR']) {
      let n = 0;
      const failing = new Proxy(env.DB, {
        get(t, p) {
          if (p === 'batch') return async (st: D1PreparedStatement[]) => { if (++n === 2) throw new Error(msg); return t.batch(st); };
          const v = Reflect.get(t, p, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      expect((await save(A, 'anime', { picks: [pick(y!, x!)] }, failing)).status, msg).toBe(500);
    }
    expect(await comparisonsOf(uid)).toEqual([]);
  });

  it('rows whose rating did not change are written without a rating (legacy rows get typed)', async () => {
    const uid = await userId(A);
    const legacy = await seed(uid, 'anime', [9.97, 8.25], { legacy: true });
    const [x, y] = await seed(uid, 'anime', [9.5, 9.4]);
    const spy = spyD1(env.DB);
    await save(A, 'anime', { picks: [pick(y!, x!)] }, spy.db);
    const upd = spy.binds.find((b) => b.sql.includes('UPDATE entries SET'))!;
    const sent = JSON.parse(upd.values[0] as string) as Record<string, unknown>[];
    const byId = new Map(sent.map((r) => [r.id, r]));
    for (const id of legacy) expect(byId.get(id)!.rating).toBeUndefined();
    expect(byId.get(x!)!.rating).toEqual(expect.any(Number));
    expect((await rows('entries', legacy)).map((r) => [r.rating, r.typed, r.tier])).toEqual([[9.97, 9.97, 3], [8.25, 8.25, 2]]);
  });
});

describe('deletes re-fit the set', () => {
  it('deleting an entry gives its close-call partner its typed number back', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.5]);
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    expect(await ratingsOf('entries', [x!])).toEqual([9.48]);
    expect((await as(A, `/api/entries/${y}`, 'DELETE')).status).toBe(204);
    expect(await ratingsOf('entries', [x!])).toEqual([9.5]);
  });

  it('deleting a season re-fits its season set', async () => {
    const uid = await userId(A);
    const [e] = await seed(uid, 'tv', [9]);
    const [s1, s2] = await seedSeasons(e!, [8, 8]);
    await save(A, 'tv_seasons', { picks: [pick(s1!, s2!)] });
    expect(await ratingsOf('seasons', [s1!, s2!])).toEqual([8.02, 7.98]);
    expect((await as(A, `/api/seasons/${s2}`, 'DELETE')).status).toBe(204);
    expect(await ratingsOf('seasons', [s1!])).toEqual([8]);
  });

  it("undoing an import re-fits the sets and removes that import's comparisons", async () => {
    const uid = await userId(A);
    const importId = crypto.randomUUID();
    const r = (title: string, rating: number, seasons?: { label: string; rating: number; notes: string }[]) =>
      ({ category: 'anime', title, status: null, rating, genres: '', creator: '', album: '', coverUrl: '', notes: '', seasons });
    expect((await as(A, '/api/import', 'POST', { importId, rows: [r('Imp', 9.5, [{ label: 'S1', rating: 9.5, notes: '' }])] })).status).toBe(200);
    const [m] = await seed(uid, 'anime', [9.5]);
    const [ms] = await seedSeasons(m!, [9.5]);
    const imp = (await env.DB.prepare("SELECT id FROM entries WHERE title = 'Imp'").first<{ id: string }>())!.id;
    const impS = (await env.DB.prepare('SELECT id FROM seasons WHERE entry_id = ?').bind(imp).first<{ id: string }>())!.id;
    await save(A, 'anime', { picks: [pick(m!, imp)] });
    await save(A, 'anime_seasons', { picks: [pick(ms!, impS)] });
    expect(await ratingsOf('entries', [m!])).toEqual([9.52]);
    expect((await as(A, `/api/import/${importId}`, 'DELETE')).status).toBe(200);
    expect(await ratingsOf('entries', [m!])).toEqual([9.5]);
    expect(await ratingsOf('seasons', [ms!])).toEqual([9.5]);
    expect(await comparisonsOf(uid)).toEqual([]);
  });
});

describe('rating edits (N10)', () => {
  it('a re-rate trumps old picks (Dan, 2026-11-16): picks naming the title are undone and it shows its new number', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.5]);
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    expect(await ratingsOf('entries', [x!, y!])).toEqual([9.48, 9.52]);
    const r = await patch(A, x!, { rating: 9.6 }); // still close, but the old pick no longer counts
    expect(r.status).toBe(200);
    expect(r.entry).toMatchObject({ typed: 9.6, rating: 9.6 });
    expect(await ratingsOf('entries', [x!, y!])).toEqual([9.6, 9.5]);
    await patch(A, x!, { rating: 9.5 }); // back to a tie: no pick revives
    expect(await ratingsOf('entries', [x!, y!])).toEqual([9.5, 9.5]);
    const ks = await comparisonsOf(uid);
    expect(ks).toHaveLength(1);
    expect(ks[0]!.undone_at).not.toBeNull(); // kept for Export, but undone
  });

  it('typing the same number again is still a re-rate when picks name it; with no picks it costs no set load', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.5]);
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    const res = await as(A, `/api/entries/${x}`, 'PATCH', { rating: 9.5, tier: 0, scoreLocked: true, notes: 'n' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rating: 9.5, typed: 9.5, tier: 3, scoreLocked: false, notes: 'n' });
    expect(await ratingsOf('entries', [x!, y!])).toEqual([9.5, 9.5]);
    const spy = spyD1(env.DB);
    const again = await as(A, `/api/entries/${x}`, 'PATCH', { rating: 9.5, notes: 'm' }, spy.db);
    expect(again.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(8);
  });

  it('a new title with no picks shows exactly its number; neighbours are not touched', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.5]);
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    const res = await as(A, '/api/entries', 'POST', { category: 'anime', title: 'New', rating: 9.5 });
    const { entry } = (await res.json()) as { entry: Entry };
    expect(entry).toMatchObject({ rating: 9.5, typed: 9.5, tier: 3 });
    expect(await ratingsOf('entries', [x!, y!])).toEqual([9.48, 9.52]);
  });

  it('clearing a rating clears typed and gives the partner its number back', async () => {
    const uid = await userId(A);
    const [x, y] = await seed(uid, 'anime', [9.5, 9.5]);
    await save(A, 'anime', { picks: [pick(y!, x!)] });
    const r = await patch(A, x!, { rating: null });
    expect(r.entry).toMatchObject({ rating: null, typed: null, tier: null });
    expect(await ratingsOf('entries', [y!])).toEqual([9.5]);
  });

  it('season edits re-fit the season set, never the list', async () => {
    const uid = await userId(A);
    const [e, f] = await seed(uid, 'anime', [8, 8]);
    await save(A, 'anime', { picks: [pick(e!, f!)] });
    const [s1, s2] = await seedSeasons(e!, [8, 8]);
    await save(A, 'anime_seasons', { picks: [pick(s2!, s1!)] });
    const listBefore = await rows('entries', [e!, f!]);
    const res = await as(A, `/api/seasons/${s1}`, 'PATCH', { rating: 7.9 });
    expect(await res.json()).toMatchObject({ id: s1, typed: 7.9 });
    expect(await ratingsOf('seasons', [s1!, s2!])).toEqual([7.9, 8]);
    expect(await rows('entries', [e!, f!])).toEqual(listBefore);
  });

  it('deleting an entry deletes its comparisons; those naming its seasons stay', async () => {
    const uid = await userId(A);
    const [a, b, c] = await seed(uid, 'anime', [9.5, 9.4, 9.3]);
    const [s1, s2] = await seedSeasons(a!, [9, 9.1]);
    await save(A, 'anime', { picks: [pick(a!, b!), pick(c!, a!), pick(b!, c!)] });
    await save(A, 'anime_seasons', { picks: [pick(s1!, s2!)] });
    expect((await as(A, `/api/entries/${a}`, 'DELETE')).status).toBe(204);
    expect((await comparisonsOf(uid)).map((x) => [x.winner_id, x.loser_id])).toEqual([[b, c], [s1, s2]]);
  });

  it('export includes typed numbers and every comparison', async () => {
    const uid = await userId(A);
    const [a, b] = await seed(uid, 'anime', [9.5, 9.5]);
    const [s1, s2] = await seedSeasons(a!, [9, 9.1]);
    await save(A, 'anime', { picks: [pick(a!, b!), pick(b!, a!, { undone: true })] });
    await save(A, 'anime_seasons', { picks: [pick(s2!, s1!, { isTie: true })] });
    const spy = spyD1(env.DB);
    const res = await as(A, '/api/export', 'GET', undefined, spy.db);
    expect(spy.queries).toBe(4); // sign-in + 3
    const body = (await res.json()) as { entries: Entry[]; seasons: Season[]; comparisons: (Comparison & { category: string })[] };
    expect(body.entries.find((e) => e.id === a)).toMatchObject({ rating: 9.52, typed: 9.5 });
    expect(body.seasons[0]).toMatchObject({ rating: 9, typed: 9 });
    expect(body.comparisons.map((c) => [c.category, c.winnerId, c.loserId, c.isTie, c.undoneAt === null])).toEqual([
      ['anime', a, b, false, true], ['anime', b, a, false, false], ['anime_seasons', s2, s1, true, true],
    ]);
  });
});
