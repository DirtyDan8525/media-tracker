import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { resetPacing } from '../src/lookup/http';
import { formatMmSs, trackCountLabel } from '../src/lookup/sources/format';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  albumDetails, albumInfo, albumLengthLabel, cleanAlbumTitle, cleanTrackTitle, details, pickAlbums, pickTracks, reorderByYear, scoreAlbums,
  scoreTracks, search, trackDetails, trackInfo, trackLengthLabel, type DzAlbumHit, type DzTrackHit, type ScoredAlbum, type ScoredTrack,
} from '../src/lookup/sources/deezer';
import { fakeFetch, hasFixtures, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string, hint = '', category: LookupQuery['category'] = 'albums', typedTitle = term): LookupQuery => ({ term, typedTitle, hint, category });

beforeEach(() => resetPacing());

// ---- logic tests: small synthetic inputs, not claims about Deezer's real payloads ----

describe('trackCountLabel / formatMmSs', () => {
  it('counts tracks, singular for one, empty when missing', () => {
    expect(trackCountLabel(10)).toBe('10 tracks');
    expect(trackCountLabel(1)).toBe('1 track');
    expect(trackCountLabel(0)).toBe('');
    expect(trackCountLabel(null)).toBe('');
    expect(trackCountLabel(undefined)).toBe('');
  });
  it('m:ss', () => {
    expect(formatMmSs(222)).toBe('3:42');
    expect(formatMmSs(65)).toBe('1:05');
    expect(formatMmSs(3725)).toBe('62:05');
    expect(formatMmSs(59.6)).toBe('1:00');
    expect(formatMmSs(0)).toBe('');
    expect(formatMmSs(null)).toBe('');
  });
});

describe('cleanAlbumTitle (script regex)', () => {
  it('drops edition groups, keeps other brackets', () => {
    expect(cleanAlbumTitle('The Dark Side of the Moon (2011 Remastered Version)')).toBe('The Dark Side of the Moon');
    expect(cleanAlbumTitle('Abbey Road [Deluxe Edition]')).toBe('Abbey Road');
    expect(cleanAlbumTitle('Abbey Road (Super Deluxe) (Remastered)')).toBe('Abbey Road');
    expect(cleanAlbumTitle('Live at Pompeii (Live)')).toBe('Live at Pompeii (Live)'); // "live" is not an edition word
    expect(cleanAlbumTitle('Plain')).toBe('Plain');
    expect(cleanAlbumTitle(null)).toBe('');
  });
});

// Expected values come from running the script's own regex (see the fix report), not from assumption.
describe.each([
  ['Abbey Road (Remastered 2019)', 'Abbey Road'],
  ['Blue (Live)', 'Blue (Live)'],
  ["Fearless (Taylor's Version)", 'Fearless'],
  ['Pet Sounds (Mono & Stereo)', 'Pet Sounds (Mono & Stereo)'],
  ['Nevermind (Bonus Tracks)', 'Nevermind (Bonus Tracks)'],
  ['Dummy (Reissue)', 'Dummy (Reissue)'],
  ['Abbey Road - Remastered 2009', 'Abbey Road - Remastered 2009'],
  ['Album - The Expanded Edition', 'Album - The Expanded Edition'],
  ['Abbey Road (Super Deluxe Edition) [Explicit]', 'Abbey Road [Explicit]'],
  ['Rumours (Deluxe Edition) (Live)', 'Rumours (Live)'],
  ['The Wall (Remastered) - Live', 'The Wall - Live'],
])('cleanAlbumTitle matches the script: %s', (input, expected) => {
  it(`-> ${expected}`, () => expect(cleanAlbumTitle(input)).toBe(expected));
});

describe('cleanTrackTitle', () => {
  it('drops remaster/version/edit/mono/stereo/live groups and a trailing " - ...remaster..."', () => {
    expect(cleanTrackTitle('Time (2011 Remastered Version)')).toBe('Time');
    expect(cleanTrackTitle('Time - 2011 Remaster')).toBe('Time');
    expect(cleanTrackTitle('Time (Live)')).toBe('Time');
    expect(cleanTrackTitle('Time [Radio Edit]')).toBe('Time');
    expect(cleanTrackTitle('Time (Mono)')).toBe('Time');
    expect(cleanTrackTitle('Time (feat. Someone)')).toBe('Time (feat. Someone)');
    expect(cleanTrackTitle(undefined)).toBe('');
  });
});

