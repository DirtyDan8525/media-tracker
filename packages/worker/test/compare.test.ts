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
  const res = await as(email, '/api/entries', 'POST', { category: 'anime', title: 't', allowDuplicate: true, ...body });
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

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

// Rows put straight into the queue (old clients filled it; nothing does now, Ruling N9).
async function enqueue(email: string, entryId: string): Promise<void> {
  const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  await env.DB.prepare('INSERT INTO compare_queue (user_id, entry_id, added_at) VALUES (?, ?, ?)')
    .bind(u!.id, entryId, new Date().toISOString()).run();
}

describe('compare queue', () => {
  it('is no longer filled (N9): not by a typed rating, a create with a rating, or any Ask setting', async () => {
    for (const ask of ['Both', 'Only for new ratings', 'Only when I start it', 'Off']) {
      expect((await setAsk(A, ask)).status).toBe(200);
      const e = await mk(A, { rating: 9 });
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

  it('hides queued titles that were unrated; deleting the entry removes them', async () => {
    const e1 = await mk(A, { rating: 8 });
    const e2 = await mk(A, { rating: 7 });
    await enqueue(A, e1.id);
    await enqueue(A, e2.id);
    await rate(A, e1.id, null);
    expect((await queue(A)).map((i) => i.entryId)).toEqual([e2.id]);
    await as(A, `/api/entries/${e2.id}`, 'DELETE');
    expect(await queue(A)).toEqual([]);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM compare_queue WHERE entry_id = ?').bind(e2.id).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('DELETE /queue/:entryId is 204, also when absent, and only touches your own row', async () => {
    const e = await mk(A, { rating: 8 });
    await enqueue(A, e.id);
    await as(B, '/api/compare/queue');
    expect((await as(B, `/api/compare/queue/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await queue(A)).length).toBe(1);
    expect((await as(A, `/api/compare/queue/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await as(A, `/api/compare/queue/${e.id}`, 'DELETE')).status).toBe(204);
    expect(await queue(A)).toEqual([]);
  });
});

// The Sheet engine's save is gone (Ruling Q1). Ratings are saved through POST /api/ratings/:set/save.
describe('compare save (deleted)', () => {
  it('POST /api/compare/save is 404 and writes nothing', async () => {
    const e = await mk(A, { rating: 4 });
    for (const body of [{ changes: [{ id: e.id, rating: 9.25 }] }, { changes: [] }, {}]) {
      expect((await as(A, '/api/compare/save', 'POST', body)).status).toBe(404);
    }
    const row = await env.DB.prepare('SELECT rating FROM entries WHERE id = ?').bind(e.id).first<{ rating: number }>();
    expect(row!.rating).toBe(4);
    expect(await queue(A)).toEqual([]);
  });
});
