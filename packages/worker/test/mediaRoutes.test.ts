import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256Hex } from '../src/auth/session';
import { pickVideo } from '../src/lookup/trailer';

const TOKEN = 'tokentokentokentokentokentokentokentokentok';
const get = (path: string, extra: Partial<Env> = {}) =>
  app.fetch(new Request(`https://app.test/api/${path}`, { headers: { cookie: `mt_session=${TOKEN}` } }), { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined, TMDB_KEY: 'k'.repeat(32), ...extra } as Env);

beforeEach(async () => {
  const now = new Date().toISOString();
  await env.DB.exec('DELETE FROM lookup_cache');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM users');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, username, settings_json, is_admin, created_at) VALUES ('u1', 'dan@example.com', 'dan', '{}', 0, ?)").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, 'u1', ?, ?, ?)")
      .bind(await sha256Hex(TOKEN), now, new Date(Date.now() + 86_400_000).toISOString(), now),
  ]);
});
afterEach(() => vi.restoreAllMocks());

function mock(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    for (const [prefix, f] of Object.entries(routes)) if (url.startsWith(prefix)) return f();
    return new Response('{}', { status: 500 });
  });
  return calls;
}

const MP3 = 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c.mp3?hdnea=signed';
const dzTrack = (id: number, title: string, artist: string, preview = MP3) => ({ id, title, preview, artist: { name: artist } });

describe('GET /api/preview', () => {
  it('searches Deezer by title+artist and returns the fresh clip', async () => {
    const calls = mock({ 'https://api.deezer.com/search/track': () => Response.json({ data: [dzTrack(1, 'Blinding Lights (Live)', 'Someone'), dzTrack(2, 'Blinding Lights', 'The Weeknd')] }) });
    const res = await get('preview?kind=track&title=Blinding+Lights&artist=The+Weeknd');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: MP3 });
    expect(decodeURIComponent(new URL(calls[0]!).searchParams.get('q')!)).toBe('track:"Blinding Lights" artist:"The Weeknd"');
  });

  it('uses the entry\'s Deezer id when given (no search)', async () => {
    const calls = mock({ 'https://api.deezer.com/track/42': () => Response.json(dzTrack(42, 'x', 'y')) });
    expect(await (await get('preview?kind=track&title=x&artist=y&id=track:42')).json()).toEqual({ url: MP3 });
    expect(calls).toEqual(['https://api.deezer.com/track/42']);
  });

  it('albums: the first track that has a preview', async () => {
    mock({
      'https://api.deezer.com/search/album': () => Response.json({ data: [{ id: 7, title: 'Lemonade', artist: { name: 'Beyoncé' } }] }),
      'https://api.deezer.com/album/7/tracks': () => Response.json({ data: [{ id: 1, preview: '' }, { id: 2, preview: MP3 }, { id: 3, preview: 'https://cdnt-preview.dzcdn.net/other.mp3' }] }),
    });
    expect(await (await get('preview?kind=album&title=Lemonade&artist=Beyonce')).json()).toEqual({ url: MP3 });
  });

  it('miss (no match, or no clip) is null with 200', async () => {
    mock({ 'https://api.deezer.com/search/track': () => Response.json({ data: [dzTrack(1, 'Other song', 'Nobody')] }) });
    expect(await (await get('preview?kind=track&title=Halo&artist=Beyonce')).json()).toEqual({ url: null });
    vi.restoreAllMocks();
    mock({ 'https://api.deezer.com/track/5': () => Response.json(dzTrack(5, 'a', 'b', '')) });
    expect(await (await get('preview?kind=track&title=a&id=track:5')).json()).toEqual({ url: null });
  });

  it('errors are null with 200, and a Deezer {error} body counts as a failure', async () => {
    mock({ 'https://api.deezer.com/': () => new Response('{}', { status: 500 }) });
    const res = await get('preview?kind=track&title=Halo&artist=Beyonce');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
    vi.restoreAllMocks();
    mock({ 'https://api.deezer.com/': () => Response.json({ error: { code: 4 } }) });
    expect(await (await get('preview?kind=track&title=Halo2&artist=Beyonce')).json()).toEqual({ url: null });
  });

  it('caches the matched id, never the signed url', async () => {
    const calls = mock({
      'https://api.deezer.com/search/album': () => Response.json({ data: [{ id: 7, title: 'Lemonade', artist: { name: 'Beyoncé' } }] }),
      'https://api.deezer.com/album/7/tracks': () => Response.json({ data: [{ id: 2, preview: MP3 }] }),
    });
    await get('preview?kind=album&title=Lemonade&artist=Beyonce');
    await get('preview?kind=album&title=Lemonade&artist=Beyonce');
    expect(calls.filter((u) => u.includes('/search/album'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('/album/7/tracks'))).toHaveLength(2);
    const rows = await env.DB.prepare("SELECT result_json FROM lookup_cache WHERE source = 'deezer-preview'").all<{ result_json: string }>();
    expect(rows.results.map((r) => r.result_json).join()).not.toContain('dzcdn');
  });

  it('bad input is 400; needs sign-in', async () => {
    for (const qs of ['kind=x&title=a', 'kind=track', 'kind=track&title=', `kind=track&title=${'a'.repeat(301)}`]) expect((await get(`preview?${qs}`)).status, qs).toBe(400);
    const res = await app.fetch(new Request('https://app.test/api/preview?kind=track&title=x'), { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined } as Env);
    expect(res.status).toBe(401);
  });
});

