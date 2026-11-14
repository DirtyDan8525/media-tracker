import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { SourceFailure, resetPacing } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  details, formatDetails, lengthLabel, originOf, pickShows, rankShows, search, toInfo, type Show, type SearchHit, type Scored,
} from '../src/lookup/sources/tvmaze';
import { fakeFetch, hasFixtures, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string, typedTitle = term): LookupQuery => ({ term, typedTitle, hint: '', category: 'tv' });

beforeEach(() => resetPacing());

// ---- logic tests: small synthetic inputs, not claims about TVmaze's real payloads ----

describe('originOf', () => {
  it('network, then web channel, then empty', () => {
    expect(originOf({ network: { name: 'NBC' }, webChannel: { name: 'Hulu' } })).toBe('NBC');
    expect(originOf({ network: null, webChannel: { name: 'Hulu' } })).toBe('Hulu');
    expect(originOf({ webChannel: { name: 'Hulu' } })).toBe('Hulu');
    expect(originOf({ network: { name: '' }, webChannel: { name: 'Hulu' } })).toBe('Hulu');
    expect(originOf({})).toBe('');
  });
});

describe('lengthLabel', () => {
  it('"<n> min episodes · <status>"', () => {
    expect(lengthLabel({ averageRuntime: 60, status: 'Ended' })).toBe('60 min episodes · Ended');
  });
  it('falls back to runtime when averageRuntime is missing', () => {
    expect(lengthLabel({ averageRuntime: null, runtime: 30, status: 'Running' })).toBe('30 min episodes · Running');
  });
  it('status alone with no runtime; minutes alone with no status; empty with neither', () => {
    expect(lengthLabel({ status: 'Ended' })).toBe('Ended');
    expect(lengthLabel({ averageRuntime: 45 })).toBe('45 min episodes');
    expect(lengthLabel({ averageRuntime: null, runtime: null, status: null })).toBe('');
    expect(lengthLabel({ averageRuntime: 0, status: '' })).toBe('');
  });
});

