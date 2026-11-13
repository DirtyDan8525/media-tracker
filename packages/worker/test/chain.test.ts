import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupInfo, SourceId } from '@media-tracker/shared';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { isEmptyDetails } from '../src/lookup/routes';
import { assertAnswered, fetchJson } from '../src/lookup/http';
import { CHAINS, chainCacheKey, lookupChain, parseSpotifyLink } from '../src/lookup/chain';
import { KEY_CHECKS, SOURCES, type LookupDeps, type LookupQuery, type SourceEntry } from '../src/lookup/sources/index';
import { fakeFetch } from './fakeFetch';

const SECRETS = { TMDB_KEY: 'sekrit-tmdb-key-123', IGDB_ID: 'sekrit-igdb-id-456', IGDB_SECRET: 'sekrit-igdb-secret-789' };
const ADMIN = 'admin@example.com';
const USER = 'user@example.com';

const TMDB_URL = 'https://api.themoviedb.org/3/';
const WIKI_URL = 'https://en.wikipedia.org/w/api.php';

const info = (source: SourceId, title: string): LookupInfo => ({
  title, trusted: true, cover: '', genres: '', creator: '', source,
});

// Stub sources, shaped like real adapters: they fetch through fetchJson.
const tmdbStub = (): SourceEntry => ({
  search: vi.fn(async (q: LookupQuery, d: LookupDeps) => {
    const r = await fetchJson<{ results: { title: string }[] }>(
      `${TMDB_URL}search/movie?api_key=${d.env.TMDB_KEY}&query=${encodeURIComponent(q.term)}`, {}, d,
    );
    return r.status === 200 && r.body?.results[0] ? info('tmdb', r.body.results[0].title) : null;
  }),
});
const wikiStub = (): SourceEntry => ({
  search: vi.fn(async (q: LookupQuery, d: LookupDeps) => {
    const r = await fetchJson<{ query: { search: { title: string }[] } }>(
      `${WIKI_URL}?action=query&list=search&srsearch=${encodeURIComponent(q.term)}`, {}, d,
    );
    const hit = r.body?.query.search[0];
    return hit ? { ...info('wiki', hit.title), sub: q.category } : null;
  }),
});
const fixed = (source: SourceId, result: LookupInfo | null): SourceEntry => ({
  search: vi.fn(async () => result),
});

const register = (entries: Partial<Record<SourceId, SourceEntry>>) => Object.assign(SOURCES, entries);
const q = (term: string, extra: Partial<LookupQuery> = {}): LookupQuery =>
  ({ term, typedTitle: '', hint: '', category: 'movies', ...extra });
const deps = (fetchImpl: typeof fetch, envOver: Partial<Env> = {}, extra: Partial<LookupDeps> = {}): LookupDeps =>
  ({ fetch: fetchImpl, env: { ...env, ...SECRETS, ...envOver } as Env, log: [], ...extra });

const okFetch = () => fakeFetch({
  [TMDB_URL]: 500,
  [WIKI_URL]: '_stub/wiki-speed-racer.json',
});

const post = (email: string, path: string, body: unknown, envOver: Partial<Env> = {}) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { ...env, ...SECRETS, ADMIN_EMAIL: ADMIN, ...envOver, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );

const before = { ...SOURCES };
beforeEach(() => {
  for (const k of Object.keys(SOURCES) as SourceId[]) delete SOURCES[k];
});
afterEach(async () => {
  for (const k of Object.keys(SOURCES) as SourceId[]) delete SOURCES[k];
  Object.assign(SOURCES, before);
  vi.restoreAllMocks();
  await env.DB.exec('DELETE FROM lookup_cache');
  await env.DB.exec('DELETE FROM users');
});

describe('CHAINS', () => {
  it('encodes the script lookup_ chains', () => {
    expect(CHAINS).toEqual({
      anime: ['anilist'],
      songs: ['deezer'],
      games: ['igdb', 'steam', 'wiki'],
      movies: ['tmdb', 'wiki'],
      tv: ['tvmaze', 'wiki'],
      albums: ['deezer', 'itunes'],
      books: ['openlibrary', 'itunes'],
    });
  });

  it('key rules: tmdb needs TMDB_KEY, igdb needs both IGDB keys', () => {
    const e = (o: Partial<Env>) => ({ ...o }) as Env;
    expect(KEY_CHECKS.tmdb!(e({ TMDB_KEY: 'x' }))).toBe(true);
    expect(KEY_CHECKS.tmdb!(e({}))).toBe(false);
    expect(KEY_CHECKS.igdb!(e({ IGDB_ID: 'a', IGDB_SECRET: 'b' }))).toBe(true);
    expect(KEY_CHECKS.igdb!(e({ IGDB_ID: 'a' }))).toBe(false);
    expect(KEY_CHECKS.igdb!(e({ IGDB_SECRET: 'b' }))).toBe(false);
  });
});