describe('scoreAlbums and pickAlbums (deezer_ scoring)', () => {
  const al = (id: number, title: string, who: string, record_type = 'album'): DzAlbumHit => ({ id, title, artist: { name: who }, record_type });

  it('with a hint: 0.7 title + 0.3 artist + 0.12 rank bonus', () => {
    const r = scoreAlbums([al(1, 'Abcd Efgh', 'Pink Floyd')], 'abcd efgh', 'pink floyd');
    expect(r[0]!.score).toBeCloseTo(1.12, 5);
    expect(r[0]!.who).toBe('Pink Floyd');
  });
  it('without a hint: title similarity + 0.12 rank bonus', () => {
    expect(scoreAlbums([al(1, 'Abcd Efgh', 'X')], 'abcd efgh', '')[0]!.score).toBeCloseTo(1.12, 5);
  });
  it('the typed name may include the artist, in either order', () => {
    expect(scoreAlbums([al(1, 'Dark Side of the Moon', 'Pink Floyd')], 'pink floyd dark side of the moon', '')[0]!.score).toBeCloseTo(1.12, 5);
    expect(scoreAlbums([al(1, 'Dark Side of the Moon', 'Pink Floyd')], 'dark side of the moon pink floyd', '')[0]!.score).toBeCloseTo(1.12, 5);
  });
  it('singles and EPs lose 0.15 against full albums', () => {
    const r = scoreAlbums([al(1, 'Abcd', 'EpBand', 'ep'), al(2, 'Abcd', 'AlbumBand', 'album')], 'abcd', '');
    expect(r.map((s) => s.a.id)).toEqual([2, 1]);
    expect(r[0]!.score).toBeCloseTo(1 + 0.12 * 0.5, 5); // rank 1 of 2
    expect(r[1]!.score).toBeCloseTo(1 - 0.15 + 0.12, 5); // rank 0 of 2
  });
  it('a missing record_type is not penalised', () => {
    expect(scoreAlbums([{ id: 1, title: 'Abcd', artist: { name: 'X' } }], 'abcd', '')[0]!.score).toBeCloseTo(1.12, 5);
  });
  it('other editions of the same album by the same artist are dropped (first one stays), titles cleaned', () => {
    const r = scoreAlbums([al(1, 'Abcd (Deluxe Edition)', 'X'), al(2, 'Abcd', 'X'), al(3, 'Abcd', 'Y')], 'abcd', '');
    expect(r.map((s) => s.a.id).sort()).toEqual([1, 3]);
    expect(r.find((s) => s.a.id === 1)!.title).toBe('Abcd');
  });

  const sc = (...scores: number[]): ScoredAlbum[] => scores.map((score, i) => ({ a: { id: i + 1, title: 't' }, title: 't', who: 'w', score }));
  it('window 0.1 around the best, at most 8; no accept score for albums', () => {
    expect(pickAlbums(sc(1.0, 0.91, 0.9, 0.89)).map((s) => s.a.id)).toEqual([1, 2, 3]);
    expect(pickAlbums(sc(1, 1, 1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(8);
    expect(pickAlbums(sc(0.1)).map((s) => s.a.id)).toEqual([1]);
    expect(pickAlbums([])).toEqual([]);
  });
});

describe('reorderByYear', () => {
  it('+0.2 for an album released in the typed year, then best first; untouched without a year', () => {
    const items = [{ id: 1, rel: '1999', score: 1 }, { id: 2, rel: '2007', score: 0.9 }, { id: 3, rel: '', score: 0.95 }];
    expect(reorderByYear(items, '2007').map((i) => i.id)).toEqual([2, 1, 3]);
    expect(reorderByYear(items, '').map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe('scoreTracks and pickTracks (deezerTrack_ scoring)', () => {
  const tr = (id: number, title: string, who: string, rank: number, album = 'Alb'): DzTrackHit => ({ id, title, title_short: title, rank, artist: { name: who }, album: { id: id * 10, title: album } });

  it('with a hint: 0.7 title + 0.3 artist + 0.15 popularity bonus', () => {
    expect(scoreTracks([tr(1, 'Time', 'Pink Floyd', 900000)], 'time', 'pink floyd')[0]!.score).toBeCloseTo(1.15, 5);
  });
  it('more popular versions score higher; the same song on several albums keeps the first', () => {
    const r = scoreTracks([tr(1, 'Time', 'X', 10), tr(2, 'Time', 'X', 500), tr(3, 'Time', 'Y', 500)], 'time', '');
    expect(r.map((s) => s.t.id).sort()).toEqual([1, 3]);
    expect(r[0]!.t.id).toBe(3); // rank 500 is the most popular
  });
  it('uses title_short over title and cleans it', () => {
    expect(scoreTracks([{ id: 1, title: 'Time (2011 Remastered Version)', title_short: 'Time (2011 Remastered Version)', artist: { name: 'X' } }], 'time', '')[0]!.title).toBe('Time');
    expect(scoreTracks([{ id: 1, title: 'Long Title Here', title_short: 'Time', artist: { name: 'X' } }], 'time', '')[0]!.title).toBe('Time');
  });

  const sc = (...scores: number[]): ScoredTrack[] => scores.map((score, i) => ({ t: { id: i + 1, title: 't' }, title: 't', who: 'w', score }));
  it('accepts 0.45 or more, rejects under it', () => {
    expect(pickTracks(sc(0.44))).toBeNull();
    expect(pickTracks(sc(0.45))?.map((s) => s.t.id)).toEqual([1]);
    expect(pickTracks([])).toBeNull();
  });
  it('window 0.1, at most 8', () => {
    expect(pickTracks(sc(1.0, 0.91, 0.9, 0.89))?.map((s) => s.t.id)).toEqual([1, 2, 3]);
    expect(pickTracks(sc(1, 1, 1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(8);
  });
});

describe('length labels', () => {
  it('album: "<n> tracks · <minutes> min"', () => {
    expect(albumLengthLabel(10, 2580)).toBe('10 tracks · 43 min');
    expect(albumLengthLabel(10, 2579)).toBe('10 tracks · 43 min'); // rounded
    expect(albumLengthLabel(10, undefined)).toBe('10 tracks');
    expect(albumLengthLabel(undefined, 2580)).toBe('43 min');
    expect(albumLengthLabel(undefined, undefined)).toBe('');
    expect(albumLengthLabel(0, 0)).toBe('');
  });
  it('song: m:ss', () => {
    expect(trackLengthLabel(222)).toBe('3:42');
    expect(trackLengthLabel(undefined)).toBe('');
  });
});

describe('albumInfo / trackInfo', () => {
  const a: ScoredAlbum = { a: { id: 12, title: 'x', record_type: 'album', cover_xl: 'xl.jpg', cover_big: 'big.jpg' }, title: 'Dark Side', who: 'Pink Floyd', score: 1 };
  it('maps an album: sourceId album:<id>, cover xl then big then medium, sub artist · year', () => {
    expect(albumInfo(a, 'Rock', '1973')).toEqual({
      title: 'Dark Side', trusted: false, creator: 'Pink Floyd', genres: 'Rock', cover: 'xl.jpg', sub: 'Pink Floyd · 1973', source: 'deezer', sourceId: 'album:12',
    });
    expect(albumInfo({ ...a, a: { id: 1, title: 'x', cover_medium: 'm.jpg' } }, '', '').cover).toBe('m.jpg');
    expect(albumInfo({ ...a, a: { id: 1, title: 'x' } }, '', '').cover).toBe('');
  });
  it('EPs and singles say so in sub', () => {
    expect(albumInfo({ ...a, a: { id: 1, title: 'x', record_type: 'ep' } }, '', '2020').sub).toBe('Pink Floyd · 2020 · EP');
    expect(albumInfo({ ...a, a: { id: 1, title: 'x', record_type: 'single' } }, '', '').sub).toBe('Pink Floyd · SINGLE');
  });
  it('maps a track: album field, cover from the album, sourceId track:<id>', () => {
    const t: ScoredTrack = { t: { id: 77, title: 'x', album: { id: 5, title: 'The Dark Side of the Moon', cover_xl: 'axl.jpg', cover_big: 'abig.jpg' } }, title: 'Time', who: 'Pink Floyd', score: 1 };
    expect(trackInfo(t, 'Rock', '1973')).toEqual({
      title: 'Time', trusted: false, creator: 'Pink Floyd', album: 'The Dark Side of the Moon', genres: 'Rock', cover: 'axl.jpg',
      sub: 'Pink Floyd · The Dark Side of the Moon · 1973', source: 'deezer', sourceId: 'track:77',
    });
    expect(trackInfo({ ...t, t: { id: 1, title: 'x' } }, '', '')).toMatchObject({ album: '', cover: '', sub: 'Pink Floyd' });
  });
});

describe('albumDetails / trackDetails', () => {
  it('album: release_date, label, length label, empty synopsis', () => {
    expect(albumDetails({ release_date: '1973-03-01', label: 'Harvest', nb_tracks: 10, duration: 2580 }))
      .toEqual({ releaseDate: '1973-03-01', synopsis: '', lengthLabel: '10 tracks · 43 min', origin: 'Harvest' });
  });
  it('album: missing pieces are empty strings', () => {
    expect(albumDetails({})).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(albumDetails({ release_date: '0000-00-00', label: null }).releaseDate).toBe('');
  });
  it('track: m:ss, the track release date wins over the album date, label from the album', () => {
    expect(trackDetails({ release_date: '1973-03-01', duration: 222 }, { release_date: '2011-09-26', label: 'Harvest' }))
      .toEqual({ releaseDate: '1973-03-01', synopsis: '', lengthLabel: '3:42', origin: 'Harvest' });
    expect(trackDetails({ duration: 222 }, { release_date: '2011-09-26', label: 'Harvest' }).releaseDate).toBe('2011-09-26');
    expect(trackDetails({}, null)).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
  });
});

describe('registration', () => {
  it('deezer is registered with search and details', () => {
    expect(typeof SOURCES.deezer?.search).toBe('function');
    expect(typeof SOURCES.deezer?.details).toBe('function');
  });
});

// ---- request tests (synthetic minimal bodies: only the fields the parser reads) ----

const API = 'https://api.deezer.com';
const albumSearch = (data: unknown[]) => ({ body: JSON.stringify({ data }) });
const rec = (id: number, title: string, who: string, record_type = 'album') => ({ id, title, record_type, artist: { name: who }, cover_xl: `https://c/${id}.jpg` });

describe('album search requests', () => {
  it('with a hint searches artist:"…" album:"…", reads each pick\'s page for genres and year', async () => {
    const f = fakeFetch({
      [`${API}/search/album`]: albumSearch([rec(1, 'The Dark Side of the Moon', 'Pink Floyd'), rec(2, 'Dark Side of the Moon (Live)', 'Other')]),
      [`${API}/album/1`]: { body: JSON.stringify({ genres: { data: [{ name: 'Rock' }, { name: 'Pop' }] }, release_date: '1973-03-01' }) },
    });
    const r = await search(q('dark side of the moon', 'pink floyd'), deps(f));
    expect(f.calls[0]).toBe(`${API}/search/album?limit=40&q=${encodeURIComponent('artist:"pink floyd" album:"dark side of the moon"')}`);
    expect(r).toMatchObject({ title: 'The Dark Side of the Moon', creator: 'Pink Floyd', genres: 'Rock, Pop', sub: 'Pink Floyd · 1973', source: 'deezer', sourceId: 'album:1', trusted: false });
    expect(r?.sub).not.toMatch(/SINGLE|EP/);
  });
  it('without a hint searches the term with its year stripped', async () => {
    const f = fakeFetch({ [`${API}/search/album`]: albumSearch([rec(1, 'Abcd', 'X')]), [`${API}/album/`]: { body: '{}' } });
    await search(q('Abcd 2001'), deps(f));
    expect(f.calls[0]).toBe(`${API}/search/album?limit=40&q=Abcd`);
  });
  it('close runners-up become choices; the typed year reorders them', async () => {
    const f = fakeFetch({
      [`${API}/search/album`]: albumSearch([rec(1, 'Abcd', 'X'), rec(2, 'Abcd', 'Y')]),
      [`${API}/album/1`]: { body: JSON.stringify({ release_date: '1999-01-01' }) },
      [`${API}/album/2`]: { body: JSON.stringify({ release_date: '2007-05-05' }) },
    });
    const r = await search(q('Abcd', '', 'albums', 'Abcd (2007)'), deps(f));
    expect(r?.sourceId).toBe('album:2');
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['album:2', 'album:1']);
    expect(r?.choices?.every((c) => c.source === 'deezer' && c.choices === undefined)).toBe(true);
  });
  it('a failing album page just leaves genres and year empty', async () => {
    const f = fakeFetch({ [`${API}/search/album`]: albumSearch([rec(1, 'Abcd', 'X')]), [`${API}/album/1`]: 500 });
    expect(await search(q('Abcd'), deps(f))).toMatchObject({ title: 'Abcd', genres: '', sub: 'X' });
  });
  it('misses on 0 results, an error status, or an error body', async () => {
    expect(await search(q('abcd'), deps(fakeFetch({ [`${API}/search/album`]: albumSearch([]) })))).toBeNull();
    expect(await search(q('abcd'), deps(fakeFetch({ [`${API}/search/album`]: 500 })))).toBeNull();
    expect(await search(q('abcd'), deps(fakeFetch({ [`${API}/search/album`]: { body: '{"error":{"type":"Exception","code":4}}' } })))).toBeNull();
  });
  it('worst case is 7 requests: the search plus at most 6 album pages', async () => {
    const data = Array.from({ length: 40 }, (_, i) => rec(i + 1, 'Abcd', `Artist ${i}`));
    const f = fakeFetch({ [`${API}/search/album`]: albumSearch(data), [`${API}/album/`]: { body: '{}' } });
    const r = await search(q('Abcd'), deps(f));
    expect(r?.choices).toHaveLength(8);
    expect(f.calls).toHaveLength(7);
  });
});

describe('song search requests', () => {
  const trackHit = (id: number, title: string, who: string, rank: number, albumId: number, album: string) =>
    ({ id, title, title_short: title, rank, artist: { name: who }, album: { id: albumId, title: album, cover_xl: `https://c/${albumId}.jpg` } });

  it('category songs searches tracks with artist:"…" track:"…" and fills album and year', async () => {
    const f = fakeFetch({
      [`${API}/search/track`]: { body: JSON.stringify({ data: [trackHit(77, 'Time', 'Pink Floyd', 800000, 5, 'The Dark Side of the Moon')] }) },
      [`${API}/album/5`]: { body: JSON.stringify({ genres: { data: [{ name: 'Rock' }] }, release_date: '1973-03-01' }) },
    });
    const r = await search(q('time', 'pink floyd', 'songs'), deps(f));
    expect(f.calls[0]).toBe(`${API}/search/track?limit=40&q=${encodeURIComponent('artist:"pink floyd" track:"time"')}`);
    expect(r).toMatchObject({ title: 'Time', creator: 'Pink Floyd', album: 'The Dark Side of the Moon', genres: 'Rock', sub: 'Pink Floyd · The Dark Side of the Moon · 1973', sourceId: 'track:77', source: 'deezer' });
  });
  it('without a hint the query is the typed name; a weak match is a miss', async () => {
    const f = fakeFetch({ [`${API}/search/track`]: { body: JSON.stringify({ data: [trackHit(1, 'Zzzzzzzz', 'Q', 1, 0, '')] }) } });
    expect(await search(q('time', '', 'songs'), deps(f))).toBeNull();
    expect(f.calls).toEqual([`${API}/search/track?limit=40&q=time`]);
  });
  it('misses on 0 results and on an error status', async () => {
    expect(await search(q('time', '', 'songs'), deps(fakeFetch({ [`${API}/search/track`]: { body: '{"data":[]}' } })))).toBeNull();
    expect(await search(q('time', '', 'songs'), deps(fakeFetch({ [`${API}/search/track`]: 500 })))).toBeNull();
  });
  it('worst case is 5 requests: the search plus at most 4 album pages', async () => {
    const data = Array.from({ length: 40 }, (_, i) => trackHit(i + 1, 'Time', `Artist ${i}`, 1000 - i, i + 100, `Album ${i}`));
    const f = fakeFetch({ [`${API}/search/track`]: { body: JSON.stringify({ data }) }, [`${API}/album/`]: { body: '{}' } });
    const r = await search(q('time', '', 'songs'), deps(f));
    expect(r?.choices).toHaveLength(8);
    expect(f.calls).toHaveLength(5);
  });
});

describe('details input and requests', () => {
  it('rejects anything but album:<digits> / track:<digits> without a request', async () => {
    const f = fakeFetch({});
    for (const bad of ['abc', '123', 'album:', 'album:abc', 'album:1/../2', 'track:1?x=2', 'playlist:1', 'album:1:2', '', 'ALBUM:1']) {
      expect(await details(bad, deps(f))).toBeNull();
    }
    expect(f.calls).toEqual([]);
  });
  it('album: one request to /album/{id}', async () => {
    const f = fakeFetch({ [`${API}/album/12`]: { body: JSON.stringify({ release_date: '1973-03-01', label: 'Harvest', nb_tracks: 10, duration: 2580 }) } });
    expect(await details('album:12', deps(f))).toEqual({ releaseDate: '1973-03-01', synopsis: '', lengthLabel: '10 tracks · 43 min', origin: 'Harvest' });
    expect(f.calls).toEqual([`${API}/album/12`]);
  });
  it('track: /track/{id}, then the album page for the label (and the date when the track has none)', async () => {
    const f = fakeFetch({
      [`${API}/track/77`]: { body: JSON.stringify({ duration: 222, album: { id: 5 } }) },
      [`${API}/album/5`]: { body: JSON.stringify({ release_date: '1973-03-01', label: 'Harvest' }) },
    });
    expect(await details('track:77', deps(f))).toEqual({ releaseDate: '1973-03-01', synopsis: '', lengthLabel: '3:42', origin: 'Harvest' });
    expect(f.calls).toEqual([`${API}/track/77`, `${API}/album/5`]);
  });
  it('track without an album id makes no album request; a failing album page keeps the track fields', async () => {
    const f1 = fakeFetch({ [`${API}/track/77`]: { body: JSON.stringify({ duration: 65, release_date: '2001-02-03' }) } });
    expect(await details('track:77', deps(f1))).toEqual({ releaseDate: '2001-02-03', synopsis: '', lengthLabel: '1:05', origin: '' });
    expect(f1.calls).toHaveLength(1);
    const f2 = fakeFetch({ [`${API}/track/77`]: { body: JSON.stringify({ duration: 65, album: { id: 5 } }) }, [`${API}/album/5`]: 500 });
    expect(await details('track:77', deps(f2))).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '1:05', origin: '' });
  });
  it('null on an error status or an error body', async () => {
    expect(await details('album:12', deps(fakeFetch({ [`${API}/album/12`]: 404 })))).toBeNull();
    expect(await details('album:12', deps(fakeFetch({ [`${API}/album/12`]: { body: '{"error":{"code":800}}' } })))).toBeNull();
    expect(await details('track:7', deps(fakeFetch({ [`${API}/track/7`]: 500 })))).toBeNull();
  });
});

// ---- fixture tests: skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('deezer', 'dark-side-of-the-moon'))('deezer fixture: dark-side-of-the-moon', () => {
  it('album "dark side of the moon" + hint "pink floyd" gives Pink Floyd, not a single', async () => {
    const f = replayFetch('deezer', 'dark-side-of-the-moon');
    const r = await search(q('dark side of the moon', 'pink floyd'), deps(f));
    expect(r?.creator).toBe('Pink Floyd');
    expect(r?.title).toMatch(/dark side of the moon/i);
    expect(r?.sub).not.toMatch(/\b(SINGLE|EP)\b/);
    expect(r?.source).toBe('deezer');
    expect(r?.sourceId).toMatch(/^album:\d+$/);
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('deezer', 'details-dark-side'))('deezer fixture: details-dark-side', () => {
  it('release date, track count and minutes, label', async () => {
    const f = replayFetch('deezer', 'details-dark-side');
    const found = await search(q('dark side of the moon', 'pink floyd'), deps(f));
    const r = await details(found!.sourceId!, deps(f));
    expect(r?.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r?.lengthLabel).toMatch(/^\d+ tracks · \d+ min$/);
    expect(r?.origin).not.toBe('');
    expect(r?.synopsis).toBe('');
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('deezer', 'time-pink-floyd'))('deezer fixture: time-pink-floyd (songs)', () => {
  it('finds the track with its album', async () => {
    const f = replayFetch('deezer', 'time-pink-floyd');
    const r = await search(q('time', 'pink floyd', 'songs'), deps(f));
    expect(r?.creator).toBe('Pink Floyd');
    expect(r?.title).toMatch(/^time/i);
    expect(r?.album).toBeTruthy();
    expect(r?.sourceId).toMatch(/^track:\d+$/);
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('deezer', 'details-time-pink-floyd'))('deezer fixture: details-time-pink-floyd', () => {
  it('song length as m:ss, release date and label', async () => {
    const f = replayFetch('deezer', 'details-time-pink-floyd');
    const found = await search(q('time', 'pink floyd', 'songs'), deps(f));
    const r = await details(found!.sourceId!, deps(f));
    expect(r?.lengthLabel).toMatch(/^\d+:\d{2}$/);
    expect(r?.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r?.origin).not.toBe('');
    expect(f.unmatched).toEqual([]);
  });
});
