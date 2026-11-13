import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { lookupChain } from '../src/lookup/chain';
import { SourceFailure, resetPacing } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import { details, ITUNES_CFG, itunesDetails, itunesInfo, pickHits, rankHits, search, type ItunesHit, type ScoredHit } from '../src/lookup/sources/itunes';
import { fakeFetch, hasFixtures, replayFetch, type FakeFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string, hint = '', category: LookupQuery['category'] = 'albums', typedTitle = term): LookupQuery => ({ term, typedTitle, hint, category });
const ALBUM = ITUNES_CFG.albums!;
const EBOOK = ITUNES_CFG.books!;

beforeEach(async () => {
  resetPacing();
  await env.DB.exec('DELETE FROM lookup_cache');
});

// ---- logic tests: small synthetic inputs, not claims about iTunes' real payloads ----

describe('ITUNES_CFG', () => {
  it('albums are music/album, books are ebook/ebook', () => {
    expect(ITUNES_CFG.albums).toEqual({ media: 'music', entity: 'album' });
    expect(ITUNES_CFG.books).toEqual({ media: 'ebook', entity: 'ebook' });
    expect(ITUNES_CFG.songs).toBeUndefined();
  });
});

describe('itunesInfo', () => {
  const hit: ItunesHit = {
    collectionId: 111, collectionName: 'Abcd (Deluxe Edition)', artistName: 'Pink Floyd', trackCount: 10, releaseDate: '1973-03-01T08:00:00Z',
    artworkUrl100: 'https://x.test/a/100x100bb.jpg', genres: ['Rock', 'Music'], primaryGenreName: 'Rock',
  };
  it('album: cleaned title, 300px cover, genres, sub artist · year · first genre, sourceId = collectionId', () => {
    expect(itunesInfo(ALBUM, hit)).toEqual({
      title: 'Abcd', trusted: false, cover: 'https://x.test/a/300x300bb.jpg', genres: 'Rock, Music', creator: 'Pink Floyd',
      sub: 'Pink Floyd · 1973 · Rock', source: 'itunes', sourceId: '111',
    });
  });
  it('album titles use the script\'s edition regex (nothing stripEdition-only)', () => {
    const t = (collectionName: string) => itunesInfo(ALBUM, { collectionId: 1, collectionName }).title;
    expect(t('Pet Sounds (Mono & Stereo)')).toBe('Pet Sounds (Mono & Stereo)');
    expect(t('Abbey Road - Remastered 2009')).toBe('Abbey Road - Remastered 2009');
    expect(t('Abbey Road (Super Deluxe Edition) [Explicit]')).toBe('Abbey Road [Explicit]');
    expect(t('Rumours (Deluxe Edition) (Live)')).toBe('Rumours (Live)');
    expect(t('The Wall (Remastered) - Live')).toBe('The Wall - Live');
    expect(t('Abbey Road (Remastered 2019) - EP')).toBe('Abbey Road');
  });
  it('album: " - EP" and " - Single" suffixes are dropped', () => {
    expect(itunesInfo(ALBUM, { collectionId: 1, collectionName: 'Abcd - EP' }).title).toBe('Abcd');
    expect(itunesInfo(ALBUM, { collectionId: 1, collectionName: 'Abcd - Single' }).title).toBe('Abcd');
  });
  it('genres: falls back to primaryGenreName; "Books" is filtered out', () => {
    expect(itunesInfo(ALBUM, { collectionId: 1, collectionName: 'A', primaryGenreName: 'Pop' }).genres).toBe('Pop');
    expect(itunesInfo(EBOOK, { trackId: 2, trackName: 'B', genres: ['Fiction', 'Books'] }).genres).toBe('Fiction');
  });
  it('ebook: trackName (else collectionName) as title, sourceId = trackId', () => {
    expect(itunesInfo(EBOOK, { trackId: 222, trackName: 'The Book', collectionName: 'Series', artistName: 'Au Thor' })).toMatchObject({ title: 'The Book', sourceId: '222', creator: 'Au Thor' });
    expect(itunesInfo(EBOOK, { trackId: 3, collectionName: 'Only Collection' }).title).toBe('Only Collection');
  });
  it('missing pieces: empty title, no sourceId', () => {
    expect(itunesInfo(ALBUM, {})).toMatchObject({ title: '', cover: '', genres: '', creator: '', sub: '' });
    expect(itunesInfo(ALBUM, {}).sourceId).toBeUndefined();
  });
});

