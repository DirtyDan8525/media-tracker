import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { lookupChain } from '../src/lookup/chain';
import { resetPacing } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  details, ogMeta, oembedCover, parseAlbumPage, parseSpotifyRef, parseTrackPage, search, spotifyDetails, spotifyInfo, type SpotifyPage,
} from '../src/lookup/sources/spotify';
import { fakeFetch, fixture, hasFixtures, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string, category: LookupQuery['category'] = 'albums'): LookupQuery => ({ term, typedTitle: term, hint: '', category });

beforeEach(async () => {
  resetPacing();
  await env.DB.exec('DELETE FROM lookup_cache');
});

// ---- logic tests: inputs are the examples quoted in the script's own comments, wrapped in minimal meta tags ----

const meta = (prop: string, content: string) => `<meta property="${prop}" content="${content}">`;
const IMG = 'https://i.scdn.co/image/ab67616d0000b273aaaa';
const albumHtml = `<html><head>${meta('og:title', 'Listen to Live At Electric Lady - Album by Clairo | Spotify')}${meta('og:description', 'Clairo · EP · 2023 · 5 songs')}${meta('og:image', IMG)}</head></html>`;
const trackHtml = `<html><head>${meta('og:title', 'Song - song and lyrics by Artist | Spotify')}${meta('og:description', 'Artist · Album · Song · 2023')}${meta('og:image', IMG)}</head></html>`;