describe('rankShows and pickShows (tvmaze_ scoring)', () => {
  const hit = (id: number, name: string, premiered: string | null, score: number): SearchHit => ({ score, show: { id, name, premiered } });

  it('score = similarity + 0.2 for the typed year (premiered year) + 0.1 * API score', () => {
    const hits = [hit(1, 'Abcd', '1999-01-01', 0.5), hit(2, 'Abcd', '2007-09-24', 0.5)];
    const plain = rankShows(hits, 'abcd');
    expect(plain[0]!.score).toBeCloseTo(1.05, 5);
    const withYear = rankShows(hits, 'Abcd (2007)');
    expect(withYear.map((s) => s.s.id)).toEqual([2, 1]);
    expect(withYear[0]!.score).toBeCloseTo(1.25, 5);
    expect(withYear[0]!.y).toBe('2007');
  });

  it('tolerates missing premiered and score', () => {
    const r = rankShows([{ show: { id: 1, name: 'Abcd' } }], 'abcd');
    expect(r[0]!.y).toBe('');
    expect(r[0]!.score).toBeCloseTo(1, 5);
  });

  const sc = (...scores: number[]): Scored[] => scores.map((score, i) => ({ s: { id: i + 1, name: 'x' }, y: '', score }));

  it('accepts 0.45 or more, rejects under it', () => {
    expect(pickShows(sc(0.44))).toBeNull();
    expect(pickShows(sc(0.45))?.map((s) => s.s.id)).toEqual([1]);
    expect(pickShows([])).toBeNull();
  });

  it('choices window 0.1 around the top, at most 8', () => {
    expect(pickShows(sc(1.0, 0.91, 0.9, 0.89))?.map((s) => s.s.id)).toEqual([1, 2, 3]);
    expect(pickShows(sc(1, 1, 1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(8);
  });
});

describe('toInfo', () => {
  it('maps a show; sub is network · year; cover prefers original', () => {
    const s: Show = { id: 5, name: 'Chuck', genres: ['Action', 'Comedy'], image: { original: 'o.jpg', medium: 'm.jpg' }, network: { name: 'NBC' } };
    expect(toInfo(s, '2007')).toEqual({
      title: 'Chuck', trusted: false, creator: '', genres: 'Action, Comedy', cover: 'o.jpg', sub: 'NBC · 2007', source: 'tvmaze', sourceId: '5',
    });
  });
  it('falls back to medium image, web channel, and empty pieces', () => {
    expect(toInfo({ id: 1, name: 'A', image: { medium: 'm.jpg' }, webChannel: { name: 'Hulu' } }, '')).toMatchObject({ cover: 'm.jpg', sub: 'Hulu' });
    expect(toInfo({ id: 2, name: 'B' }, '2001')).toMatchObject({ cover: '', genres: '', sub: '2001' });
  });
});

describe('formatDetails (/shows/{id})', () => {
  it('formats all four fields and strips the summary HTML', () => {
    expect(formatDetails({
      id: 1, name: 'x', premiered: '2007-09-24', summary: '<p>A <b>nerd</b> spies.</p>', averageRuntime: 60, status: 'Ended', network: { name: 'NBC' },
    })).toEqual({ releaseDate: '2007-09-24', synopsis: 'A nerd spies.', lengthLabel: '60 min episodes · Ended', origin: 'NBC' });
  });
  it('missing pieces are empty strings, never undefined/null', () => {
    const r = formatDetails({ id: 1, name: 'x', premiered: null, summary: null, averageRuntime: null, runtime: null, status: null });
    expect(r).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(JSON.stringify(formatDetails({ id: 1, name: 'x' }))).not.toMatch(/undefined|null/);
  });
  it('trims a long summary to 600 characters', () => {
    expect(formatDetails({ id: 1, name: 'x', summary: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });
});

describe('registration', () => {
  it('tvmaze is registered with search and details', () => {
    expect(typeof SOURCES.tvmaze?.search).toBe('function');
    expect(typeof SOURCES.tvmaze?.details).toBe('function');
  });
});

// ---- request tests ----

const API = 'https://api.tvmaze.com';
const hits = JSON.stringify([
  { score: 0.9, show: { id: 15, name: 'Chuck', premiered: '2007-09-24', genres: ['Action'], network: { name: 'NBC' }, image: { original: 'c.jpg' } } },
  { score: 0.4, show: { id: 99, name: 'Chuck', premiered: '1991-01-01' } },
]);

describe('search requests', () => {
  it('queries /search/shows with the year stripped, one request, and ranks the typed year first', async () => {
    const f = fakeFetch({ [`${API}/search/shows`]: { body: hits } });
    const r = await search(q('Chuck (2007)'), deps(f));
    expect(f.calls).toEqual([`${API}/search/shows?q=Chuck`]);
    expect(r).toMatchObject({ title: 'Chuck', sub: 'NBC · 2007', source: 'tvmaze', sourceId: '15', cover: 'c.jpg' });
    expect(r?.choices).toBeUndefined(); // the 1991 Chuck is more than 0.1 behind
  });
  it('close runners-up become choices (top first, source and sourceId set, no nesting)', async () => {
    const two = JSON.stringify([
      { score: 0.5, show: { id: 1, name: 'Chuck', premiered: '2007-09-24' } },
      { score: 0.5, show: { id: 2, name: 'Chuck', premiered: '2011-01-01' } },
    ]);
    const r = await search(q('Chuck'), deps(fakeFetch({ [`${API}/search/shows`]: { body: two } })));
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['1', '2']);
    expect(r?.choices?.every((c) => c.source === 'tvmaze' && c.choices === undefined)).toBe(true);
  });
  it('misses on error status, empty list, or weak match', async () => {
    expect(await search(q('Chuck'), deps(fakeFetch({ [`${API}/search/shows`]: 500 })))).toBeNull();
    expect(await search(q('Chuck'), deps(fakeFetch({ [`${API}/search/shows`]: { body: '[]' } })))).toBeNull();
    expect(await search(q('Chuck'), deps(fakeFetch({ [`${API}/search/shows`]: { body: JSON.stringify([{ score: 0, show: { id: 1, name: 'Zzzzzz' } }]) } })))).toBeNull();
  });
});

describe('details input and request', () => {
  it('rejects a non-numeric id without a request', async () => {
    const f = fakeFetch({});
    expect(await details('abc', deps(f))).toBeNull();
    expect(await details('1/../2', deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('reads /shows/{id} and formats it; null on error', async () => {
    const f = fakeFetch({ [`${API}/shows/15`]: { body: JSON.stringify({ id: 15, name: 'Chuck', premiered: '2007-09-24', summary: '<p>Hi.</p>', averageRuntime: 60, status: 'Ended', network: { name: 'NBC' } }) } });
    expect(await details('15', deps(f))).toEqual({ releaseDate: '2007-09-24', synopsis: 'Hi.', lengthLabel: '60 min episodes · Ended', origin: 'NBC' });
    expect(await details('15', deps(fakeFetch({ [`${API}/shows/15`]: 404 })))).toBeNull();
    for (const status of [429, 500]) await expect(details('15', deps(fakeFetch({ [`${API}/shows/15`]: status })))).rejects.toBeInstanceOf(SourceFailure);
  });
});

// ---- fixture tests: skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('tvmaze', 'chuck-2007'))('tvmaze fixture: chuck-2007', () => {
  it('ranks the Chuck that premiered in 2007 first', async () => {
    const f = replayFetch('tvmaze', 'chuck-2007');
    const r = await search(q('Chuck (2007)'), deps(f));
    expect(r?.title).toMatch(/^chuck$/i);
    expect(r?.sub).toMatch(/2007/);
    expect(r?.source).toBe('tvmaze');
    expect(r?.sourceId).toMatch(/^\d+$/);
    if (r?.choices) {
      expect(r.choices.length).toBeGreaterThan(1);
      expect(r.choices.length).toBeLessThanOrEqual(8);
      expect(r.choices[0]!.sourceId).toBe(r.sourceId);
    }
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('tvmaze', 'details-chuck'))('tvmaze fixture: details-chuck', () => {
  it('gives premiere date, plain synopsis, length label and network', async () => {
    const f = replayFetch('tvmaze', 'details-chuck');
    const found = await search(q('Chuck (2007)'), deps(f));
    const r = await details(found!.sourceId!, deps(f));
    expect(r?.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r?.synopsis.length).toBeGreaterThan(0);
    expect(r?.synopsis).not.toMatch(/<[^>]+>/);
    expect(r?.lengthLabel).toMatch(/^\d+ min episodes · \w+/);
    expect(r?.origin).not.toBe('');
    expect(f.unmatched).toEqual([]);
  });
});
