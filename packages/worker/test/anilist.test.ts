import { env } from 'cloudflare:workers';
import { afterEach, describe as suite, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { SourceFailure, resetPacing, setPacingClock } from '../src/lookup/http';
import {
  buildResult, describe, details, formatDetails, queryVariants, scoreInto, search, toInfo,
  type Candidate, type Media,
} from '../src/lookup/sources/anilist';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import { fakeFetch, hasFixtures, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string): LookupQuery => ({ term, typedTitle: term, hint: '', category: 'anime' });

afterEach(() => {
  setPacingClock(null);
  resetPacing();
});

// ---- logic tests: small synthetic inputs, not claims about AniList's real payloads ----

suite('queryVariants (anime_ query list)', () => {
  it('full term, normalised base, first two words, then each word; possessive dropped from the base', () => {
    expect(queryVariants("Jojo's Bizarre Adventure")).toEqual([
      "Jojo's Bizarre Adventure", 'jojo bizarre adventure', 'jojo bizarre', 'jojo', 'bizarre', 'adventure',
    ]);
  });

  it('dedups case-insensitively, so a one-word term is one query', () => {
    expect(queryVariants('Frieren')).toEqual(['Frieren']);
  });

  it('drops the year and words shorter than 3 letters, keeps at most 7 queries', () => {
    expect(queryVariants('Frieren 2023')).toEqual(['Frieren']);
    expect(queryVariants('xy zz')).toEqual(['xy zz']);
    expect(queryVariants('one two three four five six seven eight nine')).toHaveLength(7);
    expect(queryVariants(' ')).toEqual([]);
  });
});

suite('scoreInto', () => {
  const m = (id: number, over: Partial<Media> = {}): Media => ({ id, ...over });

  it('scores the best match over romaji, english and synonyms, plus a popularity nudge up to 0.05', () => {
    const pool = new Map<number, Candidate>();
    scoreInto(pool, 'frieren', [
      m(1, { title: { romaji: 'Sousou no Frieren', english: 'Frieren' }, popularity: 200 }),
      m(2, { title: { romaji: 'Other' }, synonyms: ['Frieren'], popularity: 100 }),
      m(3, { title: { romaji: 'Zzzz' } }),
    ]);
    expect(pool.get(1)!.score).toBeCloseTo(1.05, 5);
    expect(pool.get(2)!.score).toBeCloseTo(1.025, 5);
    expect(pool.get(3)!.score).toBeCloseTo(0, 5);
  });

  it('adds 0.2 when the release year matches the typed year', () => {
    const pool = new Map<number, Candidate>();
    scoreInto(pool, 'abcd', [
      m(1, { title: { romaji: 'abcd' }, seasonYear: 2020 }),
      m(2, { title: { romaji: 'abcd' }, startDate: { year: 2021 } }),
    ], '2021');
    expect(pool.get(2)!.score - pool.get(1)!.score).toBeCloseTo(0.2, 5);
  });

  it('keeps the higher score when the same id is scored again', () => {
    const pool = new Map<number, Candidate>();
    scoreInto(pool, 'abcd', [m(1, { title: { romaji: 'abcd' } })]);
    scoreInto(pool, 'zzzz', [m(1, { title: { romaji: 'abcd' } })]);
    expect(pool.get(1)!.score).toBeCloseTo(1, 5);
    scoreInto(pool, 'zzzz', [m(2, { title: { romaji: 'abcd' } })]);
    expect(pool.get(2)!.score).toBeCloseTo(0, 5);
  });
});

suite('describe (sub line)', () => {
  it('joins format label, year and episodes', () => {
    expect(describe({ id: 1, format: 'TV', seasonYear: 2023, episodes: 28 })).toBe('TV series · 2023 · 28 ep');
    expect(describe({ id: 1, format: 'MOVIE', startDate: { year: 2016 } })).toBe('Movie · 2016');
    expect(describe({ id: 1, format: 'MUSIC' })).toBe('Music video');
  });

  it('passes an unknown format through and never prints undefined', () => {
    expect(describe({ id: 1, format: 'NEWTHING', episodes: 3 })).toBe('NEWTHING · 3 ep');
    expect(describe({ id: 1 })).toBe('');
  });
});

suite('toInfo', () => {
  it('maps a media entry', () => {
    expect(toInfo({
      id: 154587, title: { english: 'Frieren', romaji: 'Sousou no Frieren' },
      coverImage: { extraLarge: 'https://x/xl.jpg', large: 'https://x/l.jpg' },
      genres: ['Adventure', 'Fantasy'], studios: { nodes: [{ name: 'A' }, { name: 'B' }] },
    })).toEqual({
      title: 'Frieren', trusted: true, cover: 'https://x/xl.jpg', genres: 'Adventure, Fantasy', creator: 'A, B',
      source: 'anilist', sourceId: '154587',
    });
  });

  it('falls back to romaji and the large cover, and tolerates missing parts', () => {
    const i = toInfo({ id: 2, title: { romaji: 'Romaji' }, coverImage: { large: 'https://x/l.jpg' } });
    expect(i).toMatchObject({ title: 'Romaji', cover: 'https://x/l.jpg', genres: '', creator: '' });
    expect(toInfo({ id: 3 })).toMatchObject({ title: '', cover: '' });
  });
});

suite('buildResult (ranking and choices window)', () => {
  const pool = (...rows: [number, Omit<Media, 'id'>, number][]): Map<number, Candidate> =>
    new Map(rows.map(([id, media, score]) => [id, { media: { ...media, id }, score }]));

  it('returns null for an empty pool or a best score under 0.45', () => {
    expect(buildResult(new Map())).toBeNull();
    expect(buildResult(pool([1, { title: { romaji: 'X' } }, 0.44]))).toBeNull();
    expect(buildResult(pool([1, { title: { romaji: 'X' } }, 0.45]))?.title).toBe('X');
  });

  it('a lone result has no choices', () => {
    expect(buildResult(pool([1, { title: { romaji: 'Solo' } }, 0.9]))?.choices).toBeUndefined();
  });

  it('choices: top first, then near-ties (within 0.15) and same-series entries by year; others dropped', () => {
    const r = buildResult(pool(
      [1, { title: { english: 'Alpha Quest: Season 1' }, seasonYear: 2015 }, 1.0],
      [2, { title: { romaji: 'Beta Tie' }, seasonYear: 2010 }, 0.86],
      [3, { title: { romaji: 'Alpha Quest 2' }, seasonYear: 2019 }, 0.2], // same series, low score
      [4, { title: { romaji: 'Alpha Quest Movie' }, startDate: { year: 2012 } }, 0.3],
      [5, { title: { romaji: 'Gamma Unrelated' } }, 0.84], // just outside the window
    ));
    expect(r?.title).toBe('Alpha Quest: Season 1');
    expect(r?.sourceId).toBe('1');
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['1', '2', '4', '3']);
    expect(r?.choices?.[0]?.sub).toBe('2015');
    expect(r?.choices?.every((c) => c.source === 'anilist' && c.choices === undefined)).toBe(true);
  });

  it('a stem shorter than 4 letters does not group series; choices cap at 12', () => {
    const r = buildResult(pool(
      [1, { title: { romaji: 'Ab: One' } }, 1.0],
      [2, { title: { romaji: 'Ab Two' } }, 0.1],
    ));
    expect(r?.choices).toBeUndefined();
    const many = pool([0, { title: { romaji: 'Seriesname: 0' } }, 1.0]);
    for (let i = 1; i < 20; i++) many.set(i, { media: { id: i, title: { romaji: `Seriesname ${i}` } }, score: 0.1 });
    expect(buildResult(many)?.choices).toHaveLength(12);
  });
});