const vid = (key: string, over: Record<string, unknown> = {}) => ({ key, site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en', ...over });

describe('pickVideo', () => {
  it('Trailer over Teaser, official then English first, YouTube only', () => {
    expect(pickVideo([vid('AAAAAAAAAAA', { type: 'Teaser' }), vid('BBBBBBBBBBB', { official: false })])).toBe('BBBBBBBBBBB');
    expect(pickVideo([vid('AAAAAAAAAAA', { iso_639_1: 'fr' }), vid('BBBBBBBBBBB', { official: false }), vid('CCCCCCCCCCC')])).toBe('CCCCCCCCCCC');
    expect(pickVideo([vid('AAAAAAAAAAA', { official: false, iso_639_1: 'fr' }), vid('BBBBBBBBBBB', { iso_639_1: 'fr' })])).toBe('BBBBBBBBBBB');
    expect(pickVideo([vid('AAAAAAAAAAA', { type: 'Teaser' })])).toBe('AAAAAAAAAAA');
    expect(pickVideo([vid('AAAAAAAAAAA', { site: 'Vimeo' }), vid('bad', {}), vid('BBBBBBBBBBB', { type: 'Clip' })])).toBeNull();
  });
});

describe('GET /api/trailer', () => {
  const search = (kind: string, results: unknown[]) => ({ [`https://api.themoviedb.org/3/search/${kind}`]: () => Response.json({ results }) });

  it('movie: searches TMDB with the year, then picks the trailer', async () => {
    const calls = mock({
      ...search('movie', [{ id: 1, title: 'Dune' }, { id: 693134, title: 'Dune: Part Two' }]),
      'https://api.themoviedb.org/3/movie/693134/videos': () => Response.json({ results: [vid('Way9Dexny3w', { type: 'Teaser' }), vid('Way9Dexny3x')] }),
    });
    const res = await get('trailer?kind=movie&title=Dune%3A+Part+Two&year=2024');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ youtubeId: 'Way9Dexny3x' });
    expect(new URL(calls[0]!).searchParams.get('year')).toBe('2024');
  });

  it('tv: uses /search/tv and /tv/{id}/videos', async () => {
    const calls = mock({
      ...search('tv', [{ id: 9, name: 'Severance' }]),
      'https://api.themoviedb.org/3/tv/9/videos': () => Response.json({ results: [vid('SSSSSSSSSSS')] }),
    });
    expect(await (await get('trailer?kind=tv&title=Severance&year=2022')).json()).toEqual({ youtubeId: 'SSSSSSSSSSS' });
    expect(new URL(calls[0]!).searchParams.get('first_air_date_year')).toBe('2022');
  });

  it('uses a stored TMDB id without searching', async () => {
    const calls = mock({ 'https://api.themoviedb.org/3/movie/55/videos': () => Response.json({ results: [vid('MMMMMMMMMMM')] }) });
    expect(await (await get('trailer?kind=movie&title=Whatever&id=55')).json()).toEqual({ youtubeId: 'MMMMMMMMMMM' });
    expect(calls).toHaveLength(1);
  });

  it('anime: Kitsu youtubeVideoId from the search hit, or from a stored id', async () => {
    mock({ 'https://kitsu.io/api/edge/anime?': () => Response.json({ data: [{ id: '1', attributes: { canonicalTitle: 'Frieren', titles: { en: 'Frieren' }, youtubeVideoId: 'KKKKKKKKKKK' } }] }) });
    const res = await get('trailer?kind=anime&title=Frieren', { TMDB_KEY: undefined });
    expect(await res.json()).toEqual({ youtubeId: 'KKKKKKKKKKK' });
    vi.restoreAllMocks();
    const calls = mock({ 'https://kitsu.io/api/edge/anime/7': () => Response.json({ data: { id: '7', attributes: { youtubeVideoId: 'LLLLLLLLLLL' } } }) });
    expect(await (await get('trailer?kind=anime&title=Other&id=7')).json()).toEqual({ youtubeId: 'LLLLLLLLLLL' });
    expect(calls).toEqual(['https://kitsu.io/api/edge/anime/7']);
  });

  it('miss: no match or no video gives null and is cached', async () => {
    const calls = mock(search('movie', [{ id: 1, title: 'Something Else' }]));
    expect(await (await get('trailer?kind=movie&title=Nope&year=2020')).json()).toEqual({ youtubeId: null });
    await get('trailer?kind=movie&title=Nope&year=2020');
    expect(calls).toHaveLength(1);
  });

  it('no TMDB key: null, no fetch (movies and tv)', async () => {
    const calls = mock({});
    const res = await get('trailer?kind=movie&title=Dune', { TMDB_KEY: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ youtubeId: null });
    expect(calls).toHaveLength(0);
  });

  it('errors are null with 200 and are not cached', async () => {
    mock({ 'https://api.themoviedb.org/': () => new Response('{}', { status: 500 }) });
    const res = await get('trailer?kind=movie&title=Dune&year=2021');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ youtubeId: null });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM lookup_cache WHERE source = 'trailer'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('a hit is cached', async () => {
    const calls = mock({ 'https://api.themoviedb.org/3/movie/55/videos': () => Response.json({ results: [vid('MMMMMMMMMMM')] }) });
    await get('trailer?kind=movie&title=W&id=55');
    await get('trailer?kind=movie&title=W&id=55');
    expect(calls).toHaveLength(1);
  });

  it('bad input is 400; needs sign-in', async () => {
    for (const qs of ['kind=book&title=a', 'kind=movie', 'kind=movie&title=a&year=20', 'kind=movie&title=a&id=x/y']) expect((await get(`trailer?${qs}`)).status, qs).toBe(400);
    const res = await app.fetch(new Request('https://app.test/api/trailer?kind=movie&title=x'), { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined } as Env);
    expect(res.status).toBe(401);
  });
});
