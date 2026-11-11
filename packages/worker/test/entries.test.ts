import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { validateEntryInput, validateSeasonInput } from '../src/api/entries';
import type { Env } from '../src/env';
import type { Entry, Season } from '@media-tracker/shared';

const A = 'a@example.com';
const B = 'b@example.com';
const SECRETS = { TMDB_KEY: 'fake-tmdb-key-xyz', IGDB_ID: 'fake-igdb-id-xyz', IGDB_SECRET: 'fake-igdb-secret-xyz' };

const as = (email: string, path: string, method = 'GET', body?: unknown, raw?: string) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    { ...env, ...SECRETS, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

type Created = { entry: Entry; duplicateOf: string | null };
const create = async (email: string, body: unknown) => {
  const res = await as(email, '/api/entries', 'POST', body);
  return { res, json: (await res.clone().json()) as Created };
};
const mk = async (email: string, body: Record<string, unknown>) => {
  const { res, json } = await create(email, body);
  expect(res.status).toBe(201);
  return json.entry;
};
const addSeason = async (email: string, entryId: string, body: unknown) => {
  const res = await as(email, `/api/entries/${entryId}/seasons`, 'POST', body);
  return { res, json: (await res.clone().json()) as Season };
};

afterEach(async () => {
  await env.DB.exec('DELETE FROM users'); // cascades to entries, seasons
});

describe('validateEntryInput', () => {
  const ok = (input: unknown, mode: 'create' | 'patch' = 'create', cat: Parameters<typeof validateEntryInput>[2] = 'anime') =>
    validateEntryInput(input, mode, cat).ok;

  it('requires a non-empty title on create, not on patch', () => {
    expect(ok({})).toBe(false);
    expect(ok({ title: '   ' })).toBe(false);
    expect(ok({ title: 'x' })).toBe(true);
    expect(ok({ notes: 'n' }, 'patch')).toBe(true);
    expect(ok({ title: '' }, 'patch')).toBe(false);
  });

  it('rating: null or 0-10 with at most 2 decimals', () => {
    for (const r of [null, 0, 10, 8.5, 7.25, 0.1, 0.29, 1.15]) expect(ok({ title: 't', rating: r })).toBe(true);
    for (const r of [-0.01, 10.01, 7.255, NaN, Infinity, '8', true, [8]]) expect(ok({ title: 't', rating: r })).toBe(false);
  });

  it('status: null or a valid value, null-only when category has no status', () => {
    expect(ok({ title: 't', status: 'Completed' })).toBe(true);
    expect(ok({ title: 't', status: null })).toBe(true);
    expect(ok({ title: 't', status: 'Done' })).toBe(false);
    expect(ok({ title: 't', status: 'Completed' }, 'create', 'albums')).toBe(false);
    expect(ok({ title: 't', status: null }, 'create', 'albums')).toBe(true);
    expect(ok({ status: 'Dropped' }, 'patch', 'movies')).toBe(false);
  });

  it('enums, booleans, releaseDate, cover url, and string bounds', () => {
    expect(ok({ title: 't', source: 'tmdb' })).toBe(true);
    expect(ok({ title: 't', source: null })).toBe(true);
    expect(ok({ title: 't', source: 'imdb' })).toBe(false);
    expect(ok({ title: 't', lookupState: 'weird' })).toBe(false);
    expect(ok({ title: 't', detailsState: 'needs_review' })).toBe(true);
    expect(ok({ title: 't', detailsState: 'x' })).toBe(false);
    expect(ok({ title: 't', isPrivate: 1 })).toBe(false);
    expect(ok({ title: 't', notesPrivate: false })).toBe(true);
    for (const d of ['', '2020', '2020-05-01']) expect(ok({ title: 't', releaseDate: d })).toBe(true);
    for (const d of ['20', '2020-5-1', 'May 2020', 2020]) expect(ok({ title: 't', releaseDate: d })).toBe(false);
    expect(ok({ title: 't', coverUrl: '' })).toBe(true);
    expect(ok({ title: 't', coverUrl: 'https://x.test/a.jpg' })).toBe(true);
    expect(ok({ title: 't', coverUrl: 'javascript:alert(1)' })).toBe(false);
    expect(ok({ title: 't', coverUrl: 'not a url' })).toBe(false);
    expect(ok({ title: 't', coverUrl: 'https://x.test/' + 'a'.repeat(2000) })).toBe(false);
    expect(ok({ title: 'a'.repeat(300) })).toBe(true);
    expect(ok({ title: 'a'.repeat(301) })).toBe(false);
    expect(ok({ title: 't', notes: 'a'.repeat(5000) })).toBe(true);
    expect(ok({ title: 't', notes: 'a'.repeat(5001) })).toBe(false);
    expect(ok({ title: 't', creator: 'a'.repeat(301) })).toBe(false);
  });

  it('drops server-owned and unknown keys', () => {
    const r = validateEntryInput(
      { title: 't', id: 'x', userId: 'u', category: 'movies', importId: 'i', createdAt: 'c', junk: 1 },
      'create',
      'anime',
    );
    expect(r).toEqual({ ok: true, value: { title: 't' } });
  });

  it('rejects non-objects', () => {
    expect(ok(null)).toBe(false);
    expect(ok([])).toBe(false);
    expect(ok('x')).toBe(false);
  });
});

describe('validateSeasonInput', () => {
  it('checks label, rating and notes', () => {
    expect(validateSeasonInput({ label: 'S1', rating: 8.5, notes: 'n' }).ok).toBe(true);
    expect(validateSeasonInput({ label: 'a'.repeat(101) }).ok).toBe(false);
    expect(validateSeasonInput({ rating: 11 }).ok).toBe(false);
    expect(validateSeasonInput({ notes: 'a'.repeat(5001) }).ok).toBe(false);
    expect(validateSeasonInput([]).ok).toBe(false);
  });
});

describe('entries create / list / get', () => {
  it('creates then lists, with defaults and server-set fields', async () => {
    const { res, json } = await create(A, { category: 'anime', title: 'Frieren', rating: 9.5, status: 'Completed', isPrivate: true });
    expect(res.status).toBe(201);
    expect(json.duplicateOf).toBeNull();
    expect(json.entry).toMatchObject({
      category: 'anime', title: 'Frieren', typedTitle: 'Frieren', rating: 9.5, status: 'Completed',
      isPrivate: true, notesPrivate: false, lookupState: 'pending', detailsState: 'none',
      source: null, sourceId: null, importId: null, seasonAvg: null, genres: '', coverUrl: '',
    });
    expect(json.entry.id).toBeTruthy();
    expect(json.entry.createdAt).toBe(json.entry.updatedAt);

    const list = (await (await as(A, '/api/entries?category=anime')).json()) as Entry[];
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(json.entry);
  });

  it('filters by category and rejects an unknown category filter', async () => {
    await mk(A, { category: 'anime', title: 'X' });
    await mk(A, { category: 'movies', title: 'Y' });
    const anime = (await (await as(A, '/api/entries?category=anime')).json()) as Entry[];
    expect(anime.map((e) => e.title)).toEqual(['X']);
    const all = (await (await as(A, '/api/entries')).json()) as Entry[];
    expect(all).toHaveLength(2);
    expect((await as(A, '/api/entries?category=nope')).status).toBe(400);
  });

  it('only lists your own entries', async () => {
    await mk(A, { category: 'anime', title: 'Mine' });
    await mk(B, { category: 'anime', title: 'Theirs' });
    const list = (await (await as(A, '/api/entries')).json()) as Entry[];
    expect(list.map((e) => e.title)).toEqual(['Mine']);
  });

  it('typedTitle defaults to title but can be given; importId is not settable', async () => {
    const e = await mk(A, { category: 'games', title: 'Hades', typedTitle: 'hades', importId: 'imp1' });
    expect(e.typedTitle).toBe('hades');
    expect(e.importId).toBeNull();
  });

  it('400 on missing/invalid category, empty title, bad JSON', async () => {
    for (const body of [{ title: 't' }, { category: 'podcasts', title: 't' }, { category: 'anime', title: ' ' }, { category: 'anime' }]) {
      expect((await create(A, body)).res.status).toBe(400);
    }
    expect((await as(A, '/api/entries', 'POST', undefined, '{nope')).status).toBe(400);
    expect(await (await as(A, '/api/entries', 'POST', { category: 'anime' })).json()).toEqual({ error: 'invalid' });
  });

  it('400 on bad rating values', async () => {
    for (const rating of [-1, 10.5, 7.123, '8']) {
      expect((await create(A, { category: 'anime', title: 't', rating })).res.status).toBe(400);
    }
    expect((await create(A, { category: 'anime', title: 't', rating: 7.25 })).res.status).toBe(201);
    expect((await create(A, { category: 'anime', title: 't2', rating: null })).res.status).toBe(201);
  });

  it('400 on bad status; non-null status is rejected where hasStatus is false', async () => {
    expect((await create(A, { category: 'anime', title: 't', status: 'Finished' })).res.status).toBe(400);
    expect((await create(A, { category: 'albums', title: 't', status: 'Completed' })).res.status).toBe(400);
    expect((await create(A, { category: 'movies', title: 't', status: 'Completed' })).res.status).toBe(400);
    expect((await create(A, { category: 'movies', title: 't', status: null })).res.status).toBe(201);
  });

  it('GET /api/entries/:id returns yours, 404 for others and unknown', async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    expect((await as(A, `/api/entries/${e.id}`)).status).toBe(200);
    const other = await as(B, `/api/entries/${e.id}`);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'not_found' });
    expect((await as(A, '/api/entries/nope')).status).toBe(404);
  });
});