describe('lookupChain', () => {
  it('movies: TMDB answers 500, so the result is wiki\'s', async () => {
    const tmdb = tmdbStub();
    const wiki = wikiStub();
    register({ tmdb, wiki });
    const f = okFetch();
    const d = deps(f);
    const r = await lookupChain('movies', q('speed racer'), d);
    expect(r).toMatchObject({ title: 'Speed Racer (film)', source: 'wiki', sub: 'movies' });
    expect(tmdb.search).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.startsWith(TMDB_URL)).toBe(true);
    expect(f.calls[1]!.startsWith(WIKI_URL)).toBe(true);
    expect(d.log!.join('\n')).toMatch(/500/);
    expect(d.log!.join('\n')).not.toContain(SECRETS.TMDB_KEY);
  });

  it('a request slower than the fetch timeout: chain moves on and the log says "timeout"', async () => {
    register({
      tmdb: {
        search: async (qq, d) => {
          const r = await fetchJson(`${TMDB_URL}search/movie?query=${qq.term}`, {}, d, { timeoutMs: 20 });
          return r.body ? info('tmdb', 'never') : null;
        },
      },
      wiki: wikiStub(),
    });
    const d = deps(fakeFetch({ [TMDB_URL]: { hang: true }, [WIKI_URL]: '_stub/wiki-speed-racer.json' }));
    const r = await lookupChain('movies', q('speed racer'), d);
    expect(r?.source).toBe('wiki');
    expect(d.log!.some((l) => l.includes('timeout'))).toBe(true);
  });

  it('a source that never settles is abandoned after sourceTimeoutMs; the log says "timeout"', async () => {
    register({ tmdb: { search: () => new Promise(() => {}) }, wiki: wikiStub() });
    const d = deps(okFetch(), {}, { sourceTimeoutMs: 20 });
    const r = await lookupChain('movies', q('speed racer'), d);
    expect(r?.source).toBe('wiki');
    expect(d.log!.some((l) => l.includes('tmdb') && l.includes('timeout'))).toBe(true);
  });

  it('no TMDB_KEY: TMDB is never called', async () => {
    const tmdb = tmdbStub();
    register({ tmdb, wiki: wikiStub() });
    const f = okFetch();
    const d = deps(f, { TMDB_KEY: undefined });
    const r = await lookupChain('movies', q('speed racer'), d);
    expect(r?.source).toBe('wiki');
    expect(tmdb.search).not.toHaveBeenCalled();
    expect(f.calls.some((u) => u.startsWith(TMDB_URL))).toBe(false);
    expect(d.log!.some((l) => l.includes('tmdb') && l.includes('skipped'))).toBe(true);
  });

  it('games: igdb is skipped unless both IGDB keys are set; a registered needsKey overrides the rule', async () => {
    const igdb = fixed('igdb', info('igdb', 'Zelda'));
    const steam = fixed('steam', info('steam', 'Zelda (Steam)'));
    register({ igdb, steam });
    expect((await lookupChain('games', q('zelda'), deps(fakeFetch({}), { IGDB_SECRET: undefined })))?.source).toBe('steam');
    expect(igdb.search).not.toHaveBeenCalled();
    // (distinct terms: each hit is cached)
    expect((await lookupChain('games', q('zelda 2'), deps(fakeFetch({}))))?.source).toBe('igdb');
    register({ igdb: { ...igdb, needsKey: () => false } });
    expect((await lookupChain('games', q('zelda 3'), deps(fakeFetch({}))))?.source).toBe('steam');
  });

  it('a source that throws: the chain moves on and nothing escapes', async () => {
    register({
      tvmaze: { search: async () => { throw new Error('boom'); } },
      wiki: wikiStub(),
    });
    const d = deps(okFetch());
    const r = await lookupChain('tv', q('chuck', { category: 'tv' }), d);
    expect(r).toMatchObject({ source: 'wiki', sub: 'tv' });
    expect(d.log!.some((l) => l.includes('tvmaze') && l.includes('boom'))).toBe(true);
  });

  it('unregistered sources are skipped and logged', async () => {
    register({ itunes: fixed('itunes', info('itunes', 'Album')) });
    const d = deps(fakeFetch({}));
    const r = await lookupChain('albums', q('x', { category: 'albums' }), d);
    expect(r?.source).toBe('itunes');
    expect(d.log!.some((l) => l.includes('deezer') && l.includes('not registered'))).toBe(true);
  });

  it('everything misses: null, without throwing', async () => {
    register({ tmdb: fixed('tmdb', null), wiki: fixed('wiki', null) });
    expect(await lookupChain('movies', q('nothing'), deps(fakeFetch({})))).toBeNull();
  });

  it('the wiki step gets the category (film/tv/game)', async () => {
    const wiki = fixed('wiki', null);
    register({ wiki });
    await lookupChain('games', q('portal'), deps(fakeFetch({}), { IGDB_ID: undefined }));
    expect(wiki.search).toHaveBeenCalledWith(expect.objectContaining({ category: 'games', term: 'portal' }), expect.anything());
  });

  it('books: openlibrary gets typedTitle || term; itunes gets the normal term', async () => {
    const openlibrary = fixed('openlibrary', null);
    const itunes = fixed('itunes', null);
    register({ openlibrary, itunes });
    const query = q('we are legion bob', { typedTitle: 'We Are Legion (We Are Bob)', hint: 'Dennis E. Taylor', category: 'books' });
    await lookupChain('books', query, deps(fakeFetch({})));
    expect(openlibrary.search).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'We Are Legion (We Are Bob)', hint: 'Dennis E. Taylor', category: 'books' }), expect.anything());
    expect(itunes.search).toHaveBeenCalledWith(expect.objectContaining({ term: 'we are legion bob' }), expect.anything());
    await lookupChain('books', q('dune', { category: 'books' }), deps(fakeFetch({})));
    expect(openlibrary.search).toHaveBeenLastCalledWith(expect.objectContaining({ term: 'dune' }), expect.anything());
  });

  it('songs runs deezer only, with category songs', async () => {
    const deezer = fixed('deezer', null);
    const itunes = fixed('itunes', info('itunes', 'nope'));
    register({ deezer, itunes });
    expect(await lookupChain('songs', q('x', { category: 'songs' }), deps(fakeFetch({})))).toBeNull();
    expect(deezer.search).toHaveBeenCalledWith(expect.objectContaining({ category: 'songs' }), expect.anything());
    expect(itunes.search).not.toHaveBeenCalled();
  });

  it('a lookupChain category argument wins over q.category', async () => {
    const wiki = fixed('wiki', null);
    register({ wiki });
    await lookupChain('tv', q('x', { category: 'movies' }), deps(fakeFetch({})));
    expect(wiki.search).toHaveBeenCalledWith(expect.objectContaining({ category: 'tv' }), expect.anything());
  });
});