describe('rankHits and pickHits (itunes_ scoring)', () => {
  const al = (id: number, name: string, who: string, extra: Partial<ItunesHit> = {}): ItunesHit => ({ collectionId: id, collectionName: name, artistName: who, ...extra });

  it('no hint: title similarity + 0.02 Apple-order tie-break', () => {
    expect(rankHits(ALBUM, [al(1, 'Abcd', 'X')], 'abcd', '')[0]!.score).toBeCloseTo(1.02, 5);
  });
  it('hint: 0.7 title + 0.3 artist', () => {
    expect(rankHits(ALBUM, [al(1, 'Abcd', 'Pink Floyd')], 'abcd', 'pink floyd')[0]!.score).toBeCloseTo(1.02, 5);
    expect(rankHits(ALBUM, [al(1, 'Abcd', 'Zzzzzz')], 'abcd', 'pink floyd')[0]!.score).toBeLessThan(0.8);
  });
  it('the typed name may carry the artist', () => {
    expect(rankHits(ALBUM, [al(1, 'Dark Side of the Moon', 'Pink Floyd')], 'pink floyd dark side of the moon', '')[0]!.score).toBeCloseTo(1.02, 5);
  });
  it('"- Single" / "- EP" names and 3 or fewer tracks lose 0.15 (album entity only)', () => {
    const r = rankHits(ALBUM, [al(1, 'Abcd - Single', 'Y'), al(2, 'Abcd', 'X', { trackCount: 10 })], 'abcd', '');
    expect(r.map((s) => s.info.sourceId)).toEqual(['2', '1']);
    expect(r[0]!.score).toBeCloseTo(1 + 0.02 * 0.5, 5);
    expect(r[1]!.score).toBeCloseTo(1 - 0.15 + 0.02, 5);
    const few = rankHits(ALBUM, [al(1, 'Abcd', 'Y', { trackCount: 3 })], 'abcd', '');
    expect(few[0]!.score).toBeCloseTo(1 - 0.15 + 0.02, 5);
    expect(rankHits(ALBUM, [al(1, 'Abcd', 'Y', { trackCount: 4 })], 'abcd', '')[0]!.score).toBeCloseTo(1.02, 5);
    expect(rankHits(ALBUM, [al(1, 'Abcd', 'Y', { trackCount: 0 })], 'abcd', '')[0]!.score).toBeCloseTo(1.02, 5); // 0 counts as unknown, like the script
    expect(rankHits(EBOOK, [{ trackId: 1, trackName: 'Abcd', artistName: 'Y', trackCount: 1 } as ItunesHit], 'abcd', '')[0]!.score).toBeCloseTo(1.02, 5);
  });
  it('+0.2 when the release year is the typed year', () => {
    const r = rankHits(ALBUM, [al(1, 'Abcd', 'X', { releaseDate: '1999-01-01T00:00:00Z' }), al(2, 'Abcd', 'Y', { releaseDate: '2007-05-05T00:00:00Z' })], 'Abcd (2007)', '');
    expect(r.map((s) => s.info.sourceId)).toEqual(['2', '1']);
    expect(r[0]!.score).toBeCloseTo(1.2 + 0.02 * 0.5, 5);
  });
  it('other editions of the same title and artist are dropped (first one stays); nameless hits are skipped', () => {
    const r = rankHits(ALBUM, [al(1, 'Abcd (Deluxe Edition)', 'X'), al(2, 'Abcd', 'X'), { collectionId: 3, artistName: 'Z' }], 'abcd', '');
    expect(r.map((s) => s.info.sourceId)).toEqual(['1']);
  });

  const sc = (...scores: number[]): ScoredHit[] => scores.map((score, i) => ({ info: { title: 't', trusted: false, cover: '', genres: '', creator: '', source: 'itunes', sourceId: String(i + 1) }, score }));
  it('window 0.1 around the best, at most 10; no accept score', () => {
    expect(pickHits(sc(1.0, 0.91, 0.9, 0.89)).map((s) => s.info.sourceId)).toEqual(['1', '2', '3']);
    expect(pickHits(sc(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(10);
    expect(pickHits(sc(0.05))).toHaveLength(1);
    expect(pickHits([])).toEqual([]);
  });
});

describe('itunesDetails (lookup result)', () => {
  it('album: date from the ISO releaseDate, track count, no label (iTunes has none), no synopsis', () => {
    expect(itunesDetails({ collectionId: 1, wrapperType: 'collection', releaseDate: '1973-03-01T08:00:00Z', trackCount: 10, copyright: '℗ 1973 Someone' } as ItunesHit))
      .toEqual({ releaseDate: '1973-03-01', synopsis: '', lengthLabel: '10 tracks', origin: '' });
  });
  it('ebook: description as a plain trimmed synopsis, no length', () => {
    const r = itunesDetails({ trackId: 2, kind: 'ebook', releaseDate: '2010-05-04T07:00:00Z', description: '<p>A <b>great</b> read.</p>' });
    expect(r).toEqual({ releaseDate: '2010-05-04', synopsis: 'A great read.', lengthLabel: '', origin: '' });
    expect(itunesDetails({ trackId: 2, kind: 'ebook', description: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });
  it('missing pieces are empty strings', () => {
    expect(itunesDetails({})).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(itunesDetails({ releaseDate: 'garbage' }).releaseDate).toBe('');
  });
});

describe('registration', () => {
  it('itunes is registered with search and details', () => {
    expect(typeof SOURCES.itunes?.search).toBe('function');
    expect(typeof SOURCES.itunes?.details).toBe('function');
  });
});

// ---- request tests ----

const API = 'https://itunes.apple.com';
const results = (...r: unknown[]) => ({ body: JSON.stringify({ resultCount: r.length, results: r }) });

describe('search requests', () => {
  it('albums: media=music entity=album, term with its year stripped, one request', async () => {
    const f = fakeFetch({ [`${API}/search`]: results({ collectionId: 1, collectionName: 'Dark Side of the Moon', artistName: 'Pink Floyd', trackCount: 10 }) });
    const r = await search(q('dark side of the moon 1973', 'pink floyd'), deps(f));
    expect(f.calls).toEqual([`${API}/search?country=US&limit=50&media=music&entity=album&term=dark%20side%20of%20the%20moon`]);
    expect(r).toMatchObject({ title: 'Dark Side of the Moon', creator: 'Pink Floyd', source: 'itunes', sourceId: '1' });
  });
  it('books: media=ebook entity=ebook', async () => {
    const f = fakeFetch({ [`${API}/search`]: results({ trackId: 9, trackName: 'Dune', artistName: 'Frank Herbert' }) });
    expect(await search(q('dune', '', 'books'), deps(f))).toMatchObject({ title: 'Dune', sourceId: '9' });
    expect(f.calls[0]).toBe(`${API}/search?country=US&limit=50&media=ebook&entity=ebook&term=dune`);
  });
  it('other categories are not served and make no request', async () => {
    const f = fakeFetch({});
    expect(await search(q('x', '', 'movies'), deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('close runners-up become choices (top first, no nesting)', async () => {
    const f = fakeFetch({ [`${API}/search`]: results({ collectionId: 1, collectionName: 'Abcd', artistName: 'X', trackCount: 9 }, { collectionId: 2, collectionName: 'Abcd', artistName: 'Y', trackCount: 9 }) });
    const r = await search(q('abcd'), deps(f));
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['1', '2']);
    expect(r?.choices?.every((c) => c.source === 'itunes' && c.choices === undefined)).toBe(true);
  });
  it('misses on empty results or an error status', async () => {
    expect(await search(q('abcd'), deps(fakeFetch({ [`${API}/search`]: results() })))).toBeNull();
    expect(await search(q('abcd'), deps(fakeFetch({ [`${API}/search`]: 403 })))).toBeNull();
  });
});

describe('details input and request', () => {
  it('rejects a non-numeric id without a request', async () => {
    const f = fakeFetch({});
    for (const bad of ['abc', '1/../2', '12?id=3', '', 'album:1']) expect(await details(bad, deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('looks the id up and formats the first result; null when empty or on error', async () => {
    const f = fakeFetch({ [`${API}/lookup`]: results({ collectionId: 111, wrapperType: 'collection', releaseDate: '1973-03-01T08:00:00Z', trackCount: 10 }) });
    expect(await details('111', deps(f))).toEqual({ releaseDate: '1973-03-01', synopsis: '', lengthLabel: '10 tracks', origin: '' });
    expect(f.calls).toEqual([`${API}/lookup?id=111`]);
    expect(await details('111', deps(fakeFetch({ [`${API}/lookup`]: results() })))).toBeNull();
    await expect(details('111', deps(fakeFetch({ [`${API}/lookup`]: 500 })))).rejects.toBeInstanceOf(SourceFailure);
    expect(await details('111', deps(fakeFetch({ [`${API}/lookup`]: 404 })))).toBeNull();
  });
});

// ---- chain: Deezer 0 results falls through to iTunes ----

// Routes by host so one lookup can mix a hand-written Deezer answer with an iTunes one.
const split = (deezer: FakeFetch, itunes: FakeFetch): FakeFetch => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return url.startsWith('https://api.deezer.com') ? deezer(input, init) : itunes(input, init);
  }) as FakeFetch;
  return Object.assign(f, { calls, unmatched: [] as string[] });
};

describe('albums chain: Deezer finds nothing, iTunes answers', () => {
  it('with a synthetic iTunes answer', async () => {
    const dz = fakeFetch({ 'https://api.deezer.com/search/album': { body: '{"data":[]}' } });
    const it_ = fakeFetch({ [`${API}/search`]: results({ collectionId: 5, collectionName: 'Dark Side of the Moon', artistName: 'Pink Floyd', trackCount: 10 }) });
    const f = split(dz, it_);
    const r = await lookupChain('albums', q('dark side of the moon', 'pink floyd'), deps(f));
    expect(r).toMatchObject({ source: 'itunes', creator: 'Pink Floyd', sourceId: '5' });
    expect(dz.calls).toHaveLength(1);
    expect(it_.calls).toHaveLength(1);
  });
});

// ---- fixture tests: skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('itunes', 'dark-side-of-the-moon'))('itunes fixture: dark-side-of-the-moon', () => {
  it('album search finds Pink Floyd, with a 300px cover', async () => {
    const f = replayFetch('itunes', 'dark-side-of-the-moon');
    const r = await search(q('dark side of the moon', 'pink floyd'), deps(f));
    expect(r?.creator).toBe('Pink Floyd');
    expect(r?.title).toMatch(/dark side of the moon/i);
    expect(r?.sourceId).toMatch(/^\d+$/);
    expect(r?.cover).toMatch(/300x300bb/);
    expect(f.unmatched).toEqual([]);
  });
  it('chain: Deezer 0 results gives the iTunes result', async () => {
    const dz = fakeFetch({ 'https://api.deezer.com/search/album': { body: '{"data":[]}' } });
    const f = split(dz, replayFetch('itunes', 'dark-side-of-the-moon'));
    const r = await lookupChain('albums', q('dark side of the moon', 'pink floyd'), deps(f));
    expect(r?.source).toBe('itunes');
    expect(r?.creator).toBe('Pink Floyd');
  });
});