describe('duplicateOf', () => {
  it('a duplicate album (same title and creator) still saves, with duplicateOf set', async () => {
    const first = await mk(A, { category: 'albums', title: 'Discovery', creator: 'Daft Punk' });
    const { res, json } = await create(A, { category: 'albums', title: ' discovery ', creator: 'daft punk' });
    expect(res.status).toBe(201);
    expect(json.duplicateOf).toBe(first.id);
    expect(json.entry.id).not.toBe(first.id);
    expect(((await (await as(A, '/api/entries?category=albums')).json()) as Entry[]).length).toBe(2);
  });

  it('is null for a different creator, a different category, or another user', async () => {
    await mk(A, { category: 'albums', title: 'Discovery', creator: 'Daft Punk' });
    await mk(B, { category: 'albums', title: 'Discovery', creator: 'Daft Punk' });
    expect((await create(A, { category: 'albums', title: 'Discovery', creator: 'Someone Else' })).json.duplicateOf).toBeNull();
    expect((await create(A, { category: 'songs', title: 'Discovery', creator: 'Daft Punk' })).json.duplicateOf).toBeNull();
    const c = await create(A, { category: 'albums', title: 'Discovery', creator: 'Daft Punk' });
    expect(c.json.duplicateOf).not.toBeNull();
  });
});