describe('Spotify links', () => {
  const ALBUM = 'https://open.spotify.com/intl-de/album/1A2b3C4d5E6f7G8h9I0jKl?si=abc';

  it('parses album and track links, with /intl-xx/ and ?si=', () => {
    expect(parseSpotifyLink(ALBUM)).toEqual({ kind: 'album', id: '1A2b3C4d5E6f7G8h9I0jKl', url: 'https://open.spotify.com/album/1A2b3C4d5E6f7G8h9I0jKl' });
    expect(parseSpotifyLink('open.spotify.com/track/XyZ123?si=q')).toEqual({ kind: 'track', id: 'XyZ123', url: 'https://open.spotify.com/track/XyZ123' });
    expect(parseSpotifyLink('https://open.spotify.com/intl-pt-br/track/T1')).toMatchObject({ kind: 'track', id: 'T1' });
    expect(parseSpotifyLink('https://open.spotify.com/playlist/abc')).toBeNull();
    expect(parseSpotifyLink('dark side of the moon')).toBeNull();
  });

  it('an album link in a movies lookup goes to the spotify source only', async () => {
    const spotify = fixed('spotify', info('spotify', 'Live At Electric Lady'));
    const tmdb = tmdbStub();
    const wiki = wikiStub();
    register({ spotify, tmdb, wiki });
    const r = await lookupChain('movies', q(ALBUM), deps(okFetch()));
    expect(r).toMatchObject({ title: 'Live At Electric Lady', source: 'spotify' });
    expect(spotify.search).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'https://open.spotify.com/album/1A2b3C4d5E6f7G8h9I0jKl' }), expect.anything());
    expect(tmdb.search).not.toHaveBeenCalled();
    expect(wiki.search).not.toHaveBeenCalled();
  });

  it('a link with spotify unregistered or missing is a miss, not a text search', async () => {
    const wiki = wikiStub();
    register({ wiki });
    expect(await lookupChain('movies', q(ALBUM), deps(okFetch()))).toBeNull();
    register({ spotify: fixed('spotify', null) });
    expect(await lookupChain('movies', q(ALBUM), deps(okFetch()))).toBeNull();
    expect(wiki.search).not.toHaveBeenCalled();
  });
});

