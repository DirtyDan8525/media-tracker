import { describe, expect, it, vi } from 'vitest';
import { AniListError, aniListStatus, lookupAniList, mapAniListEntry, type FetchDeps } from '../src';
import { ANIME_RESPONSE, EMPTY_RESPONSE, MANGA_RESPONSE, NOT_FOUND_RESPONSE, PRIVATE_RESPONSE } from './fixtures/anilistImport';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

/** AniList stub: answers by the `type` variable. */
function deps(anime: Response | object, manga: Response | object) {
  const fetch = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    const type = JSON.parse(String(init?.body)).variables.type as 'ANIME' | 'MANGA';
    const r = type === 'ANIME' ? anime : manga;
    return r instanceof Response ? r.clone() : json(r);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, spy: fetch } satisfies FetchDeps & { spy: unknown };
}

describe('mapAniListEntry', () => {
  const [aot, romaji] = ANIME_RESPONSE.data.MediaListCollection.lists[0]!.entries;
  it('maps a completed anime: english title, score, progress, studio, source, year, dates, rewatches', () => {
    expect(mapAniListEntry(aot!, 'anime')).toEqual({
      category: 'anime', title: 'Attack on Titan', status: 'Completed', rating: 8.5, genres: 'Action, Drama', creator: 'Wit Studio',
      album: '', coverUrl: 'https://s4.anilist.co/file/aot.jpg', notes: 'Great ending',
      progress: 25, progressTotal: 25, source: 'anilist', sourceId: '1', releaseDate: '2013',
      startedAt: '2020-01-05', finishedAt: '2020-02-01', rewatches: 1,
    });
  });
  it('falls back to romaji, treats score 0 as unrated, keeps privacy, omits unknown totals and year', () => {
    expect(mapAniListEntry(romaji!, 'anime')).toEqual({
      category: 'anime', title: 'Only Romaji', status: 'Watching / In Progress', rating: null, genres: '', creator: '', album: '',
      coverUrl: 'https://s4.anilist.co/file/romaji.jpg', notes: '', progress: 3, source: 'anilist', sourceId: '2', isPrivate: true,
    });
  });
  it('maps manga: first staff as creator, chapters as total, no source', () => {
    const berserk = MANGA_RESPONSE.data.MediaListCollection.lists[0]!.entries[0]!;
    const r = mapAniListEntry(berserk, 'manga')!;
    expect(r).toMatchObject({ category: 'manga', creator: 'Kentaro Miura', progress: 40, progressTotal: 364, status: 'Watching / In Progress', rating: 7.5 });
    expect(r.source).toBeUndefined();
    expect(r.sourceId).toBeUndefined();
  });
  it('drops partial or impossible dates and caps the repeat count', () => {
    const base = { status: 'COMPLETED', media: { id: 7, title: { romaji: 'X' } } };
    const r = mapAniListEntry({ ...base, startedAt: { year: 2020, month: 5, day: null }, completedAt: { year: 2021, month: 2, day: 30 }, repeat: 5000 }, 'anime')!;
    expect(r.startedAt).toBeUndefined();
    expect(r.finishedAt).toBeUndefined();
    expect(r.rewatches).toBe(999);
  });
  it('maps every AniList status', () => {
    expect(['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'REPEATING', 'X'].map(aniListStatus)).toEqual([
      'Watching / In Progress', 'Plan to watch', 'Completed', 'On Hold', 'Dropped', 'Rewatching', null,
    ]);
  });
  it('skips entries without a title', () => {
    expect(mapAniListEntry({ status: 'CURRENT', media: { id: 9, title: { romaji: null, english: '' } } }, 'anime')).toBeNull();
  });
});

