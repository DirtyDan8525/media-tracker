import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { lookupChain } from '../src/lookup/chain';
import { formatMinutes } from '../src/lookup/sources/format';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  details, directorOf, formatDetails, pickMovies, rankMovies, search, tmdbRequest, toInfo, type Movie, type Scored,
} from '../src/lookup/sources/tmdb';
import { fakeFetch, hasFixtures, replayFetch } from './fakeFetch';

const LONG_KEY = 'L'.repeat(41); // a "Read Access Token" is far longer than 40; 41 is the boundary
const SHORT_KEY = 'S'.repeat(40);

const deps = (f: typeof fetch, over: Partial<Env> = {}): LookupDeps & { log: string[] } =>
  ({ fetch: f, env: { ...env, TMDB_KEY: SHORT_KEY, ...over } as Env, log: [] });
const q = (term: string, typedTitle = term): LookupQuery => ({ term, typedTitle, hint: '', category: 'movies' });

// ---- logic tests: small synthetic inputs, not claims about TMDB's real payloads ----

describe('formatMinutes (runtime label)', () => {
  it('hours and minutes, or minutes alone', () => {
    expect(formatMinutes(75)).toBe('1 h 15 min');
    expect(formatMinutes(137)).toBe('2 h 17 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h 0 min');
    expect(formatMinutes(120)).toBe('2 h 0 min');
  });

  it('empty for missing, zero, negative or non-finite runtimes', () => {
    expect(formatMinutes(0)).toBe('');
    expect(formatMinutes(null)).toBe('');
    expect(formatMinutes(undefined)).toBe('');
    expect(formatMinutes(-5)).toBe('');
    expect(formatMinutes(Number.NaN)).toBe('');
  });

  it('rounds fractional minutes', () => {
    expect(formatMinutes(44.6)).toBe('45 min');
  });
});

describe('tmdbRequest (tmdbFetch_)', () => {
  it('a key longer than 40 characters goes in an Authorization: Bearer header, not the URL', () => {
    const r = tmdbRequest('/search/movie?query=x', LONG_KEY);
    expect(r.url).toBe('https://api.themoviedb.org/3/search/movie?query=x');
    const h = new Headers(r.init.headers);
    expect(h.get('authorization')).toBe(`Bearer ${LONG_KEY}`);
    expect(h.get('accept')).toBe('application/json');
  });

  it('a key of 40 characters or fewer goes in the api_key param, with no Authorization header', () => {
    const r = tmdbRequest('/search/movie?query=x', SHORT_KEY);
    expect(r.url).toBe(`https://api.themoviedb.org/3/search/movie?query=x&api_key=${SHORT_KEY}`);
    expect(new Headers(r.init.headers).get('authorization')).toBeNull();
  });

  it('uses ? when the path has no query yet, and encodes the key', () => {
    expect(tmdbRequest('/movie/5', 'a b&c').url).toBe('https://api.themoviedb.org/3/movie/5?api_key=a%20b%26c');
  });
});

