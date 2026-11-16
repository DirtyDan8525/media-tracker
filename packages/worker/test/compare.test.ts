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

// The Sheet engine's save wrote `rating` alone, bypassing the tier model, so it is switched off
// until Task 12 deletes it (Tasks 6–8 review, Important 2).
describe('compare save (retired)', () => {
  it('answers 410 gone for any body and writes nothing', async () => {
    const e = await mk(A, { rating: 4 });
    for (const body of [{ changes: [{ id: e.id, rating: 9.25 }] }, { changes: [] }, {}, 'x']) {
      const res = await as(A, '/api/compare/save', 'POST', body);
      expect(res.status).toBe(410);
      expect(await res.json()).toMatchObject({ error: 'gone' });
    }
    const row = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(e.id).first<{ rating: number }>();
    expect(row!.rating).toBe(4);
    expect((await queue(A)).map((i) => i.entryId)).toEqual([e.id]);
  });
});
