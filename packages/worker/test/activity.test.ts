import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { ActivityPage, Entry, SavePayload, Tier } from '@media-tracker/shared';
import { ratingsSaveActivityRows } from '../src/api/activity';
import { spyD1 } from './d1spy';

const A = 'a@example.com';
const B = 'b@example.com';

const as = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

const mk = async (email: string, body: Record<string, unknown>) => {
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: Entry }).entry;
};
const patch = async (email: string, id: string, body: unknown) => {
  const res = await as(email, `/api/entries/${id}`, 'PATCH', body);
  expect(res.status).toBe(200);
};
const feed = async (email: string, qs = '') => {
  const res = await as(email, `/api/activity${qs}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ActivityPage;
};

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('activity writes', () => {
  it('create logs added with rating and status', async () => {
    const e = await mk(A, { title: 'Frieren', rating: 8, status: 'Completed' });
    const { items, next } = await feed(A);
    expect(next).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'added', entryId: e.id, title: 'Frieren', category: 'anime',
      payload: { rating: 8, status: 'Completed' },
    });
  });

  it('patch rating null to 8 logs rated; 8 to 9 logs re-rated; 9 to 9 and 9 to null log nothing', async () => {
    const e = await mk(A, { title: 'X' });
    await patch(A, e.id, { rating: 8 });
    await patch(A, e.id, { rating: 9 });
    await patch(A, e.id, { rating: 9 });
    await patch(A, e.id, { rating: null });
    const { items } = await feed(A);
    expect(items.map((i) => i.type)).toEqual(['re-rated', 'rated', 'added']);
    expect(items[0]!.payload).toEqual({ from: 8, to: 9 });
    expect(items[1]!.payload).toEqual({ from: null, to: 8 });
  });

  it('patch status logs {from,to}; the same status logs nothing; rating+status logs two rows', async () => {
    const e = await mk(A, { title: 'X', status: 'Watching / In Progress' });
    await patch(A, e.id, { status: 'Completed' });
    await patch(A, e.id, { status: 'Completed' });
    let { items } = await feed(A);
    expect(items.map((i) => i.type)).toEqual(['status', 'added']);
    expect(items[0]!.payload).toEqual({ from: 'Watching / In Progress', to: 'Completed' });
    await patch(A, e.id, { rating: 7, status: 'Dropped' });
    ({ items } = await feed(A));
    expect(items).toHaveLength(4);
    expect(items.slice(0, 2).map((i) => i.type).sort()).toEqual(['rated', 'status']);
  });

  it('notes, coverUrl, lookup fills and seasons log nothing', async () => {
    const e = await mk(A, { title: 'X' });
    await patch(A, e.id, { notes: 'n', coverUrl: 'https://img.test/c.jpg', synopsis: 's', lookupState: 'ok' });
    const res = await as(A, `/api/entries/${e.id}/seasons`, 'POST', { label: 'S1', rating: 8 });
    expect(res.status).toBe(201);
    expect((await feed(A)).items.map((i) => i.type)).toEqual(['added']);
  });

  it('import logs nothing', async () => {
    const res = await as(A, '/api/import', 'POST', {
      importId: crypto.randomUUID(),
      rows: [{ category: 'movies', title: 'Imported', status: null, rating: 8, genres: '', creator: '', album: '', coverUrl: '', notes: '' }],
    });
    expect(res.status).toBe(200);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first<{ n: number }>();
    expect(n!.n).toBe(1);
    expect((await feed(A)).items).toEqual([]);
  });

  it('deleting the entry removes its rows', async () => {
    const e = await mk(A, { title: 'X', rating: 5 });
    expect((await as(A, `/api/entries/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await feed(A)).items).toEqual([]);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("B never sees A's rows", async () => {
    await mk(A, { title: 'Mine' });
    await mk(B, { title: 'Theirs' });
    expect((await feed(A)).items.map((i) => i.title)).toEqual(['Mine']);
    expect((await feed(B)).items.map((i) => i.title)).toEqual(['Theirs']);
  });
});