describe('duplicateOf user scoping', () => {
  it("never matches another user's entry (only B owns the matching row)", async () => {
    const theirs = await mk(B, { category: 'albums', title: 'Discovery', creator: 'Daft Punk' });
    const { res, json } = await create(A, { category: 'albums', title: 'Discovery', creator: 'Daft Punk' });
    expect(res.status).toBe(201);
    expect(json.duplicateOf).toBeNull();
    expect(JSON.stringify(json)).not.toContain(theirs.id);
  });
});

describe('PATCH /api/entries/:id', () => {
  it('updates fields, bumps updatedAt, returns the full entry with seasonAvg', async () => {
    const e = await mk(A, { category: 'anime', title: 'Old' });
    await addSeason(A, e.id, { label: 'S1', rating: 8 });
    await new Promise((r) => setTimeout(r, 5));
    const res = await as(A, `/api/entries/${e.id}`, 'PATCH', {
      title: 'New', rating: 9, status: 'Dropped', isPrivate: true, category: 'movies', id: 'evil', userId: 'evil', importId: 'x', createdAt: 'x',
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as Entry;
    expect(p).toMatchObject({
      id: e.id, userId: e.userId, category: 'anime', title: 'New', rating: 9, status: 'Dropped',
      isPrivate: true, importId: null, createdAt: e.createdAt, seasonAvg: 8,
    });
    expect(p.updatedAt > e.updatedAt).toBe(true);
  });

  it('does not touch fields it was not sent; can null a rating', async () => {
    const e = await mk(A, { category: 'anime', title: 'T', rating: 7, notes: 'keep' });
    const p = (await (await as(A, `/api/entries/${e.id}`, 'PATCH', { rating: null })).json()) as Entry;
    expect(p.rating).toBeNull();
    expect(p.notes).toBe('keep');
  });

  it('validates against the stored category', async () => {
    const album = await mk(A, { category: 'albums', title: 'T' });
    expect((await as(A, `/api/entries/${album.id}`, 'PATCH', { status: 'Completed' })).status).toBe(400);
    const anime = await mk(A, { category: 'anime', title: 'T' });
    expect((await as(A, `/api/entries/${anime.id}`, 'PATCH', { rating: 11 })).status).toBe(400);
    expect((await as(A, `/api/entries/${anime.id}`, 'PATCH', { title: '' })).status).toBe(400);
  });

  it("404 for another user's entry, and nothing changes", async () => {
    const e = await mk(A, { category: 'anime', title: 'Mine' });
    const res = await as(B, `/api/entries/${e.id}`, 'PATCH', { title: 'Hacked' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(((await (await as(A, `/api/entries/${e.id}`)).json()) as Entry).title).toBe('Mine');
  });
});

describe('seasons', () => {
  it('seasonAvg of seasons rated 8, 9 and null is 8.5', async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    await addSeason(A, e.id, { label: 'S1', rating: 8 });
    await addSeason(A, e.id, { label: 'S2', rating: 9 });
    await addSeason(A, e.id, { label: 'S3', rating: null });
    const list = (await (await as(A, '/api/entries?category=anime')).json()) as Entry[];
    expect(list[0]!.seasonAvg).toBe(8.5);
    expect(((await (await as(A, `/api/entries/${e.id}`)).json()) as Entry).seasonAvg).toBe(8.5);
  });

  it('seasonAvg rounds to 2 decimals and is null with no rated seasons', async () => {
    const e = await mk(A, { category: 'tv', title: 'X' });
    expect(e.seasonAvg).toBeNull();
    await addSeason(A, e.id, { rating: null });
    expect(((await (await as(A, `/api/entries/${e.id}`)).json()) as Entry).seasonAvg).toBeNull();
    await addSeason(A, e.id, { rating: 8 });
    await addSeason(A, e.id, { rating: 8 });
    await addSeason(A, e.id, { rating: 9 });
    expect(((await (await as(A, `/api/entries/${e.id}`)).json()) as Entry).seasonAvg).toBe(8.33);
  });

  it('POST returns 201 Season; GET lists them; PATCH and DELETE work', async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    const { res, json: s } = await addSeason(A, e.id, { label: 'S1', rating: 7.5, notes: 'n' });
    expect(res.status).toBe(201);
    expect(s).toMatchObject({ entryId: e.id, label: 'S1', rating: 7.5, notes: 'n' });
    const list = (await (await as(A, `/api/entries/${e.id}/seasons`)).json()) as Season[];
    expect(list).toEqual([s]);

    const pr = await as(A, `/api/seasons/${s.id}`, 'PATCH', { rating: 9, label: 'Season 1' });
    expect(pr.status).toBe(200);
    expect(await pr.json()).toEqual({ ...s, rating: 9, label: 'Season 1' });
    expect((await as(A, `/api/seasons/${s.id}`, 'PATCH', { rating: null })).status).toBe(200);

    expect((await as(A, `/api/seasons/${s.id}`, 'DELETE')).status).toBe(204);
    expect(await (await as(A, `/api/entries/${e.id}/seasons`)).json()).toEqual([]);
    expect((await as(A, `/api/seasons/${s.id}`, 'DELETE')).status).toBe(404);
  });

  it('seasons are listed in creation order', async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    for (const label of ['S1', 'S2', 'S3']) {
      await addSeason(A, e.id, { label });
      await new Promise((r) => setTimeout(r, 3));
    }
    const list = (await (await as(A, `/api/entries/${e.id}/seasons`)).json()) as Season[];
    expect(list.map((s) => s.label)).toEqual(['S1', 'S2', 'S3']);
  });

  it('validates season input', async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    expect((await addSeason(A, e.id, { rating: 11 })).res.status).toBe(400);
    expect((await addSeason(A, e.id, { rating: 7.777 })).res.status).toBe(400);
    expect((await addSeason(A, e.id, { label: 'a'.repeat(101) })).res.status).toBe(400);
    const s = (await addSeason(A, e.id, { label: 'ok' })).json;
    expect((await as(A, `/api/seasons/${s.id}`, 'PATCH', { notes: 'a'.repeat(5001) })).status).toBe(400);
  });

  it('categories without seasons answer 400 no_seasons', async () => {
    const m = await mk(A, { category: 'movies', title: 'X' });
    for (const [path, method] of [[`/api/entries/${m.id}/seasons`, 'GET'], [`/api/entries/${m.id}/seasons`, 'POST']] as const) {
      const res = await as(A, path, method, method === 'POST' ? { label: 'S1' } : undefined);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'no_seasons' });
    }
  });

  it("another user's seasons routes answer 404", async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    const s = (await addSeason(A, e.id, { label: 'S1', rating: 8 })).json;
    expect((await as(B, `/api/entries/${e.id}/seasons`)).status).toBe(404);
    expect((await as(B, `/api/entries/${e.id}/seasons`, 'POST', { label: 'x' })).status).toBe(404);
    const p = await as(B, `/api/seasons/${s.id}`, 'PATCH', { rating: 1 });
    expect(p.status).toBe(404);
    expect(await p.json()).toEqual({ error: 'not_found' });
    expect((await as(B, `/api/seasons/${s.id}`, 'DELETE')).status).toBe(404);
    const still = (await (await as(A, `/api/entries/${e.id}/seasons`)).json()) as Season[];
    expect(still).toEqual([s]);
  });
});