suite('formatDetails', () => {
  const frieren: Media = {
    id: 154587, description: 'A <b>mage</b> &amp; her party.<br>Second line.',
    startDate: { year: 2023, month: 9, day: 29 }, episodes: 28, duration: 24, format: 'TV', season: 'FALL', seasonYear: 2023,
  };

  it('formats all four fields', () => {
    expect(formatDetails(frieren)).toEqual({
      releaseDate: '2023-09-29', synopsis: 'A mage & her party. Second line.', lengthLabel: '28 ep · 24 min', origin: 'TV · Fall 2023',
    });
  });

  it('release date: year only, or empty', () => {
    expect(formatDetails({ id: 1, startDate: { year: 2020, month: null, day: null } }).releaseDate).toBe('2020');
    expect(formatDetails({ id: 1, startDate: { year: 2020, month: 5, day: null } }).releaseDate).toBe('2020');
    expect(formatDetails({ id: 1, startDate: { year: null, month: null, day: null } }).releaseDate).toBe('');
    expect(formatDetails({ id: 1 }).releaseDate).toBe('');
  });

  it('pads month and day', () => {
    expect(formatDetails({ id: 1, startDate: { year: 2001, month: 4, day: 3 } }).releaseDate).toBe('2001-04-03');
  });

  it('omits missing pieces, never prints undefined', () => {
    expect(formatDetails({ id: 1, episodes: 1, format: 'MOVIE' })).toEqual({
      releaseDate: '', synopsis: '', lengthLabel: '1 ep', origin: 'Movie',
    });
    expect(formatDetails({ id: 1, duration: 90, seasonYear: 1999 })).toMatchObject({ lengthLabel: '90 min', origin: '1999' });
    expect(formatDetails({ id: 1 })).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
  });

  it('format labels', () => {
    const o = (format: string) => formatDetails({ id: 1, format }).origin;
    expect(o('TV_SHORT')).toBe('TV Short');
    expect(o('TV')).toBe('TV');
    expect(o('OVA')).toBe('OVA');
    expect(o('ONA')).toBe('ONA');
    expect(o('SPECIAL')).toBe('Special');
    expect(o('MUSIC')).toBe('Music');
    expect(o('MOVIE')).toBe('Movie');
    expect(formatDetails({ id: 1, format: 'TV', season: 'WINTER', seasonYear: 2024 }).origin).toBe('TV · Winter 2024');
  });

  it('trims long synopses to 600 characters', () => {
    expect(formatDetails({ id: 1, description: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });
});

suite('registration', () => {
  it('anilist is registered with search and details', () => {
    expect(typeof SOURCES.anilist?.search).toBe('function');
    expect(typeof SOURCES.anilist?.details).toBe('function');
  });
});

// ---- 429 handling: the media body below is the minimum our code reads ----

suite('AniList 429 retry', () => {
  const okBody = JSON.stringify({ data: { Page: { media: [{ id: 7, title: { english: 'Frieren' }, popularity: 1 }] } } });

  // First request answers 429 (with an optional Retry-After), the rest 200.
  function flaky(first: Record<string, string>, times = 1) {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.startsWith('https://graphql.anilist.co') && calls.length <= times) {
        return new Response('{"errors":[]}', { status: 429, headers: first });
      }
      if (url.startsWith('https://graphql.anilist.co')) return new Response(okBody, { status: 200 });
      return new Response('{"data":[]}', { status: 200 });
    }) as typeof fetch;
    return Object.assign(f, { calls });
  }
  function clock() {
    const sleeps: number[] = [];
    let now = 1_000_000;
    setPacingClock({ now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    return sleeps;
  }

  it('retries once after the Retry-After wait', async () => {
    const sleeps = clock();
    const f = flaky({ 'Retry-After': '3' });
    const r = await search(q('frieren'), deps(f));
    expect(r?.title).toBe('Frieren');
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it('waits 2 s when there is no usable Retry-After', async () => {
    const sleeps = clock();
    const f = flaky({});
    expect((await search(q('frieren'), deps(f)))?.title).toBe('Frieren');
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('a Retry-After over 20 s is not waited for: no retry, no sleep', async () => {
    const sleeps = clock();
    const f = flaky({ 'Retry-After': '61' });
    const d = deps(f);
    await expect(search(q('frieren'), d)).rejects.toBeInstanceOf(SourceFailure);
    expect(sleeps.every((s) => s < 20_000)).toBe(true);
    expect(sleeps).not.toContain(61_000);
    expect(f.calls.filter((u) => u.startsWith('https://graphql.anilist.co'))).toHaveLength(1);
    expect(d.log.join('\n')).toMatch(/429/);
  });

  it('retries only once when the second answer is also 429', async () => {
    const sleeps = clock();
    const f = flaky({ 'Retry-After': '1' }, 5);
    await expect(search(q('frieren'), deps(f))).rejects.toBeInstanceOf(SourceFailure);
    expect(f.calls.filter((u) => u.startsWith('https://graphql.anilist.co'))).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('stops issuing further query variants after a 429 give-up, and never reaches Kitsu', async () => {
    clock();
    const f = flaky({ 'Retry-After': '61' });
    await expect(search(q('the frieren beyond journeys end'), deps(f))).rejects.toBeInstanceOf(SourceFailure);
    expect(f.calls).toHaveLength(1);
  });

  it('details: a 429 give-up, a 5xx and a network error throw; a 404 is a plain null', async () => {
    clock();
    const status = (n: number) => (async () => new Response('{"errors":[]}', { status: n, headers: { 'Retry-After': '61' } })) as unknown as typeof fetch;
    await expect(details('1', deps(status(429)))).rejects.toBeInstanceOf(SourceFailure);
    await expect(details('1', deps(status(500)))).rejects.toBeInstanceOf(SourceFailure);
    await expect(details('1', deps((async () => { throw new TypeError('down'); }) as unknown as typeof fetch))).rejects.toBeInstanceOf(SourceFailure);
    expect(await details('1', deps(status(404)))).toBeNull();
  });
});

// ---- fixture tests: real assertions, skipped until Dan records the cases ----

suite.skipIf(!hasFixtures('anilist', 'frieren'))('anilist fixture: frieren', () => {
  it('finds Frieren from Madhouse with an AniList cover', async () => {
    const f = replayFetch('anilist', 'frieren');
    const r = await search(q('frieren'), deps(f));
    expect(r?.title).toContain('Frieren');
    expect(r?.creator).toMatch(/madhouse/i); // AniList's studio name is upper-case ("MADHOUSE")
    expect(r?.cover.startsWith('https://s4.anilist.co/')).toBe(true);
    expect(r?.source).toBe('anilist');
    expect(r?.sourceId).toMatch(/^\d+$/);
    expect(f.unmatched).toEqual([]);
  });
});

suite.skipIf(!hasFixtures('anilist', 'jojos-bizzare'))('anilist fixture: jojos bizzare', () => {
  it('finds JoJo despite the typo, with other series entries as choices', async () => {
    const f = replayFetch('anilist', 'jojos-bizzare');
    const r = await search(q('jojos bizzare'), deps(f));
    expect(r?.title).toMatch(/jojo/i);
    expect(r?.choices).toBeDefined();
    expect(r!.choices!.length).toBeGreaterThan(1);
    expect(r!.choices!.length).toBeLessThanOrEqual(12);
    expect(r!.choices!.some((c) => c.sourceId !== r!.sourceId && /jojo/i.test(c.title))).toBe(true);
    expect(f.unmatched).toEqual([]);
  });
});

suite.skipIf(!hasFixtures('anilist', 'details-154587'))('anilist fixture: details-154587', () => {
  it('gives Frieren release date, length, origin and a plain-text synopsis', async () => {
    const f = replayFetch('anilist', 'details-154587');
    const r = await details('154587', deps(f));
    expect(r?.releaseDate).toBe('2023-09-29');
    expect(r?.lengthLabel).toBe('28 ep · 24 min');
    expect(r?.origin).toBe('TV · Fall 2023');
    expect(r?.synopsis.length).toBeGreaterThan(20);
    expect(r?.synopsis).not.toMatch(/<[^>]+>/);
  });
});

suite('AniList unreachable', () => {
  it('a 403 (blocked) or a network error stops after the first request and throws, so the caller can fall back', async () => {
    for (const f of [fakeFetch({ 'https://graphql.anilist.co': 403 }), fakeFetch({})]) {
      await expect(search(q('the frieren beyond journeys end'), deps(f))).rejects.toBeInstanceOf(SourceFailure);
      expect(f.calls).toHaveLength(1);
    }
  });
});

suite('details input', () => {
  it('rejects a non-numeric id without a request', async () => {
    const f = fakeFetch({});
    expect(await details('abc', deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
});
