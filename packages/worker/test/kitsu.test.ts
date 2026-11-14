import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { SourceFailure } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import { details, formatDetails, pickBest, search, toInfo, type KitsuAnime } from '../src/lookup/sources/kitsu';
import { fakeFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string): LookupQuery => ({ term, typedTitle: term, hint: '', category: 'anime' });

// Small hand-written bodies in Kitsu's JSON:API shape: only what the adapter reads.
const anime = (id: string, attributes: KitsuAnime['attributes'], cats: string[] = []): KitsuAnime => ({
  id, attributes, relationships: { categories: { data: cats.map((c) => ({ id: c })) } },
});
const frieren = anime('46474', {
  titles: { en: 'Frieren: Beyond Journey\'s End', en_jp: 'Sousou no Frieren' }, canonicalTitle: 'Sousou no Frieren',
  startDate: '2023-09-29', posterImage: { large: 'https://media.kitsu.io/large.jpg', original: 'https://media.kitsu.io/orig.jpg' },
}, ['1', '2', '3']);
const included = [
  { id: '1', type: 'categories', attributes: { title: 'Adventure' } },
  { id: '2', type: 'categories', attributes: { title: 'Fantasy' } },
  { id: '3', type: 'categories', attributes: { title: 'Drama' } },
];
const SEARCH = 'https://kitsu.io/api/edge/anime?filter[text]=';

describe('kitsu pickBest', () => {
  it('picks the closest title and rejects anything under 0.45', () => {
    const other = anime('2', { canonicalTitle: 'Totally Unrelated Show' });
    expect(pickBest([other, frieren], 'frieren beyond journeys end')?.id).toBe('46474');
    expect(pickBest([other], 'zzzzzz')).toBeNull();
    expect(pickBest([], 'frieren')).toBeNull();
  });

  it('matches the Japanese or canonical title too, and a typed year breaks a tie', () => {
    expect(pickBest([frieren], 'sousou no frieren')?.id).toBe('46474');
    const a = anime('1', { canonicalTitle: 'Same Name', startDate: '2001-04-01' });
    const b = anime('2', { canonicalTitle: 'Same Name', startDate: '2019-04-01' });
    expect(pickBest([a, b], 'same name 2019')?.id).toBe('2');
    expect(pickBest([a, b], 'same name')?.id).toBe('1');
  });
});

describe('kitsu toInfo', () => {
  it('maps title, large cover, genres from the included categories, and the source', () => {
    expect(toInfo(frieren, included)).toEqual({
      title: 'Frieren: Beyond Journey\'s End', trusted: true, cover: 'https://media.kitsu.io/large.jpg',
      genres: 'Adventure, Fantasy, Drama', creator: '', source: 'kitsu', sourceId: '46474',
    });
  });

  it('title falls back to canonical then en_jp; cover to original; genres cap at 5 and may be empty', () => {
    expect(toInfo(anime('1', { canonicalTitle: 'Canon', titles: { en_jp: 'Jp' } })).title).toBe('Canon');
    expect(toInfo(anime('1', { titles: { en_jp: 'Jp' } })).title).toBe('Jp');
    expect(toInfo(anime('1', { posterImage: { original: 'https://x/o.jpg' } })).cover).toBe('https://x/o.jpg');
    expect(toInfo(anime('1', {})).genres).toBe('');
    const ids = ['1', '2', '3', '4', '5', '6', '7'];
    const many = ids.map((id) => ({ id, type: 'categories', attributes: { title: `G${id}` } }));
    expect(toInfo(anime('1', {}, ids), many).genres).toBe('G1, G2, G3, G4, G5');
  });
});

describe('kitsu search', () => {
  it('requests 10 hits with categories and the vnd.api+json Accept header, and returns the best', async () => {
    let accept: string | null = null;
    const base = fakeFetch({ [SEARCH]: { body: JSON.stringify({ data: [frieren], included }) } });
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      accept = new Headers(init?.headers).get('accept');
      return base(input, init);
    }) as typeof fetch;
    const r = await search(q('frieren beyond journeys end'), deps(Object.assign(f, base)));
    expect(r).toMatchObject({ title: 'Frieren: Beyond Journey\'s End', source: 'kitsu', sourceId: '46474', genres: 'Adventure, Fantasy, Drama' });
    expect(base.calls).toEqual([`${SEARCH}frieren%20beyond%20journeys%20end&page[limit]=10&include=categories`]);
    expect(accept).toBe('application/vnd.api+json');
  });

  it('null when nothing scores well, on a non-200, and when the request fails', async () => {
    const poor = fakeFetch({ [SEARCH]: { body: JSON.stringify({ data: [anime('2', { canonicalTitle: 'Totally Unrelated' })] }) } });
    expect(await search(q('zzzzzz'), deps(poor))).toBeNull();
    expect(await search(q('frieren'), deps(fakeFetch({ [SEARCH]: 503 })))).toBeNull();
    expect(await search(q('frieren'), deps(fakeFetch({})))).toBeNull();
  });
});

describe('kitsu details', () => {
  const body = (attributes: object) => JSON.stringify({ data: { id: '46474', attributes } });
  const URL = 'https://kitsu.io/api/edge/anime/46474';

  it('formats release date, synopsis, length and origin (subtype + year)', async () => {
    const f = fakeFetch({ [URL]: { body: body({
      startDate: '2023-09-29', synopsis: 'A <b>mage</b> &amp; her party.', episodeCount: 28, episodeLength: 24, subtype: 'TV',
    }) } });
    expect(await details('46474', deps(f))).toEqual({
      releaseDate: '2023-09-29', synopsis: 'A mage & her party.', lengthLabel: '28 ep · 24 min', origin: 'TV · 2023',
    });
  });

  it('subtype labels, missing pieces and the 600-character synopsis cap', () => {
    const o = (subtype: string) => formatDetails({ subtype, startDate: '2016-08-26' }).origin;
    expect(o('movie')).toBe('Movie · 2016');
    expect(o('OVA')).toBe('OVA · 2016');
    expect(o('ONA')).toBe('ONA · 2016');
    expect(o('special')).toBe('Special · 2016');
    expect(o('music')).toBe('Music · 2016');
    expect(formatDetails({})).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(formatDetails({ episodeCount: 1 }).lengthLabel).toBe('1 ep');
    expect(formatDetails({ episodeLength: 90 }).lengthLabel).toBe('90 min');
    expect(formatDetails({ startDate: '2020' }).releaseDate).toBe('2020');
    expect(formatDetails({ synopsis: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });

  it('a 404 is a plain null; a 5xx, a network error and a non-numeric id behave as the other sources do', async () => {
    expect(await details('46474', deps(fakeFetch({ [URL]: 404 })))).toBeNull();
    await expect(details('46474', deps(fakeFetch({ [URL]: 503 })))).rejects.toBeInstanceOf(SourceFailure);
    await expect(details('46474', deps(fakeFetch({})))).rejects.toBeInstanceOf(SourceFailure);
    const f = fakeFetch({});
    expect(await details('abc', deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
});

describe('registration', () => {
  it('kitsu is registered with search and details', () => {
    expect(typeof SOURCES.kitsu?.search).toBe('function');
    expect(typeof SOURCES.kitsu?.details).toBe('function');
  });
});
