import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { ActivityPage, Entry } from '@media-tracker/shared';

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
