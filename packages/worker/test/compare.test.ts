import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { Entry } from '@media-tracker/shared';

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

const mk = async (email: string, body: Record<string, unknown> = {}) => {
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', title: 't', ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: Entry }).entry;
};
const rate = (email: string, id: string, rating: number | null) =>
  as(email, `/api/entries/${id}`, 'PATCH', { rating });
const queue = async (email: string) => {
  const res = await as(email, '/api/compare/queue');
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { entryId: string; category: string }[] }).items;
};
const setAsk = (email: string, compareAsk: string) =>
  as(email, '/api/me/settings', 'PUT', { settings: { compareAsk } });

// Bulk insert straight into env.DB (users row is created by a first request).
async function seedEntries(email: string, n: number): Promise<string[]> {
  await as(email, '/api/compare/queue');
  const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  const now = new Date().toISOString();
  const stmts = [];
  for (let i = 0; i < n; i += 10) {
    const chunk = ids.slice(i, i + 10);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO entries (id, user_id, category, title, created_at, updated_at) VALUES ${chunk.map(() => "(?, ?, 'anime', 't', ?, ?)").join(', ')}`,
      ).bind(...chunk.flatMap((id) => [id, u!.id, now, now])),
    );
  }
  await env.DB.batch(stmts);
  return ids;
}

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('compare queue', () => {
  it('queues a hand-typed rating and moves a re-rated title to the end', async () => {
    const e1 = await mk(A);
    const e2 = await mk(A);
    await rate(A, e1.id, 8);
    await rate(A, e2.id, 7);
    await rate(A, e1.id, 8.5);
    expect((await queue(A)).map((i) => i.entryId)).toEqual([e2.id, e1.id]);
  });

  it('queues on create with a rating, and reports the category', async () => {
    const e = await mk(A, { rating: 9 });
    expect(await queue(A)).toEqual([{ entryId: e.id, category: 'anime' }]);
  });

  it('queues when compareAsk is "Only for new ratings"', async () => {
    await setAsk(A, 'Only for new ratings');
    const e = await mk(A);
    await rate(A, e.id, 6);
    expect((await queue(A)).length).toBe(1);
  });

  it('does not queue when compareAsk is "Only when I start it" or "Off"', async () => {
    for (const ask of ['Only when I start it', 'Off']) {
      expect((await setAsk(A, ask)).status).toBe(200);
      const e = await mk(A);
      await rate(A, e.id, 8);
      expect(await queue(A)).toEqual([]);
    }
  });

  it('does not queue on import, a notes-only PATCH, or a null rating', async () => {
    const imp = await as(A, '/api/import', 'POST', {
      importId: crypto.randomUUID(),
      rows: [{ category: 'anime', title: 'x', status: null, rating: 9, genres: '', creator: '', album: '', coverUrl: '', notes: '' }],
    });
    expect(imp.status).toBeLessThan(300);
    const e = await mk(A);
    await as(A, `/api/entries/${e.id}`, 'PATCH', { notes: 'hi' });
    await rate(A, e.id, null);
    expect(await queue(A)).toEqual([]);
  });

  it('keeps only the 50 most recent', async () => {
    const ids = await seedEntries(A, 52);
    for (const id of ids) expect((await rate(A, id, 5)).status).toBe(200);
    const q = (await queue(A)).map((i) => i.entryId);
    expect(q).toEqual(ids.slice(2));
  });

  it('hides queued titles that were unrated; deleting the entry removes them', async () => {
    const e1 = await mk(A);
    const e2 = await mk(A);
    await rate(A, e1.id, 8);
    await rate(A, e2.id, 7);
    await rate(A, e1.id, null);
    expect((await queue(A)).map((i) => i.entryId)).toEqual([e2.id]);
    await as(A, `/api/entries/${e2.id}`, 'DELETE');
    expect(await queue(A)).toEqual([]);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM compare_queue WHERE entry_id = ?').bind(e2.id).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('DELETE /queue/:entryId is 204, also when absent, and only touches your own row', async () => {
    const e = await mk(A, { rating: 8 });
    expect((await as(B, `/api/compare/queue/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await queue(A)).length).toBe(1);
    expect((await as(A, `/api/compare/queue/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await as(A, `/api/compare/queue/${e.id}`, 'DELETE')).status).toBe(204);
    expect(await queue(A)).toEqual([]);
  });
});

describe('compare save', () => {
  it('saves 1,000 changes (the maximum) in one request', async () => {
    const ids = await seedEntries(A, 1000);
    const res = await as(A, '/api/compare/save', 'POST', {
      changes: ids.map((id, i) => ({ id, rating: (i % 100) / 10 })),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { updated: number; entries: Entry[] };
    expect(json.updated).toBe(1000);
    expect(json.entries.length).toBe(1000);
    const row = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(ids[37]!).first<{ rating: number }>();
    expect(row!.rating).toBe(3.7);
  });

  it('ignores ids that are missing or belong to someone else', async () => {
    const mine = await mk(A);
    const theirs = await mk(B);
    const res = await as(A, '/api/compare/save', 'POST', {
      changes: [
        { id: mine.id, rating: 9 },
        { id: theirs.id, rating: 1 },
        { id: 'gone', rating: 2 },
      ],
    });
    const json = (await res.json()) as { updated: number; entries: Entry[] };
    expect(json.updated).toBe(1);
    expect(json.entries.map((e) => e.id)).toEqual([mine.id]);
    const other = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(theirs.id).first<{ rating: number | null }>();
    expect(other!.rating).toBeNull();
  });

  it('drops doneEntryId from the queue in the same request, and never enqueues', async () => {
    const e1 = await mk(A, { rating: 8 });
    const e2 = await mk(A, { rating: 7 });
    const res = await as(A, '/api/compare/save', 'POST', { changes: [{ id: e2.id, rating: 6 }], doneEntryId: e1.id });
    expect(res.status).toBe(200);
    expect((await queue(A)).map((i) => i.entryId)).toEqual([e2.id]);
  });

  it('rejects bad bodies with 400', async () => {
    const e = await mk(A);
    const f = (b: unknown) => as(A, '/api/compare/save', 'POST', b);
    const bad: unknown[] = [
      { changes: [{ id: e.id, rating: null }] },
      { changes: [{ id: e.id, rating: 10.5 }] },
      { changes: [{ id: e.id, rating: 8.333 }] },
      { changes: [{ id: e.id, rating: 5 }, { id: e.id, rating: 6 }] },
      { changes: Array.from({ length: 1001 }, (_, i) => ({ id: `id${i}`, rating: 5 })) },
      { changes: 'x' },
      {},
      { changes: [{ id: '', rating: 5 }] },
      { changes: [{ id: 'x'.repeat(65), rating: 5 }] },
      { changes: [{ id: 3, rating: 5 }] },
      { changes: [], doneEntryId: 5 },
    ];
    for (const b of bad) expect((await f(b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
  });

  it('returns the saved entries with their new ratings and updated_at', async () => {
    const e = await mk(A, { rating: 4 });
    const res = await as(A, '/api/compare/save', 'POST', { changes: [{ id: e.id, rating: 9.25 }] });
    const json = (await res.json()) as { updated: number; entries: Entry[] };
    expect(json.entries[0]!.rating).toBe(9.25);
    expect(json.entries[0]!.updatedAt >= e.updatedAt).toBe(true);
    expect(json.entries[0]!.updatedAt).not.toBe('');
  });
});
