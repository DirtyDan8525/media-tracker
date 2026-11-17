import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { Entry } from '@media-tracker/shared';
import { validateEntryInput } from '../src/api/entryValidation';
import { formatDetails as anilistDetails } from '../src/lookup/sources/anilist';
import { formatDetails as kitsuDetails, formatMangaDetails } from '../src/lookup/sources/kitsu';

const A = 'a@example.com';
const as = (path: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: A } as Env,
  );
const mk = async (body: Record<string, unknown> = {}) => {
  const res = await as('/api/entries', 'POST', { category: 'anime', title: 'T', lookupState: 'ok', ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: Entry }).entry;
};

afterEach(async () => {
  await env.DB.exec('DELETE FROM users');
});

describe('progress validation', () => {
  const ok = (v: unknown, cat: 'anime' | 'movies' = 'anime') => validateEntryInput(v, 'patch', cat).ok;
  it('accepts integers 0..100000', () => {
    expect(ok({ progress: 0 })).toBe(true);
    expect(ok({ progress: 100000 })).toBe(true);
    expect(ok({ progressTotal: 24 })).toBe(true);
    expect(ok({ progressTotal: null })).toBe(true);
  });
  it('rejects negatives, fractions, too big, non-numbers', () => {
    for (const bad of [-1, 1.5, 100001, '3', NaN, null, true]) expect(ok({ progress: bad })).toBe(false);
    for (const bad of [-1, 2.5, 100001, '3']) expect(ok({ progressTotal: bad })).toBe(false);
  });
  it('rejects progress above a total sent in the same body', () => {
    expect(ok({ progress: 25, progressTotal: 24 })).toBe(false);
    expect(ok({ progress: 24, progressTotal: 24 })).toBe(true);
  });
});

describe('progress API', () => {
  it('starts null; PATCH sets and returns it; export includes it', async () => {
    const e = await mk({ status: 'Watching / In Progress' });
    expect(e.progress ?? null).toBeNull();
    expect(e.progressTotal ?? null).toBeNull();
    const res = await as(`/api/entries/${e.id}`, 'PATCH', { progress: 7, progressTotal: 24 });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Entry;
    expect([saved.progress, saved.progressTotal]).toEqual([7, 24]);
    const exp = (await (await as('/api/export')).json()) as { entries: Entry[] };
    expect([exp.entries[0]!.progress, exp.entries[0]!.progressTotal]).toEqual([7, 24]);
  });
  it('can be created with progress', async () => {
    const e = await mk({ progress: 3, progressTotal: 12 });
    expect([e.progress, e.progressTotal]).toEqual([3, 12]);
  });
  it('rejects progress above the stored total, and a total below the stored progress', async () => {
    const e = await mk({ progress: 5, progressTotal: 10 });
    expect((await as(`/api/entries/${e.id}`, 'PATCH', { progress: 11 })).status).toBe(400);
    expect((await as(`/api/entries/${e.id}`, 'PATCH', { progressTotal: 4 })).status).toBe(400);
    expect((await as(`/api/entries/${e.id}`, 'PATCH', { progress: 10 })).status).toBe(200);
  });
  it('a progress change does not post to the feed', async () => {
    const e = await mk({ status: 'Watching / In Progress' });
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity').first<{ n: number }>();
    await as(`/api/entries/${e.id}`, 'PATCH', { progress: 2 });
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe('migration 0010', () => {
  it('adds nullable progress columns; existing-style rows read null', async () => {
    const cols = (await env.DB.prepare("SELECT name, \"notnull\" AS nn FROM pragma_table_info('entries') WHERE name IN ('progress','progress_total')").all<{ name: string; nn: number }>()).results;
    expect(cols.map((c) => c.name).sort()).toEqual(['progress', 'progress_total']);
    expect(cols.every((c) => c.nn === 0)).toBe(true);
  });
});

describe('lookups fill progressTotal', () => {
  it('anime episodes (AniList, Kitsu) and manga chapters (Kitsu)', () => {
    expect(anilistDetails({ id: 1, episodes: 28 }).progressTotal).toBe(28);
    expect('progressTotal' in anilistDetails({ id: 1 })).toBe(false);
    expect(kitsuDetails({ episodeCount: 12 }).progressTotal).toBe(12);
    expect(formatMangaDetails({ volumeCount: 41, chapterCount: 364 }).progressTotal).toBe(364);
    expect('progressTotal' in formatMangaDetails({ volumeCount: 3 })).toBe(false);
  });
});
