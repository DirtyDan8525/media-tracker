import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS, importStatementCount } from '../src/api/import';
import { D1_MAX_QUERIES } from '../src/env';
import type { Env } from '../src/env';
import type { Entry, ImportRow } from '@media-tracker/shared';

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

const row = (i: number, extra: Partial<ImportRow> = {}): ImportRow => ({
  category: 'movies', title: `Movie ${i}`, status: null, rating: 7.5, genres: 'g', creator: 'dir', album: '', coverUrl: '', notes: '', ...extra,
});
const post = (email: string, importId: string, rows: unknown) => as(email, '/api/import', 'POST', { importId, rows });
const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM imports');
});

describe('chunk limits', () => {
  it('worst-case chunk fits the D1 query budget', () => {
    expect(IMPORT_CHUNK_ROWS).toBeGreaterThan(50);
    expect(importStatementCount(IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS)).toBeLessThanOrEqual(D1_MAX_QUERIES - 4);
    expect(importStatementCount(IMPORT_CHUNK_ROWS + 1, 0)).toBeGreaterThan(importStatementCount(IMPORT_CHUNK_ROWS, 0));
  });
});

describe('POST /api/import chunk idempotency', () => {
  const postChunk = (importId: string, chunk: unknown, rows: unknown) => as(A, '/api/import', 'POST', { importId, chunk, rows });

  it('a repeated chunk index inserts nothing, says duplicate, and leaves counts correct', async () => {
    const id = crypto.randomUUID();
    const first = await postChunk(id, 0, [row(1), row(2)]);
    expect(await first.json()).toEqual({ inserted: 2 });
    const again = await postChunk(id, 0, [row(1), row(2)]);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ inserted: 0, duplicate: true });
    expect(await count(`SELECT COUNT(*) n FROM entries WHERE import_id = '${id}'`)).toBe(2);

    // the next index is applied normally, and a repeat of either is still a no-op
    expect(await (await postChunk(id, 1, [row(3)])).json()).toEqual({ inserted: 1 });
    expect(await (await postChunk(id, 1, [row(3)])).json()).toEqual({ inserted: 0, duplicate: true });
    expect(await (await postChunk(id, 0, [row(1), row(2)])).json()).toEqual({ inserted: 0, duplicate: true });
    expect(await count(`SELECT COUNT(*) n FROM entries WHERE import_id = '${id}'`)).toBe(3);
    const imp = await env.DB.prepare('SELECT counts_json FROM imports WHERE id = ?').bind(id).first<{ counts_json: string }>();
    expect(JSON.parse(imp!.counts_json)).toEqual({ total: 3, movies: 3, chunks: [0, 1] });
  });

  it('a duplicate costs only the imports-row read (no writes) and undo still removes everything', async () => {
    const id = crypto.randomUUID();
    await postChunk(id, 0, [row(1)]);
    const before = await count('SELECT COUNT(*) n FROM entries');
    await postChunk(id, 0, [row(1)]);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(before);
    const del = await as(A, `/api/import/${id}`, 'DELETE');
    expect(await del.json()).toEqual({ deleted: 1 });
  });

  it('chunk is optional (older clients), but must be a non-negative integer when present', async () => {
    const id = crypto.randomUUID();
    expect((await post(A, id, [row(1)])).status).toBe(200);
    expect((await post(A, id, [row(1)])).status).toBe(200); // no index: no dedup, as before
    for (const bad of [-1, 1.5, '0', null, 1e9]) expect((await postChunk(id, bad, [row(9)])).status).toBe(400);
  });

  it('another user cannot replay or probe a chunk of someone else\'s import', async () => {
    const id = crypto.randomUUID();
    await postChunk(id, 0, [row(1)]);
    const res = await as(B, '/api/import', 'POST', { importId: id, chunk: 0, rows: [row(1)] });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/import', () => {
  it('imports 600 rows across chunks under one importId', async () => {
    const id = crypto.randomUUID();
    let inserted = 0;
    const rows = Array.from({ length: 600 }, (_, i) => row(i));
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK_ROWS) {
      const res = await post(A, id, rows.slice(i, i + IMPORT_CHUNK_ROWS));
      expect(res.status).toBe(200);
      inserted += ((await res.json()) as { inserted: number }).inserted;
    }
    expect(inserted).toBe(600);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(600);
    expect(await count(`SELECT COUNT(*) n FROM entries WHERE import_id = '${id}'`)).toBe(600);
    const imp = await env.DB.prepare('SELECT * FROM imports WHERE id = ?').bind(id).first<{ counts_json: string; user_id: string }>();
    expect(JSON.parse(imp!.counts_json)).toMatchObject({ total: 600, movies: 600 });
  });

  it('stores fields, lookup_state from the cover, typed_title, seasons, and no seasonAvg surprises', async () => {
    const id = crypto.randomUUID();
    const res = await post(A, id, [
      row(1, { category: 'anime', title: 'Frieren', status: 'Completed', rating: 10, coverUrl: 'https://img.test/f.jpg', genres: 'Fantasy', creator: 'Madhouse', notes: 'n',
        seasons: [{ label: 'S1', rating: 9, notes: '' }, { label: 'S2', rating: null, notes: 'x' }] }),
      row(2, { category: 'songs', title: 'Creep', album: 'Pablo Honey' }),
    ]);
    expect(res.status).toBe(200);
    const list = (await (await as(A, '/api/entries')).json()) as Entry[];
    const f = list.find((e) => e.title === 'Frieren')!;
    expect(f).toMatchObject({ category: 'anime', status: 'Completed', rating: 10, coverUrl: 'https://img.test/f.jpg', lookupState: 'ok',
      detailsState: 'none', typedTitle: 'Frieren', importId: id, seasonAvg: 9, creator: 'Madhouse' });
    const c = list.find((e) => e.title === 'Creep')!;
    expect(c).toMatchObject({ lookupState: 'not_found', album: 'Pablo Honey', importId: id });
    const seasons = (await (await as(A, `/api/entries/${f.id}/seasons`)).json()) as { label: string }[];
    expect(seasons.map((s) => s.label)).toEqual(['S1', 'S2']);
  });

  it('chunk with seasons at the limits inserts in one request', async () => {
    const seasons = Array.from({ length: IMPORT_CHUNK_SEASONS }, (_, i) => ({ label: `S${i}`, rating: 5, notes: '' }));
    const rows = Array.from({ length: IMPORT_CHUNK_ROWS }, (_, i) => row(i, { category: 'anime', status: 'Completed', seasons: i === 0 ? seasons : undefined }));
    const res = await post(A, crypto.randomUUID(), rows);
    expect(res.status).toBe(200);
    expect(await count('SELECT COUNT(*) n FROM seasons')).toBe(IMPORT_CHUNK_SEASONS);
  });

  it('a chunk larger than the limit is 400 too_large and writes nothing', async () => {
    const id = crypto.randomUUID();
    const res = await post(A, id, Array.from({ length: IMPORT_CHUNK_ROWS + 1 }, (_, i) => row(i)));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'too_large' });
    const seasons = Array.from({ length: IMPORT_CHUNK_SEASONS + 1 }, (_, i) => ({ label: `S${i}`, rating: 5, notes: '' }));
    const res2 = await post(A, id, [row(1, { category: 'anime', seasons })]);
    expect(res2.status).toBe(400);
    expect(await res2.json()).toMatchObject({ error: 'too_large' });
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM imports')).toBe(0);
  });

  it('one invalid row rejects the whole chunk with nothing written', async () => {
    const id = crypto.randomUUID();
    const res = await post(A, id, [row(1), row(2), row(3, { rating: 11 }), row(4)]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM imports')).toBe(0);
  });

  it('rejects bad shapes: non-uuid id, empty/non-array rows, bad category, status on movies, seasons on movies', async () => {
    expect((await post(A, 'not-a-uuid', [row(1)])).status).toBe(400);
    expect((await post(A, crypto.randomUUID(), [])).status).toBe(400);
    expect((await post(A, crypto.randomUUID(), 'x')).status).toBe(400);
    expect((await post(A, crypto.randomUUID(), [{ ...row(1), category: 'nope' }])).status).toBe(400);
    expect((await post(A, crypto.randomUUID(), [row(1, { status: 'Completed' })])).status).toBe(400);
    expect((await post(A, crypto.randomUUID(), [row(1, { seasons: [{ label: 'S', rating: null, notes: '' }] })])).status).toBe(400);
    expect((await post(A, crypto.randomUUID(), [row(1, { category: 'anime', seasons: [{ label: 'S', rating: 11, notes: '' }] })])).status).toBe(400);
    expect((await as(A, '/api/import', 'POST', { rows: [row(1)] })).status).toBe(400);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(0);
  });

  it("an importId owned by another user is 404 and writes nothing", async () => {
    const id = crypto.randomUUID();
    expect((await post(A, id, [row(1)])).status).toBe(200);
    const res = await post(B, id, [row(2)]);
    expect(res.status).toBe(404);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(1);
  });
});