describe('DELETE /api/entries/:id', () => {
  it('deletes the entry and its seasons', async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    const other = await mk(A, { category: 'anime', title: 'Keep' });
    await addSeason(A, e.id, { label: 'S1' });
    await addSeason(A, e.id, { label: 'S2' });
    await addSeason(A, other.id, { label: 'K1' });
    expect((await as(A, `/api/entries/${e.id}`, 'DELETE')).status).toBe(204);
    expect((await as(A, `/api/entries/${e.id}`)).status).toBe(404);
    const rows = await env.DB.prepare('SELECT entry_id FROM seasons').all<{ entry_id: string }>();
    expect(rows.results.map((r) => r.entry_id)).toEqual([other.id]);
  });

  it("404 for another user's or unknown entry, and nothing is deleted", async () => {
    const e = await mk(A, { category: 'anime', title: 'X' });
    await addSeason(A, e.id, { label: 'S1' });
    const res = await as(B, `/api/entries/${e.id}`, 'DELETE');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect((await as(A, '/api/entries/nope', 'DELETE')).status).toBe(404);
    expect((await as(A, `/api/entries/${e.id}`)).status).toBe(200);
    expect(((await (await as(A, `/api/entries/${e.id}/seasons`)).json()) as Season[]).length).toBe(1);
  });
});