describe('lookupAniList', () => {
  it('returns mapped rows for both lists, asking AniList for each type', async () => {
    const d = deps(ANIME_RESPONSE, MANGA_RESPONSE);
    const b = await lookupAniList('dan8525', [], d);
    expect(b.user).toBe('dan8525');
    expect(b.counts).toEqual({ anime: 6, manga: 1 });
    expect(b.skipped).toEqual({ anime: 0, manga: 0 });
    expect(b.rows).toHaveLength(7);
    expect(d.spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(d.spy.mock.calls[0]![1]!.body)).variables).toEqual({ user: 'dan8525', type: 'ANIME' });
    expect(b.rows.find((r) => r.title === 'Cowboy Bebop')).toMatchObject({ status: 'Rewatching' });
  });

  it('skips titles already on the list by source id or normalized title, per category', async () => {
    const existing = [
      { category: 'anime' as const, title: 'Shingeki no Kyojin', source: 'anilist', sourceId: '1' },
      { category: 'anime' as const, title: 'the cowboy bebop!', source: null, sourceId: null },
      { category: 'movies' as const, title: 'Berserk', source: null, sourceId: null },
    ];
    const b = await lookupAniList('dan8525', existing, deps(ANIME_RESPONSE, MANGA_RESPONSE));
    expect(b.skipped).toEqual({ anime: 2, manga: 0 });
    expect(b.counts).toEqual({ anime: 4, manga: 1 });
  });

  it('an empty profile gives no rows', async () => {
    const b = await lookupAniList('nobody_here', [], deps(EMPTY_RESPONSE, EMPTY_RESPONSE));
    expect(b.rows).toEqual([]);
    expect(b.counts).toEqual({ anime: 0, manga: 0 });
  });

  it.each(['', 'a', 'has space', 'x'.repeat(21), 'bad-name', 'ünï'])('rejects the invalid name %j without calling AniList', async (name) => {
    const d = deps(ANIME_RESPONSE, MANGA_RESPONSE);
    await expect(lookupAniList(name, [], d)).rejects.toMatchObject({ code: 'invalid_name' });
    expect(d.spy).not.toHaveBeenCalled();
  });

  it('unknown user -> not_found with a clear message', async () => {
    const e = await lookupAniList('ghost_user', [], deps(NOT_FOUND_RESPONSE, NOT_FOUND_RESPONSE)).catch((x) => x);
    expect(e).toBeInstanceOf(AniListError);
    expect(e).toMatchObject({ code: 'not_found' });
    expect(e.message).toMatch(/No AniList user called "ghost_user"/);
  });

  it('private list -> private with a clear message', async () => {
    const e = await lookupAniList('secret_user', [], deps(PRIVATE_RESPONSE, PRIVATE_RESPONSE)).catch((x) => x);
    expect(e).toMatchObject({ code: 'private' });
    expect(e.message).toMatch(/private/i);
  });

  it('a 404 from AniList with no error body is still not_found-or-unreachable, never a crash', async () => {
    const e = await lookupAniList('dan8525', [], deps(json({ errors: [{ message: 'Not Found.', status: 404 }] }, 404), MANGA_RESPONSE)).catch((x) => x);
    expect(e).toMatchObject({ code: 'not_found' });
  });

  it('HTTP 429 -> rate_limited "try again in a minute" (on either request)', async () => {
    let e = await lookupAniList('dan8525', [], deps(new Response('{}', { status: 429 }), MANGA_RESPONSE)).catch((x) => x);
    expect(e).toMatchObject({ code: 'rate_limited' });
    expect(e.message).toMatch(/try again in a minute/i);
    e = await lookupAniList('dan8525', [], deps(ANIME_RESPONSE, new Response('{}', { status: 429 }))).catch((x) => x);
    expect(e).toMatchObject({ code: 'rate_limited' });
  });

  it('other failures -> unreachable', async () => {
    let e = await lookupAniList('dan8525', [], deps(new Response('nope', { status: 500 }), MANGA_RESPONSE)).catch((x) => x);
    expect(e).toMatchObject({ code: 'unreachable' });
    expect(e.message).toMatch(/Couldn't reach AniList/);
    const offline = { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch };
    e = await lookupAniList('dan8525', [], offline).catch((x) => x);
    expect(e).toMatchObject({ code: 'unreachable' });
  });
});