describe('rankMovies and pickMovies (tmdbMovie_ scoring)', () => {
  const m = (id: number, title: string, release_date: string, popularity: number, over: Partial<Movie> = {}): Movie =>
    ({ id, title, release_date, popularity, ...over });

  it('score = title similarity + 0.12 popularity-rank bonus (+0.2 for the typed year)', () => {
    const list = [m(1, 'Abcd', '2008-01-01', 10), m(2, 'Abcd', '1993-01-01', 5)];
    const plain = rankMovies(list, 'abcd');
    expect(plain.map((s) => s.m.id)).toEqual([1, 2]);
    expect(plain[0]!.score).toBeCloseTo(1 + 0.12 * (1 - 0 / 2), 5);
    expect(plain[1]!.score).toBeCloseTo(1 + 0.12 * (1 - 1 / 2), 5);
    expect(plain[0]!.y).toBe('2008');

    const withYear = rankMovies(list, 'abcd 1993');
    expect(withYear.map((s) => s.m.id)).toEqual([2, 1]);
    expect(withYear[0]!.score).toBeCloseTo(1 + 0.2 + 0.06, 5);
  });

  it('matches against the original title too, and tolerates missing fields', () => {
    const r = rankMovies([{ id: 1, title: 'Zzzz', original_title: 'Abcd' }, { id: 2 }], 'abcd');
    expect(r[0]!.m.id).toBe(1);
    expect(r[0]!.score).toBeGreaterThan(1);
    expect(r[1]!.y).toBe('');
  });

  const sc = (...scores: number[]): Scored[] => scores.map((score, i) => ({ m: { id: i + 1 }, y: '', score }));

  it('accepts a best score of 0.45 or more, rejects under it', () => {
    expect(pickMovies(sc(0.44))).toBeNull();
    expect(pickMovies(sc(0.45))?.map((s) => s.m.id)).toEqual([1]);
    expect(pickMovies([])).toBeNull();
  });

  it('choices window: top plus anything within 0.1 of it, at most 6', () => {
    expect(pickMovies(sc(1.0, 0.91, 0.9, 0.89))?.map((s) => s.m.id)).toEqual([1, 2, 3]);
    expect(pickMovies(sc(1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(6);
  });
});

describe('directorOf', () => {
  it('joins every crew member whose job is Director', () => {
    expect(directorOf({ crew: [
      { job: 'Director', name: 'Lana' }, { job: 'Producer', name: 'Joel' }, { job: 'Director', name: 'Lilly' }, { job: 'Director of Photography', name: 'X' },
    ] })).toBe('Lana, Lilly');
  });

  it('empty when there is no crew', () => {
    expect(directorOf(undefined)).toBe('');
    expect(directorOf({})).toBe('');
    expect(directorOf({ crew: [{ job: 'Director' }] })).toBe('');
  });
});

describe('toInfo', () => {
  it('maps a movie; the sub line is year · director', () => {
    expect(toInfo({ id: 11, title: 'Alpha', release_date: '2008-05-08', poster_path: '/p.jpg' }, 'Action, Family', 'Lana')).toEqual({
      title: 'Alpha', trusted: false, cover: 'https://image.tmdb.org/t/p/w500/p.jpg', genres: 'Action, Family', creator: 'Lana',
      sub: '2008 · Lana', source: 'tmdb', sourceId: '11',
    });
  });

  it('no poster -> empty cover; sub is just the year when there is no director', () => {
    expect(toInfo({ id: 1, title: 'B', release_date: '1999-01-01' }, '', '')).toMatchObject({ cover: '', sub: '1999', sourceId: '1' });
    expect(toInfo({ id: 2 }, '', '')).toMatchObject({ title: '', sub: '' });
  });
});

describe('formatDetails (/movie/{id})', () => {
  it('formats all four fields; origin is the first two production companies', () => {
    expect(formatDetails({
      release_date: '2008-05-08', overview: 'A <b>racer</b> wins.', runtime: 135,
      production_companies: [{ name: 'Warner Bros.' }, { name: 'Village Roadshow' }, { name: 'Third' }],
    })).toEqual({ releaseDate: '2008-05-08', synopsis: 'A racer wins.', lengthLabel: '2 h 15 min', origin: 'Warner Bros., Village Roadshow' });
  });

  it('missing pieces become empty strings, never undefined', () => {
    expect(formatDetails({})).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(formatDetails({ release_date: null, overview: null, runtime: 0, production_companies: [] }))
      .toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(formatDetails({ production_companies: [{ name: 'Only' }] }).origin).toBe('Only');
  });

  it('trims a long overview to 600 characters', () => {
    expect(formatDetails({ overview: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });
});

describe('registration', () => {
  it('tmdb is registered with search and details', () => {
    expect(typeof SOURCES.tmdb?.search).toBe('function');
    expect(typeof SOURCES.tmdb?.details).toBe('function');
  });
});

// ---- request tests: the minimum bodies our code reads ----

const TMDB = 'https://api.themoviedb.org/3';
const searchBody = JSON.stringify({ results: [{ id: 1, title: 'Alpha Film', release_date: '2008-05-08', popularity: 3, poster_path: '/a.jpg' }] });
const movieBody = JSON.stringify({ genres: [{ name: 'Action' }], credits: { crew: [{ job: 'Director', name: 'Dee' }] } });

function spy(inner: ReturnType<typeof fakeFetch>) {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, headers: new Headers(init?.headers) });
    return inner(input, init);
  }) as typeof fetch;
  return Object.assign(f, { seen });
}

describe('TMDB key handling in requests', () => {
  const routes = () => fakeFetch({ [`${TMDB}/search/movie`]: { body: searchBody }, [`${TMDB}/movie/1`]: { body: movieBody } });

  it('key > 40 chars: Authorization Bearer on every request, no api_key param', async () => {
    const f = spy(routes());
    const r = await search(q('Alpha Film'), deps(f, { TMDB_KEY: LONG_KEY }));
    expect(r?.title).toBe('Alpha Film');
    expect(r?.creator).toBe('Dee');
    expect(f.seen.length).toBeGreaterThanOrEqual(2);
    for (const s of f.seen) {
      expect(s.headers.get('authorization')).toBe(`Bearer ${LONG_KEY}`);
      expect(s.url).not.toContain('api_key');
    }
  });

  it('key <= 40 chars: api_key query param on every request, no Authorization header', async () => {
    const f = spy(routes());
    expect((await search(q('Alpha Film'), deps(f, { TMDB_KEY: SHORT_KEY })))?.title).toBe('Alpha Film');
    for (const s of f.seen) {
      expect(s.headers.get('authorization')).toBeNull();
      expect(s.url).toContain(`api_key=${SHORT_KEY}`);
    }
  });

  it('a non-200 search is a miss; a failed per-movie detail call keeps the movie with empty genres/director', async () => {
    expect(await search(q('Alpha Film'), deps(fakeFetch({ [`${TMDB}/search/movie`]: 401 })))).toBeNull();
    const r = await search(q('Alpha Film'), deps(fakeFetch({ [`${TMDB}/search/movie`]: { body: searchBody }, [`${TMDB}/movie/1`]: 500 })));
    expect(r).toMatchObject({ title: 'Alpha Film', genres: '', creator: '', sub: '2008' });
  });

  it('searches with the year stripped from the term, and scores the typed title', async () => {
    const f = fakeFetch({ [`${TMDB}/search/movie`]: { body: searchBody }, [`${TMDB}/movie/1`]: { body: movieBody } });
    await search(q('Alpha Film 2008', 'Alpha Film 2008'), deps(f));
    expect(f.calls[0]).toContain('query=Alpha%20Film&');
    expect(f.calls[0]).toContain('include_adult=false');
  });

  it('sets source and sourceId (the numeric id) on the result and on each choice', async () => {
    const two = JSON.stringify({ results: [
      { id: 1, title: 'Alpha Film', release_date: '2008-05-08', popularity: 3 },
      { id: 2, title: 'Alpha Film', release_date: '1990-05-08', popularity: 2 },
    ] });
    const f = fakeFetch({ [`${TMDB}/search/movie`]: { body: two }, [`${TMDB}/movie/`]: { body: movieBody } });
    const r = await search(q('Alpha Film'), deps(f));
    expect(r).toMatchObject({ source: 'tmdb', sourceId: '1' });
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['1', '2']);
    expect(r?.choices?.every((c) => c.source === 'tmdb' && c.choices === undefined)).toBe(true);
  });
});

describe('the TMDB key never leaks', () => {
  for (const [label, key] of [['bearer key', LONG_KEY], ['api_key param key', SHORT_KEY]] as const) {
    it(`${label}: not in the result, the log or the cache rows`, async () => {
      const f = fakeFetch({
        [`${TMDB}/search/movie`]: { body: searchBody },
        [`${TMDB}/movie/1`]: { body: movieBody },
      });
      const d = deps(f, { TMDB_KEY: key });
      const r = await lookupChain('movies', q(`Alpha Film leak-check ${label}`), d);
      expect(r?.source).toBe('tmdb');
      expect(JSON.stringify(r)).not.toContain(key);
      expect(d.log.join('\n')).not.toContain(key);
      expect(d.log.join('\n')).toContain('themoviedb.org');
      const rows = await env.DB.prepare('SELECT result_json FROM lookup_cache').all<{ result_json: string }>();
      expect(rows.results.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows.results)).not.toContain(key);
    });
  }

  it('a failing request does not put the key in the log either', async () => {
    const d = deps(fakeFetch({ [`${TMDB}/search/movie`]: 500 }), { TMDB_KEY: SHORT_KEY });
    await search(q('Alpha Film'), d);
    expect(d.log.join('\n')).not.toContain(SHORT_KEY);
  });
});