describe('ogMeta', () => {
  it('reads property="…" content="…"', () => {
    expect(ogMeta('<meta property="og:title" content="Hello">', 'og:title')).toBe('Hello');
  });
  it('reads name="…" too', () => {
    expect(ogMeta('<meta name="og:title" content="Hello">', 'og:title')).toBe('Hello');
  });
  it('reads content before property', () => {
    expect(ogMeta('<meta content="Hello" property="og:title">', 'og:title')).toBe('Hello');
    expect(ogMeta('<meta content="Hello" name="og:title" />', 'og:title')).toBe('Hello');
  });
  it('decodes &amp; &#x27; &#39; &quot;', () => {
    expect(ogMeta('<meta property="og:title" content="Rock &amp; Roll &#x27;n&#39; &quot;Roll&quot;">', 'og:title')).toBe('Rock & Roll \'n\' "Roll"');
  });
  it('only looks in <head> when there is one', () => {
    expect(ogMeta('<head></head><body><meta property="og:title" content="Body"></body>', 'og:title')).toBe('');
    expect(ogMeta('<head><meta property="og:title" content="Head"></head><body></body>', 'og:title')).toBe('Head');
  });
  it('a 100 KB malformed input returns empty without backtracking blowup', () => {
    const bad = '<meta property="og:title" '.repeat(4000);
    const t0 = Date.now();
    expect(ogMeta(bad, 'og:title')).toBe('');
    expect(ogMeta(`<head>${bad}</head>`, 'og:title')).toBe('');
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it('is case-insensitive on the tag and empty when absent', () => {
    expect(ogMeta('<META PROPERTY="og:title" CONTENT="Hi">', 'og:title')).toBe('Hi');
    expect(ogMeta('<meta property="og:image" content="x">', 'og:title')).toBe('');
    expect(ogMeta('', 'og:title')).toBe('');
  });
});

describe('parseAlbumPage', () => {
  it('title, artist, type, year, song count and cover from the script\'s example tags', () => {
    expect(parseAlbumPage(albumHtml)).toEqual({ title: 'Live At Electric Lady', artist: 'Clairo', album: '', year: '2023', type: 'EP', songs: '5', cover: IMG });
  });
  it('the "Listen to " prefix and " | Spotify" suffix are optional; other album types parse', () => {
    const h = meta('og:title', 'Abcd - Single by Someone') + meta('og:description', 'Someone · Single · 2020 · 1 song');
    expect(parseAlbumPage(h)).toMatchObject({ title: 'Abcd', artist: 'Someone', type: 'Single', year: '2020', songs: '1' });
  });
  it('without a title match the artist comes from the description; nothing parsed is empty strings', () => {
    expect(parseAlbumPage(meta('og:title', 'Whatever') + meta('og:description', 'Clairo · Album · 2019 · 12 songs'))).toMatchObject({ title: '', artist: 'Clairo', year: '2019', songs: '12' });
    expect(parseAlbumPage('<html></html>')).toEqual({ title: '', artist: '', album: '', year: '', type: '', songs: '', cover: '' });
  });
  it('a description with fewer than three parts is ignored', () => {
    expect(parseAlbumPage(meta('og:description', 'Clairo · 2019'))).toMatchObject({ artist: '', year: '' });
  });
});

describe('parseTrackPage', () => {
  it('title, artist, album, year from the script\'s example tags', () => {
    expect(parseTrackPage(trackHtml)).toEqual({ title: 'Song', artist: 'Artist', album: 'Album', year: '2023', type: '', songs: '', cover: IMG });
  });
  it('"song by" without "and lyrics" parses; the year is whichever part is four digits', () => {
    const h = meta('og:title', 'Listen to Song - song by Artist') + meta('og:description', 'Artist · Album · 2019 · Song');
    expect(parseTrackPage(h)).toMatchObject({ title: 'Song', artist: 'Artist', album: 'Album', year: '2019' });
  });
  it('no four-digit part leaves the year empty', () => {
    expect(parseTrackPage(meta('og:description', 'Artist · Album · Song')).year).toBe('');
  });
});

describe('oembedCover', () => {
  it('300px art becomes 640px', () => {
    expect(oembedCover('https://i.scdn.co/image/ab67616d00001e02abc')).toBe('https://i.scdn.co/image/ab67616d0000b273abc');
    expect(oembedCover('https://i.scdn.co/image/other')).toBe('https://i.scdn.co/image/other');
    expect(oembedCover(undefined)).toBe('');
  });
});

describe('parseSpotifyRef', () => {
  it('album and track links, with /intl-xx/ and ?si= in any combination', () => {
    expect(parseSpotifyRef('https://open.spotify.com/intl-de/album/4aBcD3fG?si=abc')).toEqual({ kind: 'album', id: '4aBcD3fG' });
    expect(parseSpotifyRef('https://open.spotify.com/album/4aBcD3fG')).toEqual({ kind: 'album', id: '4aBcD3fG' });
    expect(parseSpotifyRef('open.spotify.com/intl-pt-br/track/1XyZ?si=q')).toEqual({ kind: 'track', id: '1XyZ' });
  });
  it('anything else is null', () => {
    expect(parseSpotifyRef('https://open.spotify.com/playlist/abc')).toBeNull();
    expect(parseSpotifyRef('dark side of the moon')).toBeNull();
    expect(parseSpotifyRef('')).toBeNull();
  });
});

describe('spotifyInfo', () => {
  const album = parseAlbumPage(albumHtml);
  it('album: trusted, sub artist · year · TYPE (not for plain albums), sourceId album:<id> with case kept', () => {
    expect(spotifyInfo('album', '4aBcD3fG', album)).toEqual({
      title: 'Live At Electric Lady', trusted: true, creator: 'Clairo', genres: '', cover: IMG, sub: 'Clairo · 2023 · EP', source: 'spotify', sourceId: 'album:4aBcD3fG',
    });
    expect(spotifyInfo('album', 'x', { ...album, type: 'Album' }).sub).toBe('Clairo · 2023');
  });
  it('track: album field, sub artist · album · year, sourceId track:<id>', () => {
    expect(spotifyInfo('track', '1XyZ', parseTrackPage(trackHtml))).toEqual({
      title: 'Song', trusted: true, creator: 'Artist', album: 'Album', genres: '', cover: IMG, sub: 'Artist · Album · 2023', source: 'spotify', sourceId: 'track:1XyZ',
    });
  });
});

describe('spotifyDetails (R24)', () => {
  const blank: SpotifyPage = { title: 't', artist: '', album: '', year: '', type: '', songs: '', cover: '' };
  it('album: year from the description, "5 songs" as "5 tracks", no synopsis or label', () => {
    expect(spotifyDetails('album', parseAlbumPage(albumHtml))).toEqual({ releaseDate: '2023', synopsis: '', lengthLabel: '5 tracks', origin: '' });
    expect(spotifyDetails('album', { ...blank, songs: '1' }).lengthLabel).toBe('1 track');
  });
  it('track: year only', () => {
    expect(spotifyDetails('track', parseTrackPage(trackHtml))).toEqual({ releaseDate: '2023', synopsis: '', lengthLabel: '', origin: '' });
  });
  it('missing pieces are empty strings', () => {
    expect(spotifyDetails('album', blank)).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(spotifyDetails('track', blank)).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
  });
});

describe('registration', () => {
  it('spotify is registered with search and details', () => {
    expect(typeof SOURCES.spotify?.search).toBe('function');
    expect(typeof SOURCES.spotify?.details).toBe('function');
  });
});

// ---- request tests ----

const PAGE = 'https://open.spotify.com';
const OEMBED = `${PAGE}/oembed?url=`;
const html = (body: string) => ({ body, contentType: 'text/html' });

describe('search requests', () => {
  it('an album link: one page request, the canonical URL, sourceId with the id\'s case', async () => {
    const f = fakeFetch({ [`${PAGE}/album/4aBcD3fG`]: html(albumHtml) });
    const r = await search(q('https://open.spotify.com/album/4aBcD3fG'), deps(f));
    expect(f.calls).toEqual([`${PAGE}/album/4aBcD3fG`]);
    expect(r).toMatchObject({ title: 'Live At Electric Lady', creator: 'Clairo', cover: IMG, sourceId: 'album:4aBcD3fG', source: 'spotify' });
  });
  it('parses defensively when handed /intl-xx/ and ?si= (the chain strips them already)', async () => {
    const f = fakeFetch({ [`${PAGE}/album/4aBcD3fG`]: html(albumHtml) });
    await search(q('https://open.spotify.com/intl-de/album/4aBcD3fG?si=abc'), deps(f));
    expect(f.calls).toEqual([`${PAGE}/album/4aBcD3fG`]);
  });
  it('a track link reads the track page', async () => {
    const f = fakeFetch({ [`${PAGE}/track/1XyZ`]: html(trackHtml) });
    expect(await search(q('https://open.spotify.com/track/1XyZ', 'songs'), deps(f))).toMatchObject({ title: 'Song', creator: 'Artist', album: 'Album', sourceId: 'track:1XyZ' });
  });
  it('the oembed backup fills a missing title and cover (cover upsized, no artist), 2 requests worst case', async () => {
    const f = fakeFetch({
      [`${PAGE}/album/4aBcD3fG`]: 404,
      [OEMBED]: { body: JSON.stringify({ title: 'Live At Electric Lady', thumbnail_url: 'https://i.scdn.co/image/ab67616d00001e02zzz' }) },
    });
    const r = await search(q('https://open.spotify.com/album/4aBcD3fG'), deps(f));
    expect(f.calls).toEqual([`${PAGE}/album/4aBcD3fG`, `${OEMBED}${encodeURIComponent(`${PAGE}/album/4aBcD3fG`)}`]);
    expect(r).toMatchObject({ title: 'Live At Electric Lady', creator: '', cover: 'https://i.scdn.co/image/ab67616d0000b273zzz' });
  });
  it('a page with a title but no cover also asks oembed for the cover', async () => {
    const noCover = meta('og:title', 'Abcd - Album by X | Spotify');
    const f = fakeFetch({
      [`${PAGE}/album/1`]: html(noCover),
      [OEMBED]: { body: JSON.stringify({ title: 'ignored', thumbnail_url: 'https://i.scdn.co/image/ab67616d00001e02c' }) },
    });
    expect(await search(q('https://open.spotify.com/album/1'), deps(f))).toMatchObject({ title: 'Abcd', creator: 'X', cover: 'https://i.scdn.co/image/ab67616d0000b273c' });
  });
  it('null when neither the page nor oembed has a title; null for a non-Spotify term without a request', async () => {
    expect(await search(q('https://open.spotify.com/album/1'), deps(fakeFetch({ [`${PAGE}/album/1`]: 404, [OEMBED]: 404 })))).toBeNull();
    const f = fakeFetch({});
    expect(await search(q('not a link'), deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
});

describe('chain: a pasted link goes to Spotify only', () => {
  it('Clairo "Live at Electric Lady" with /intl-de/ and ?si=abc', async () => {
    const f = fakeFetch({ [`${PAGE}/album/4aBcD3fG`]: html(albumHtml) });
    const r = await lookupChain('albums', q('https://open.spotify.com/intl-de/album/4aBcD3fG?si=abc'), deps(f));
    expect(f.calls).toEqual([`${PAGE}/album/4aBcD3fG`]);
    expect(r).toMatchObject({ title: 'Live At Electric Lady', creator: 'Clairo', source: 'spotify' });
  });
});

describe('details input and requests', () => {
  it('rejects anything but album:<id> / track:<id> without a request', async () => {
    const f = fakeFetch({});
    for (const bad of ['abc', 'album:', 'album:a/b', 'album:a?b', 'playlist:abc', 'album:' + 'a'.repeat(65), '4aBcD3fG', 'album:a:b', '']) {
      expect(await details(bad, deps(f))).toBeNull();
    }
    expect(f.calls).toEqual([]);
  });
  it('album: re-reads the page, one request', async () => {
    const f = fakeFetch({ [`${PAGE}/album/4aBcD3fG`]: html(albumHtml) });
    expect(await details('album:4aBcD3fG', deps(f))).toEqual({ releaseDate: '2023', synopsis: '', lengthLabel: '5 tracks', origin: '' });
    expect(f.calls).toEqual([`${PAGE}/album/4aBcD3fG`]);
  });
  it('track: year only', async () => {
    const f = fakeFetch({ [`${PAGE}/track/1XyZ`]: html(trackHtml) });
    expect(await details('track:1XyZ', deps(f))).toEqual({ releaseDate: '2023', synopsis: '', lengthLabel: '', origin: '' });
  });
  it('a page with no title falls back to oembed; it exists (empty details) or the result is null', async () => {
    const ok = fakeFetch({ [`${PAGE}/album/1`]: 404, [OEMBED]: { body: JSON.stringify({ title: 'Abcd' }) } });
    expect(await details('album:1', deps(ok))).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(ok.calls).toHaveLength(2);
    expect(await details('album:1', deps(fakeFetch({ [`${PAGE}/album/1`]: 404, [OEMBED]: 404 })))).toBeNull();
  });
  it('a page with a title does not call oembed', async () => {
    const f = fakeFetch({ [`${PAGE}/album/1`]: html(meta('og:title', 'Abcd - Album by X | Spotify')) });
    await details('album:1', deps(f));
    expect(f.calls).toHaveLength(1);
  });
});

// ---- fixture test (R25): needs SPOTIFY_ALBUM_URL when recording ----

describe.skipIf(!hasFixtures('spotify', 'live-at-electric-lady'))('spotify fixture: live-at-electric-lady', () => {
  it('a Clairo album link with /intl-de/ and ?si=abc gives "Live At Electric Lady" by Clairo', async () => {
    const index = JSON.parse(fixture('spotify/live-at-electric-lady/index.json')) as Record<string, unknown>;
    const pageUrl = Object.keys(index).find((u) => /open\.spotify\.com\/album\/[A-Za-z0-9]+$/.test(u));
    expect(pageUrl).toBeTruthy();
    const id = pageUrl!.split('/').pop()!;
    const f = replayFetch('spotify', 'live-at-electric-lady');
    const r = await lookupChain('albums', q(`https://open.spotify.com/intl-de/album/${id}?si=abc`), deps(f));
    expect(r?.title).toBe('Live At Electric Lady');
    expect(r?.creator).toBe('Clairo');
    expect(r?.cover.startsWith('https://i.scdn.co/')).toBe(true);
    expect(r?.sourceId).toBe(`album:${id}`);
    expect(f.unmatched).toEqual([]);
  });
});
