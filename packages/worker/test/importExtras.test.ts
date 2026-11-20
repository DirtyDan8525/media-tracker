import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportRow } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';

const as = (path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: 'a@example.com' } as Env,
  );
const base = { genres: '', creator: '', album: '', coverUrl: '', notes: '' };

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM imports');
});

describe('POST /api/import extras (AniList rows)', () => {
  const rows: ImportRow[] = [
    { ...base, category: 'anime', title: 'Attack on Titan', status: 'Completed', rating: 8.5, progress: 25, progressTotal: 25, source: 'anilist', sourceId: '1', releaseDate: '2013', startedAt: '2020-01-05', finishedAt: '2020-02-01', rewatches: 1 },
    { ...base, category: 'anime', title: 'Only Romaji', status: 'Watching / In Progress', rating: null, progress: 3, source: 'anilist', sourceId: '2', isPrivate: true },
    { ...base, category: 'manga', title: 'Berserk', status: 'Watching / In Progress', rating: 7.5, progress: 40, progressTotal: 364 },
    { ...base, category: 'movies', title: 'Plain', status: null, rating: 7 },
  ];

  it('stores the extras, leaves plain rows alone, and Undo removes everything', async () => {
    const importId = crypto.randomUUID();
    expect(await (await as('/api/import', 'POST', { importId, chunk: 0, rows })).json()).toEqual({ inserted: 4 });
    const q = (t: string) => env.DB.prepare('SELECT progress, progress_total, source, source_id, release_date, is_private, started_at, finished_at, rewatches FROM entries WHERE title = ?').bind(t).first();
    expect(await q('Attack on Titan')).toEqual({ progress: 25, progress_total: 25, source: 'anilist', source_id: '1', release_date: '2013', is_private: 0, started_at: '2020-01-05', finished_at: '2020-02-01', rewatches: 1 });
    expect(await q('Only Romaji')).toEqual({ progress: 3, progress_total: null, source: 'anilist', source_id: '2', release_date: '', is_private: 1, started_at: null, finished_at: null, rewatches: 0 });
    expect(await q('Berserk')).toEqual({ progress: 40, progress_total: 364, source: null, source_id: null, release_date: '', is_private: 0, started_at: null, finished_at: null, rewatches: 0 });
    expect(await q('Plain')).toEqual({ progress: null, progress_total: null, source: null, source_id: null, release_date: '', is_private: 0, started_at: null, finished_at: null, rewatches: 0 });
    expect(await (await as(`/api/import/${importId}`, 'DELETE')).json()).toEqual({ deleted: 4 });
  });

  it('refuses a row with a bad extra (progress above total)', async () => {
    const bad = [{ ...base, category: 'anime', title: 'X', status: null, rating: null, progress: 9, progressTotal: 3 }];
    expect((await as('/api/import', 'POST', { importId: crypto.randomUUID(), rows: bad })).status).toBe(400);
  });
});
