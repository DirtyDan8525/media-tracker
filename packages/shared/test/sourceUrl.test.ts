import { describe, expect, it } from 'vitest';
import { sourceUrl } from '../src/index';

describe('sourceUrl', () => {
  it.each([
    ['anilist', '154587', 'https://anilist.co/anime/154587'],
    ['kitsu', '46474', 'https://kitsu.io/anime/46474'],
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