describe('GET /api/export', () => {
  it('returns only your data, as a download, with no secrets', async () => {
    const mine = await mk(A, { category: 'anime', title: 'Mine', isPrivate: true });
    const theirs = await mk(B, { category: 'anime', title: 'Theirs' });
    const s1 = (await addSeason(A, mine.id, { label: 'S1', rating: 8 })).json;
    const s2 = (await addSeason(B, theirs.id, { label: 'Other', rating: 3 })).json;

    const res = await as(A, '/api/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="media-tracker-export.json"');
    const text = await res.text();
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
    const body = JSON.parse(text) as { entries: Entry[]; seasons: Season[]; settings: { theme: string } };
    expect(body.entries.map((e) => e.id)).toEqual([mine.id]);
    expect(body.seasons).toEqual([s1]);
    expect(text).not.toContain(theirs.id);
    expect(text).not.toContain(s2.id);
    expect(text).not.toContain('Theirs');
    expect(body.settings.theme).toBe('Midnight');
    expect(body.entries[0]!.seasonAvg).toBe(8);
  });

  it('is an empty export for a new user', async () => {
    const body = (await (await as(A, '/api/export')).json()) as { entries: unknown[]; seasons: unknown[] };
    expect(body.entries).toEqual([]);
    expect(body.seasons).toEqual([]);
  });
});
