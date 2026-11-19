import { describe, expect, it } from 'vitest';
import { sourceUrl, spotifyUrl } from '../src/index';

describe('sourceUrl', () => {
  it.each([
    ['anilist', '154587', 'https://anilist.co/anime/154587'],
    ['kitsu', '46474', 'https://kitsu.io/anime/46474'],
    ['kitsu', 'manga:38', 'https://kitsu.io/manga/38'],
    ['youtube', 'dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['tmdb', '1234', 'https://www.themoviedb.org/movie/1234'],
    ['wiki', 'Q42', 'https://www.wikidata.org/wiki/Q42'],
    ['wiki', '77', 'https://en.wikipedia.org/?curid=77'],
    ['tvmaze', '15', 'https://www.tvmaze.com/shows/15'],
    ['deezer', 'album:12', 'https://www.deezer.com/album/12'],
    ['deezer', 'track:77', 'https://www.deezer.com/track/77'],
    ['openlibrary', 'OL17618W', 'https://openlibrary.org/works/OL17618W'],
    ['steam', '620', 'https://store.steampowered.com/app/620/'],
    ['spotify', 'album:4aBcD3fG', 'https://open.spotify.com/album/4aBcD3fG'],
    ['spotify', 'track:1XyZ', 'https://open.spotify.com/track/1XyZ'],
  ] as const)('%s %s -> %s', (source, id, url) => {
    expect(sourceUrl(source, id)).toBe(url);
  });

  it('igdb and itunes have no page', () => {
    expect(sourceUrl('igdb', '7346')).toBeNull();
    expect(sourceUrl('itunes', '111')).toBeNull();
  });

  it('missing source or id gives null', () => {
    expect(sourceUrl(null, '1')).toBeNull();
    expect(sourceUrl('anilist', null)).toBeNull();
    expect(sourceUrl('anilist', '')).toBeNull();
    expect(sourceUrl(undefined, undefined)).toBeNull();
  });

  it('ids in the wrong shape are rejected rather than put into a URL', () => {
    expect(sourceUrl('anilist', '1/../2')).toBeNull();
    expect(sourceUrl('deezer', 'artist:5')).toBeNull();
    expect(sourceUrl('deezer', '12')).toBeNull();
    expect(sourceUrl('spotify', 'album:a/b')).toBeNull();
    expect(sourceUrl('steam', '620?x=1')).toBeNull();
    expect(sourceUrl('wiki', 'Alpha Quest')).toBeNull();
  });
});

describe('spotifyUrl', () => {
  it('a Spotify source links straight to the track or album', () => {
    expect(spotifyUrl({ source: 'spotify', sourceId: 'album:4aBcD3fG', title: 'X', creator: 'Y' })).toBe('https://open.spotify.com/album/4aBcD3fG');
    expect(spotifyUrl({ source: 'spotify', sourceId: 'track:1XyZ', title: 'X', creator: 'Y' })).toBe('https://open.spotify.com/track/1XyZ');
  });
  it('any other source searches Spotify for "title artist"', () => {
    expect(spotifyUrl({ source: 'deezer', sourceId: 'album:12', title: 'Live At Electric Lady', creator: 'Clairo' }))
      .toBe('https://open.spotify.com/search/Live%20At%20Electric%20Lady%20Clairo');
    expect(spotifyUrl({ source: null, sourceId: null, title: 'Time & Tide', creator: '' })).toBe('https://open.spotify.com/search/Time%20%26%20Tide');
  });
  it('a malformed Spotify id falls back to the search', () => {
    expect(spotifyUrl({ source: 'spotify', sourceId: 'album:a/b', title: 'T', creator: 'A' })).toBe('https://open.spotify.com/search/T%20A');
  });
});