describe('details input and request', () => {
  it('rejects a non-numeric id without a request', async () => {
    const f = fakeFetch({});
    expect(await details('abc', deps(f))).toBeNull();
    expect(await details('1/../2', deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it('reads /movie/{id} (without credits) and formats it', async () => {
    const f = fakeFetch({ [`${TMDB}/movie/9`]: { body: JSON.stringify({ release_date: '2001-02-03', overview: 'Hi.', runtime: 45, production_companies: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }) } });
    expect(await details('9', deps(f))).toEqual({ releaseDate: '2001-02-03', synopsis: 'Hi.', lengthLabel: '45 min', origin: 'A, B' });
    expect(f.calls[0]).not.toContain('append_to_response');
  });

  it('null when TMDB answers an error', async () => {
    expect(await details('9', deps(fakeFetch({ [`${TMDB}/movie/9`]: 404 })))).toBeNull();
  });
});

// ---- fixture tests: real assertions, skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('tmdb', 'speed-racer-2008'))('tmdb fixture: speed-racer-2008', () => {
  it('finds the 2008 Speed Racer film directed by the Wachowskis', async () => {
    const f = replayFetch('tmdb', 'speed-racer-2008');
    const r = await search(q('Speed Racer 2008'), deps(f, { TMDB_KEY: 'recorded' }));
    expect(r?.title).toMatch(/speed racer/i);
    expect(r?.sub).toMatch(/^2008/);
    expect(r?.creator).toContain('Wachowski');
    expect(r?.cover.startsWith('https://image.tmdb.org/t/p/')).toBe(true);
    expect(r?.source).toBe('tmdb');
    expect(r?.sourceId).toMatch(/^\d+$/);
    if (r?.choices) {
      expect(r.choices.length).toBeGreaterThan(1);
      expect(r.choices.length).toBeLessThanOrEqual(6);
    }
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('tmdb', 'details-speed-racer'))('tmdb fixture: details-speed-racer', () => {
  it('gives release date, synopsis, runtime label and the first two companies', async () => {
    // The case holds the search and the details call that followed it.
    const f = replayFetch('tmdb', 'details-speed-racer');
    const found = await search(q('Speed Racer 2008'), deps(f, { TMDB_KEY: 'recorded' }));
    const r = await details(found!.sourceId!, deps(f, { TMDB_KEY: 'recorded' }));
    expect(r?.releaseDate).toMatch(/^2008-\d{2}-\d{2}$/);
    expect(r?.synopsis.length).toBeGreaterThan(20);
    expect(r?.lengthLabel).toMatch(/^\d+ h \d+ min$|^\d+ min$/);
    expect(r?.origin).not.toBe('');
    expect(r!.origin.split(', ').length).toBeLessThanOrEqual(2);
    expect(r?.origin).not.toContain('undefined');
  });
});