describe('undo across chunks', () => {
  it('undo after a 600-row multi-chunk import removes all 600 and leaves other entries', async () => {
    await as(A, '/api/entries', 'POST', { category: 'movies', title: 'Keep me' });
    const id = crypto.randomUUID();
    const rows = Array.from({ length: 600 }, (_, i) => row(i));
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK_ROWS) {
      expect((await post(A, id, rows.slice(i, i + IMPORT_CHUNK_ROWS))).status).toBe(200);
    }
    const res = await as(A, `/api/import/${id}`, 'DELETE');
    expect(await res.json()).toEqual({ deleted: 600 });
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM imports')).toBe(0);
  });

  it('a later chunk failing validation leaves earlier chunks, and undo removes them', async () => {
    const id = crypto.randomUUID();
    expect((await post(A, id, [row(1), row(2)])).status).toBe(200);
    expect((await post(A, id, [row(3), row(4, { rating: 11 })])).status).toBe(400);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(2);
    const imp = await env.DB.prepare('SELECT counts_json FROM imports WHERE id = ?').bind(id).first<{ counts_json: string }>();
    expect(JSON.parse(imp!.counts_json)).toMatchObject({ total: 2 });
    const res = await as(A, `/api/import/${id}`, 'DELETE');
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(0);
  });
});