describe('GET /api/activity', () => {
  it('pages 120 rows sharing one created_at in 50/50/20 with no duplicates', async () => {
    const e = await mk(A, { title: 'X' });
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>();
    await env.DB.exec('DELETE FROM activity');
    const ts = '2026-11-15T10:00:00.000Z';
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 120; i++) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'rated', '{}', ?, ?)`,
        ).bind(`id${String(i).padStart(3, '0')}`, user!.id, e.id, ts, ts),
      );
    }
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));

    const seen: string[] = [];
    const sizes: number[] = [];
    let qs = '';
    for (let guard = 0; guard < 5; guard++) {
      const page = await feed(A, qs);
      sizes.push(page.items.length);
      seen.push(...page.items.map((i) => i.id));
      if (!page.next) break;
      qs = `?before=${encodeURIComponent(page.next.before)}&beforeId=${encodeURIComponent(page.next.beforeId)}`;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('pages rows with mixed created_at values across page boundaries without gaps or duplicates', async () => {
    const e = await mk(A, { title: 'X' });
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>();
    await env.DB.exec('DELETE FROM activity');
    const stmts: D1PreparedStatement[] = [];
    const expected: { id: string; at: string }[] = [];
    for (let i = 0; i < 130; i++) {
      // groups of 7 share a timestamp, so page edges (50, 100) fall mid-group; ids run against time order
      const at = new Date(Date.UTC(2026, 10, 15, 10, 0, 0) + Math.floor(i / 7) * 1000).toISOString();
      const id = `m${String(999 - i).padStart(4, '0')}`;
      expected.push({ id, at });
      stmts.push(
        env.DB.prepare(
          `INSERT INTO activity (id, user_id, entry_id, type, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'rated', '{}', ?, ?)`,
        ).bind(id, user!.id, e.id, at, at),
      );
    }
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
    expected.sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1));

    const seen: string[] = [];
    let qs = '';
    for (let guard = 0; guard < 6; guard++) {
      const page = await feed(A, qs);
      seen.push(...page.items.map((i) => i.id));
      if (!page.next) break;
      qs = `?before=${encodeURIComponent(page.next.before)}&beforeId=${encodeURIComponent(page.next.beforeId)}`;
    }
    expect(seen).toEqual(expected.map((x) => x.id));
  });

  it('before without beforeId is a 400, and so is beforeId without before', async () => {
    expect((await as(A, '/api/activity?before=2026-11-15T10:00:00.000Z')).status).toBe(400);
    expect((await as(A, '/api/activity?beforeId=x')).status).toBe(400);
  });

  it('requires sign-in', async () => {
    const res = await app.fetch(new Request('https://app.test/api/activity'), { ...env, ENVIRONMENT: 'prod' } as Env);
    expect(res.status).toBe(401);
  });
});

describe('migration seed (0003)', () => {
  it('adds one added row per existing non-imported entry at its created_at, and none for imports', async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0003'));
    const seed = migration?.queries.filter((q) => /INSERT INTO activity/i.test(q));
    expect(seed).toHaveLength(1);

    await mk(A, { title: 'Pre-existing' }); // creates the user
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>();
    await env.DB.exec('DELETE FROM activity'); // as if these entries predate the activity table
    const ins = (id: string, importId: string | null, at: string) =>
      env.DB.prepare(
        `INSERT INTO entries (id, user_id, category, title, import_id, created_at, updated_at) VALUES (?, ?, 'anime', ?, ?, ?, ?)`,
      ).bind(id, user!.id, id, importId, at, at);
    await env.DB.batch([
      ins('hand-made', null, '2026-01-02T03:04:05.000Z'),
      ins('imported', 'imp-1', '2026-01-03T00:00:00.000Z'),
    ]);

    await env.DB.prepare(seed![0]!).run();
    const rows = (await env.DB.prepare('SELECT * FROM activity ORDER BY created_at').all<Record<string, string>>()).results;
    const byEntry = Object.fromEntries(rows.map((r) => [r.entry_id, r]));
    expect(Object.keys(byEntry).sort()).toHaveLength(2); // Pre-existing (uuid) + hand-made; never 'imported'
    expect(byEntry.imported).toBeUndefined();
    expect(byEntry['hand-made']).toMatchObject({
      user_id: user!.id, type: 'added', payload_json: '{}',
      created_at: '2026-01-02T03:04:05.000Z', updated_at: '2026-01-02T03:04:05.000Z',
    });
    expect(byEntry['hand-made']!.id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('activity on POST/PATCH /entries with tier ratings', () => {
  it('a tier-only create logs added with the middle score it gets', async () => {
    const e = await mk(A, { title: 'Tiered', tier: 2 });
    expect(e.rating).not.toBeNull();
    const { items } = await feed(A);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'added', entryId: e.id, payload: { rating: e.rating } });
  });

  it('a tier-chip move (no rating key) logs re-rated with the final stored rating', async () => {
    const e = await mk(A, { title: 'Mover', rating: 8 });
    await patch(A, e.id, { tier: 3 });
    const stored = await env.DB.prepare('SELECT rating, tier FROM entries WHERE id = ?').bind(e.id).first<{ rating: number; tier: number }>();
    expect(stored!.tier).toBe(3);
    const { items } = await feed(A);
    expect(items.map((i) => i.type)).toEqual(['re-rated', 'added']);
    expect(items[0]!.payload).toEqual({ from: 8, to: stored!.rating });
  });

  it('a lock-only edit logs nothing; neighbours re-written by the edit log nothing', async () => {
    const a = await mk(A, { title: 'A', rating: 9.5 });
    const b = await mk(A, { title: 'B', rating: 9.4 });
    // Picks make a and b fitted, so an edit to one re-fits the other.
    const res = await as(A, '/api/ratings/anime/save', 'POST', { picks: [{ winnerId: b.id, loserId: a.id, isTie: false, undone: false }], moves: [], done: [] });
    expect(res.status).toBe(200);
    await env.DB.exec('DELETE FROM activity');
    const before = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(a.id).first<{ rating: number }>();
    await patch(A, b.id, { scoreLocked: true });
    expect((await feed(A)).items).toEqual([]);
    await patch(A, b.id, { rating: 9.1, scoreLocked: true });
    const after = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(a.id).first<{ rating: number }>();
    expect(after!.rating).not.toBe(before!.rating); // a was re-fitted …
    const { items } = await feed(A);
    expect(items.map((i) => i.entryId)).toEqual([b.id]); // … but only the edited title logs
    expect(items[0]).toMatchObject({ type: 're-rated', payload: { to: 9.1 } });
  });
});

describe('activity on POST /api/ratings/:set/save', () => {
  const save = (p: Partial<SavePayload>, db?: D1Database) =>
    app.fetch(
      new Request('https://app.test/api/ratings/anime/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ picks: [], moves: [], done: [], ...p }),
      }),
      { ...env, ...(db ? { DB: db } : {}), ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
  const pick = (winnerId: string, loserId: string, undone = false) => ({ winnerId, loserId, isTie: false, undone });
  const ratingOf = async (id: string) =>
    (await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(id).first<{ rating: number | null }>())!.rating;
  const logged = async () => (await feed(A)).items.filter((i) => i.type !== 'added');

  it('a move to another tier logs re-rated via compare from the stored to the final rating', async () => {
    const e = await mk(A, { title: 'Moved', rating: 8.5 });
    const res = await save({ moves: [{ id: e.id, tier: 3 }] });
    expect(res.status).toBe(200);
    const items = await logged();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 're-rated', entryId: e.id, payload: { from: 8.5, to: await ratingOf(e.id), via: 'compare' } });
  });

  it('a pick that moves a shown score by less than 0.5 logs nothing; titles changed only by the re-fit never log', async () => {
    const a = await mk(A, { title: 'A', rating: 9.5 });
    const b = await mk(A, { title: 'B', rating: 9.4 });
    const c = await mk(A, { title: 'C', rating: 9.3 });
    // c and a get a pick between them; later sessions name only a and b, so c changes by re-fit alone.
    expect((await save({ picks: [pick(c.id, a.id)] })).status).toBe(200);
    const cBefore = await ratingOf(c.id);
    const aBefore = await ratingOf(a.id);
    expect((await save({ picks: [pick(b.id, a.id), pick(b.id, a.id)] })).status).toBe(200);
    expect(await ratingOf(c.id)).not.toBe(cBefore); // c moved, through a
    const items = await logged();
    expect(items.some((i) => i.entryId === c.id)).toBe(false);
    // Whatever a and b did, each logged row is one whose score moved by ≥ 0.5 (none here: Loved is 9–10).
    expect(Math.abs((await ratingOf(a.id))! - aBefore!)).toBeLessThan(0.5);
    expect(items).toEqual([]);
  });

  it('an undone pick and a move to the stored tier log nothing', async () => {
    const a = await mk(A, { title: 'A', rating: 9.5 });
    const b = await mk(A, { title: 'B', rating: 7 });
    expect((await save({ picks: [pick(b.id, a.id, true)], moves: [{ id: a.id, tier: 3 }] })).status).toBe(200);
    expect(await logged()).toEqual([]);
  });

  it('season sets log nothing (activity rows name entries)', async () => {
    const e = await mk(A, { title: 'Show', rating: 8 });
    const s = await as(A, `/api/entries/${e.id}/seasons`, 'POST', { label: 'S1', rating: 8 });
    expect(s.status).toBe(201);
    const season = (await s.json()) as { id: string };
    expect(season.id).toBeTruthy();
    const res = await app.fetch(
      new Request('https://app.test/api/ratings/anime_seasons/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ picks: [], moves: [{ id: season.id, tier: 0 }], done: [] }),
      }),
      { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
    );
    expect(res.status).toBe(200);
    expect(await logged()).toEqual([]);
  });

  it('a stale save (409) logs nothing: the activity insert rolls back with the batch', async () => {
    const e = await mk(A, { title: 'Moved', rating: 8.5 });
    const spy = spyD1(env.DB);
    spy.beforeBatch = async () => {
      await env.DB.prepare('UPDATE entries SET rating_rev = rating_rev + 1 WHERE id = ?').bind(e.id).run();
    };
    const res = await save({ moves: [{ id: e.id, tier: 3 }] }, spy.db);
    expect(res.status).toBe(409);
    expect(await logged()).toEqual([]);
  });

  it('a 1000-pick, 1000-move save that logs every title stays within D1 limits (≤ 100 params, ≤ 10 queries)', async () => {
    const user = await (async () => { await feed(A); return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(A).first<{ id: string }>())!.id; })();
    const ids = Array.from({ length: 1000 }, () => crypto.randomUUID());
    const stmts = ids.map((id, i) => env.DB.prepare(
      `INSERT INTO entries (id, user_id, category, title, rating, created_at, updated_at) VALUES (?, ?, 'anime', ?, ?, ?, ?)`,
    ).bind(id, user, `T${i}`, 6.2 + (i % 8) / 10, new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), '2026-01-01T00:00:00.000Z'));
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    // Every title moves from Fine to Loved: each one logs.
    const moves = ids.map((id) => ({ id, tier: 3 as Tier }));
    const picks = Array.from({ length: 1000 }, (_, i) => pick(ids[i]!, ids[(i * 7 + 3) % 1000]!));
    const spy = spyD1(env.DB);
    const res = await save({ picks, moves }, spy.db);
    expect(res.status).toBe(200);
    expect(spy.queries).toBeLessThanOrEqual(10);
    expect(spy.maxParams).toBeLessThanOrEqual(100);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE type = 're-rated'").first<{ n: number }>();
    expect(n!.n).toBe(1000);
  });
});

describe('ratingsSaveActivityRows', () => {
  const st = (id: string, rating: number | null, tier: number | null) => ({ id, rating, tier });
  const before = new Map([
    ['same', st('same', 8, 2)], ['small', st('small', 8, 2)], ['half', st('half', 8, 2)], ['tier', st('tier', 8.9, 2)],
    ['first', st('first', null, null)], ['refit', st('refit', 8, 2)], ['cleared', st('cleared', 8, 2)],
  ]);
  const changed = [
    st('same', 8, 2), st('small', 8.49, 2), st('half', 8.5, 2), st('tier', 9.03, 3),
    st('first', 8.25, 2), st('refit', 6.1, 1), st('cleared', null, null),
  ];

  it('logs session titles that moved ≥ 0.5, changed tier or got a first rating; never re-fit-only rows', () => {
    const session = new Set(['same', 'small', 'half', 'tier', 'first', 'cleared']);
    expect(ratingsSaveActivityRows(before, changed, session)).toEqual([
      { id: 'half', rating: 8.5 }, { id: 'tier', rating: 9.03 }, { id: 'first', rating: 8.25 },
    ]);
  });

  it('a 0.5 drop counts like a 0.5 rise, despite float error', () => {
    const b = new Map([['x', st('x', 8.3, 2)]]);
    expect(ratingsSaveActivityRows(b, [st('x', 7.8, 2)], new Set(['x']))).toEqual([{ id: 'x', rating: 7.8 }]);
  });
});