describe('chain cache', () => {
  it('key is JSON of trimmed, lowercased [term, hint, typedTitle]', () => {
    expect(chainCacheKey({ term: ' Speed Racer ', hint: 'X', typedTitle: ' Speed  ' })).toBe('["speed racer","x","speed"]');
  });

  it('key parts cannot collide through the delimiter', () => {
    const a = chainCacheKey({ term: 'a|b', hint: '', typedTitle: '' });
    const b = chainCacheKey({ term: 'a', hint: 'b|', typedTitle: '' });
    expect(a).not.toBe(b);
  });

  it('a Spotify link keys on the canonical URL with its case preserved', () => {
    expect(chainCacheKey({ term: 'https://open.spotify.com/intl-de/album/AbC123?si=x', hint: '', typedTitle: ' T ' }))
      .toBe('["https://open.spotify.com/album/AbC123","","t"]');
  });

  it('two Spotify album IDs differing only by case get two cache rows', async () => {
    const spotify: SourceEntry = { search: vi.fn(async (qq: LookupQuery) => info('spotify', qq.term)) };
    register({ spotify });
    const r1 = await lookupChain('albums', q('https://open.spotify.com/album/AbCdE', { category: 'albums' }), deps(fakeFetch({})));
    const r2 = await lookupChain('albums', q('https://open.spotify.com/album/abcde', { category: 'albums' }), deps(fakeFetch({})));
    expect(r1?.title).toBe('https://open.spotify.com/album/AbCdE');
    expect(r2?.title).toBe('https://open.spotify.com/album/abcde');
    expect(spotify.search).toHaveBeenCalledTimes(2);
    const rows = await env.DB.prepare("SELECT query_key FROM lookup_cache WHERE source = 'chain:albums' ORDER BY query_key").all<{ query_key: string }>();
    expect(rows.results.map((r) => r.query_key)).toEqual([
      '["https://open.spotify.com/album/AbCdE","",""]',
      '["https://open.spotify.com/album/abcde","",""]',
    ]);
  });

  it('the same album pasted with different ?si= and /intl-xx/ is a cache hit with zero fetches', async () => {
    const spotify: SourceEntry = {
      search: vi.fn(async (qq: LookupQuery, d: LookupDeps) => {
        const r = await fetchJson<{ title: string }>(`https://open.spotify.com/oembed?url=${encodeURIComponent(qq.term)}`, {}, d);
        return r.body ? info('spotify', r.body.title) : null;
      }),
    };
    register({ spotify });
    const f1 = fakeFetch({ 'https://open.spotify.com/oembed': { body: '{"title":"Live At Electric Lady"}' } });
    const r1 = await lookupChain('albums', q('https://open.spotify.com/album/1A2bC?si=a', { category: 'albums' }), deps(f1));
    expect(r1?.title).toBe('Live At Electric Lady');
    const f2 = fakeFetch({});
    const r2 = await lookupChain('albums', q('https://open.spotify.com/intl-de/album/1A2bC?si=b', { category: 'albums' }), deps(f2));
    expect(r2).toEqual(r1);
    expect(f2.calls).toEqual([]);
    expect(spotify.search).toHaveBeenCalledTimes(1);
  });

  it('a stale row (> 30 days) is ignored and overwritten', async () => {
    register({ tmdb: fixed('tmdb', info('tmdb', 'Fresh')) });
    const old = new Date(Date.now() - 31 * 864e5).toISOString();
    await env.DB.prepare('INSERT INTO lookup_cache (source, query_key, result_json, fetched_at) VALUES (?, ?, ?, ?)')
      .bind('chain:movies', '["speed racer","",""]', JSON.stringify(info('tmdb', 'Stale')), old).run();
    const r = await lookupChain('movies', q('speed racer'), deps(fakeFetch({})));
    expect(r?.title).toBe('Fresh');
    const row = await env.DB.prepare("SELECT result_json, fetched_at FROM lookup_cache WHERE source = 'chain:movies'").first<{ result_json: string; fetched_at: string }>();
    expect(JSON.parse(row!.result_json).title).toBe('Fresh');
    expect(row!.fetched_at > old).toBe(true);
  });

  it('a 29-day-old row is still served', async () => {
    const tmdb = fixed('tmdb', info('tmdb', 'Fresh'));
    register({ tmdb });
    const t = new Date(Date.now() - 29 * 864e5).toISOString();
    await env.DB.prepare('INSERT INTO lookup_cache (source, query_key, result_json, fetched_at) VALUES (?, ?, ?, ?)')
      .bind('chain:movies', '["speed racer","",""]', JSON.stringify(info('tmdb', 'Cached')), t).run();
    expect((await lookupChain('movies', q('speed racer'), deps(fakeFetch({}))))?.title).toBe('Cached');
    expect(tmdb.search).not.toHaveBeenCalled();
  });

  it('a miss is not cached: a second call re-runs the chain', async () => {
    const tmdb = fixed('tmdb', null);
    const wiki = fixed('wiki', null);
    register({ tmdb, wiki });
    await lookupChain('movies', q('nothing'), deps(fakeFetch({})));
    await lookupChain('movies', q('nothing'), deps(fakeFetch({})));
    expect(tmdb.search).toHaveBeenCalledTimes(2);
    expect(wiki.search).toHaveBeenCalledTimes(2);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM lookup_cache').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('caches per category', async () => {
    const tmdb = fixed('tmdb', info('tmdb', 'M'));
    const tvmaze = fixed('tvmaze', info('tvmaze', 'T'));
    register({ tmdb, tvmaze });
    expect((await lookupChain('movies', q('x'), deps(fakeFetch({}))))?.title).toBe('M');
    expect((await lookupChain('tv', q('x', { category: 'tv' }), deps(fakeFetch({}))))?.title).toBe('T');
  });
});