describe('DELETE /api/import/:id', () => {
  it('removes exactly that import (entries + seasons + imports row); other entries untouched', async () => {
    const keep = await as(A, '/api/entries', 'POST', { category: 'movies', title: 'Keep me' });
    expect(keep.status).toBe(201);
    const other = crypto.randomUUID();
    await post(A, other, [row(100)]);
    const id = crypto.randomUUID();
    await post(A, id, Array.from({ length: 30 }, (_, i) => row(i, { category: 'anime', status: null, seasons: [{ label: 'S1', rating: 8, notes: '' }] })));
    await post(B, crypto.randomUUID(), [row(5)]);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(33);
    expect(await count('SELECT COUNT(*) n FROM seasons')).toBe(30);

    const res = await as(A, `/api/import/${id}`, 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 30 });
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(3);
    expect(await count('SELECT COUNT(*) n FROM seasons')).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM imports WHERE id = '${id}'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM imports WHERE id = '${other}'`)).toBe(1);
    const titles = ((await (await as(A, '/api/entries')).json()) as Entry[]).map((e) => e.title).sort();
    expect(titles).toEqual(['Keep me', 'Movie 100']);
  });

  it("another user's DELETE is 404 and deletes nothing; unknown id is 404", async () => {
    const id = crypto.randomUUID();
    await post(A, id, [row(1), row(2)]);
    expect((await as(B, `/api/import/${id}`, 'DELETE')).status).toBe(404);
    expect(await count('SELECT COUNT(*) n FROM entries')).toBe(2);
    expect((await as(A, `/api/import/${crypto.randomUUID()}`, 'DELETE')).status).toBe(404);
    expect((await as(A, '/api/import/zzz', 'DELETE')).status).toBe(404);
  });
});