describe('POST /api/lookup', () => {
  const stubAll = () => register({ tmdb: tmdbStub(), wiki: wikiStub() });

  it('second identical lookup is served from lookup_cache with no fetch calls', async () => {
    stubAll();
    const f = okFetch();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(f);
    const body = { category: 'movies', term: 'Speed Racer', typedTitle: 'Speed Racer', hint: '' };
    const r1 = await post(USER, '/api/lookup', body);
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as { info: LookupInfo };
    expect(j1.info).toMatchObject({ title: 'Speed Racer (film)', source: 'wiki' });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    const r2 = await post(USER, '/api/lookup', { ...body, term: '  speed racer ' });
    expect(await r2.json()).toEqual({ info: j1.info });
    expect(spy).not.toHaveBeenCalled();
    const row = await env.DB.prepare('SELECT source, query_key FROM lookup_cache').first();
    expect(row).toEqual({ source: 'chain:movies', query_key: '["speed racer","","speed racer"]' });
  });

  it('a non-admin debug:true gets no log', async () => {
    stubAll();
    vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch());
    const res = await post(USER, '/api/lookup', { category: 'movies', term: 'speed racer', debug: true });
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.info).toBeTruthy();
    expect('log' in j).toBe(false);
  });

  it('an admin gets the log only with debug:true, and it carries no secrets', async () => {
    register({
      tmdb: { search: async (_q, d) => { throw new Error(`bad key ${d.env.TMDB_KEY}`); } },
      wiki: wikiStub(),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch());
    const plain = (await (await post(ADMIN, '/api/lookup', { category: 'movies', term: 'speed racer' })).json()) as Record<string, unknown>;
    expect('log' in plain).toBe(false);
    await env.DB.exec('DELETE FROM lookup_cache');
    const res = await post(ADMIN, '/api/lookup', { category: 'movies', term: 'speed racer', debug: true });
    const text = await res.text();
    const j = JSON.parse(text) as { info: LookupInfo; log: string[] };
    expect(Array.isArray(j.log)).toBe(true);
    expect(j.log.length).toBeGreaterThan(0);
    expect(j.log.some((l) => l.includes('tmdb'))).toBe(true);
    for (const s of Object.values(SECRETS)) expect(text).not.toContain(s);
  });

  it('typedTitle and hint are optional; an unknown category is not', async () => {
    stubAll();
    vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch());
    expect((await post(USER, '/api/lookup', { category: 'movies', term: 'speed racer' })).status).toBe(200);
  });

  it.each([
    ['bad category', { category: 'podcasts', term: 'x' }],
    ['missing category', { term: 'x' }],
    ['empty term', { category: 'movies', term: '' }],
    ['blank term', { category: 'movies', term: '   ' }],
    ['non-string term', { category: 'movies', term: 5 }],
    ['term > 500', { category: 'movies', term: 'a'.repeat(501) }],
    ['non-string typedTitle', { category: 'movies', term: 'x', typedTitle: 1 }],
    ['non-string hint', { category: 'movies', term: 'x', hint: [] }],
    ['typedTitle > 500', { category: 'movies', term: 'x', typedTitle: 'a'.repeat(501) }],
    ['array body', [1]],
    ['not json', '{'],
  ])('400 for %s', async (_name, body) => {
    const res = await post(USER, '/api/lookup', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
  });

  it('a 500-char term is fine', async () => {
    register({ tmdb: fixed('tmdb', null), wiki: fixed('wiki', null) });
    const res = await post(USER, '/api/lookup', { category: 'movies', term: 'a'.repeat(500) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ info: null });
  });

  it('requires a user', async () => {
    const res = await app.fetch(
      new Request('https://app.test/api/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: '' } as Env,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/lookup/details', () => {
  const tmdbWithDetails = (): SourceEntry => ({
    ...tmdbStub(),
    details: vi.fn(async (id: string, d: LookupDeps) => {
      const r = await fetchJson<{ release_date: string; overview: string; runtime: number }>(
        `${TMDB_URL}movie/${id}?api_key=${d.env.TMDB_KEY}`, {}, d,
      );
      if (r.status !== 200 || !r.body) return null;
      return { releaseDate: r.body.release_date, synopsis: r.body.overview, lengthLabel: `${r.body.runtime} min`, origin: '' };
    }),
  });

  it('returns details, caches them under details:<id>, and never leaks env', async () => {
    const tmdb = tmdbWithDetails();
    register({ tmdb });
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch({ [`${TMDB_URL}movie/123`]: '_stub/tmdb-movie-123.json' }));
    const res = await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '123' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ details: { releaseDate: '2008-05-09', synopsis: 'A young driver.', lengthLabel: '135 min', origin: '' } });
    for (const s of Object.values(SECRETS)) expect(text).not.toContain(s);
    const row = await env.DB.prepare('SELECT source, query_key, result_json FROM lookup_cache').first<{ source: string; query_key: string; result_json: string }>();
    expect(row).toMatchObject({ source: 'tmdb', query_key: 'details:123' });
    expect(row!.result_json).not.toContain(SECRETS.TMDB_KEY);
    spy.mockClear();
    const again = await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '123' });
    expect(((await again.json()) as { details: { releaseDate: string } }).details.releaseDate).toBe('2008-05-09');
    expect(spy).not.toHaveBeenCalled();
    expect(tmdb.details).toHaveBeenCalledTimes(1);
  });

  it('null details are not cached', async () => {
    const tmdb = tmdbWithDetails();
    register({ tmdb });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch({ [TMDB_URL]: 404 }));
    expect(await (await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '9' })).json()).toEqual({ details: null });
    await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '9' });
    expect(tmdb.details).toHaveBeenCalledTimes(2);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM lookup_cache').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('isEmptyDetails: only all-empty (or null) counts as empty', () => {
    expect(isEmptyDetails(null)).toBe(true);
    expect(isEmptyDetails({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' })).toBe(true);
    for (const k of ['releaseDate', 'synopsis', 'lengthLabel', 'origin'] as const) {
      expect(isEmptyDetails({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '', [k]: 'x' })).toBe(false);
    }
  });

  it('all-empty details give { details: null } and are not cached', async () => {
    const details = vi.fn(async () => ({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' }));
    register({ tmdb: { search: async () => null, details } });
    expect(await (await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' })).json()).toEqual({ details: null });
    await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' });
    expect(details).toHaveBeenCalledTimes(2);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM lookup_cache').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('a details function that throws gives { details: null, failed: true } (not a 500) and is not cached', async () => {
    const details = vi.fn(async () => { throw new Error('x'); });
    register({ tmdb: { search: async () => null, details } });
    const res = await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ details: null, failed: true });
    await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' });
    expect(details).toHaveBeenCalledTimes(2);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM lookup_cache').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('a source that is rate limited (429) or times out reports failed, a 404 does not', async () => {
    const tmdb = tmdbWithDetails();
    const strict: SourceEntry = {
      ...tmdb,
      details: async (id, d) => {
        const r = await fetchJson<unknown>(`${TMDB_URL}movie/${id}`, {}, d);
        assertAnswered(r.status, 'tmdb');
        return null;
      },
    };
    register({ tmdb: strict });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch({ [`${TMDB_URL}movie/1`]: 429, [`${TMDB_URL}movie/3`]: 404 }));
    expect(await (await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' })).json()).toEqual({ details: null, failed: true });
    expect(await (await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '3' })).json()).toEqual({ details: null });
  });

  it('a source without details (or unregistered) gives { details: null }', async () => {
    register({ steam: fixed('steam', null) });
    expect(await (await post(USER, '/api/lookup/details', { source: 'steam', sourceId: '620' })).json()).toEqual({ details: null });
    expect(await (await post(USER, '/api/lookup/details', { source: 'itunes', sourceId: '620' })).json()).toEqual({ details: null });
  });

  it('a source whose key is missing gives { details: null } without being called', async () => {
    const details = vi.fn(async () => ({ releaseDate: '2000', synopsis: '', lengthLabel: '', origin: '' }));
    register({ tmdb: { search: async () => null, details }, igdb: { search: async () => null, details } });
    expect(await (await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' }, { TMDB_KEY: undefined })).json()).toEqual({ details: null });
    expect(await (await post(USER, '/api/lookup/details', { source: 'igdb', sourceId: '1' }, { IGDB_SECRET: '' })).json()).toEqual({ details: null });
    expect(details).not.toHaveBeenCalled();
    // a registered needsKey wins, as in the chain
    register({ tmdb: { search: async () => null, details, needsKey: () => false } });
    expect(await (await post(USER, '/api/lookup/details', { source: 'tmdb', sourceId: '1' })).json()).toEqual({ details: null });
    expect(details).not.toHaveBeenCalled();
  });

  it('accepts ids like tt0811080, 11155, /works/OL123W-style keys without slashes, and a:b.c-d_e', async () => {
    const details = vi.fn(async () => ({ releaseDate: '2000', synopsis: '', lengthLabel: '', origin: '' }));
    register({ openlibrary: { search: async () => null, details } });
    for (const sourceId of ['tt0811080', '11155', 'OL123W', 'a:b.c-d_e', 'x'.repeat(200)]) {
      expect((await post(USER, '/api/lookup/details', { source: 'openlibrary', sourceId })).status).toBe(200);
    }
    expect(details).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['whitespace-only sourceId', { source: 'tmdb', sourceId: '   ' }],
    ['sourceId with a slash', { source: 'tmdb', sourceId: '../movie/1' }],
    ['sourceId with query chars', { source: 'tmdb', sourceId: '1?api_key=x' }],
    ['sourceId with a space', { source: 'tmdb', sourceId: '1 2' }],
    ['sourceId with &', { source: 'tmdb', sourceId: '1&x=2' }],
    ['unknown source', { source: 'netflix', sourceId: '1' }],
    ['missing sourceId', { source: 'tmdb' }],
    ['empty sourceId', { source: 'tmdb', sourceId: '' }],
    ['numeric sourceId', { source: 'tmdb', sourceId: 1 }],
    ['sourceId > 200', { source: 'tmdb', sourceId: 'a'.repeat(201) }],
    ['not json', 'nope'],
  ])('400 for %s', async (_name, body) => {
    const res = await post(USER, '/api/lookup/details', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
  });
});

