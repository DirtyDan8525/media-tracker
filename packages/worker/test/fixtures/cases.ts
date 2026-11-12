// Recorded fixture cases, run by `npm run record -w packages/worker` (no args).
// Each case runs through the REAL registered adapter (or the whole lookupChain
// when `chain: true`, or the adapter's details function for a `details` case)
// and is saved to test/fixtures/<source>/<case>/. Tasks 6-11 append theirs.
import type { SourceId } from '@media-tracker/shared';
import type { LookupQuery } from '../../src/lookup/sources/index';
import { parseSpotifyRef } from '../../src/lookup/sources/spotify';
import type { TermFromEnv } from '../../scripts/recordLib';

export type FixtureCase =
  // termFromEnv: the term is read from .dev.vars / the environment (query.term is a placeholder); the case is skipped when it is unset.
  | { source: SourceId; case: string; query: LookupQuery; chain?: boolean; termFromEnv?: TermFromEnv }
  // Search, then the details call for the first result's sourceId, both saved in the one case.
  | { source: SourceId; case: string; query: LookupQuery; detailsFromSearch: true }
  | { source: SourceId; case: string; details: string };

export const CASES: FixtureCase[] = [
  // Kitsu requests (the typo fallback) are recorded inside the anilist cases.
  { source: 'anilist', case: 'frieren',
    query: { term: 'frieren', typedTitle: 'frieren', hint: '', category: 'anime' } },
  { source: 'anilist', case: 'jojos-bizzare',
    query: { term: 'jojos bizzare', typedTitle: 'jojos bizzare', hint: '', category: 'anime' } },
  // Frieren's AniList media id (public); the recording shows whether it is right.
  { source: 'anilist', case: 'details-154587', details: '154587' },
  // TMDB needs a key in .dev.vars. The wiki cases call the wiki source directly, so they need none.
  { source: 'tmdb', case: 'speed-racer-2008',
    query: { term: 'Speed Racer 2008', typedTitle: 'Speed Racer 2008', hint: '', category: 'movies' } },
  { source: 'tmdb', case: 'details-speed-racer', detailsFromSearch: true,
    query: { term: 'Speed Racer 2008', typedTitle: 'Speed Racer 2008', hint: '', category: 'movies' } },
  { source: 'wiki', case: 'speed-racer',
    query: { term: 'speed racer', typedTitle: 'speed racer', hint: '', category: 'movies' } },
  { source: 'wiki', case: 'details-speed-racer', detailsFromSearch: true,
    query: { term: 'speed racer', typedTitle: 'speed racer', hint: '', category: 'movies' } },
  // TVmaze needs no key.
  { source: 'tvmaze', case: 'chuck-2007',
    query: { term: 'Chuck (2007)', typedTitle: 'Chuck (2007)', hint: '', category: 'tv' } },
  { source: 'tvmaze', case: 'details-chuck', detailsFromSearch: true,
    query: { term: 'Chuck (2007)', typedTitle: 'Chuck (2007)', hint: '', category: 'tv' } },
  // Deezer, iTunes and Spotify need no key. Deezer details are a case of their own (album, then song).
  { source: 'deezer', case: 'dark-side-of-the-moon',
    query: { term: 'dark side of the moon', typedTitle: 'dark side of the moon', hint: 'pink floyd', category: 'albums' } },
  { source: 'deezer', case: 'details-dark-side', detailsFromSearch: true,
    query: { term: 'dark side of the moon', typedTitle: 'dark side of the moon', hint: 'pink floyd', category: 'albums' } },
  { source: 'deezer', case: 'time-pink-floyd',
    query: { term: 'time', typedTitle: 'time', hint: 'pink floyd', category: 'songs' } },
  { source: 'deezer', case: 'details-time-pink-floyd', detailsFromSearch: true,
    query: { term: 'time', typedTitle: 'time', hint: 'pink floyd', category: 'songs' } },
  // Recorded directly: the "Deezer finds nothing, iTunes answers" chain test pairs it with an empty Deezer answer.
  { source: 'itunes', case: 'dark-side-of-the-moon',
    query: { term: 'dark side of the moon', typedTitle: 'dark side of the moon', hint: 'pink floyd', category: 'albums' } },
  // Open Library needs no key.
  { source: 'openlibrary', case: 'we-are-legion',
    query: { term: 'We Are Legion (We Are Bob)', typedTitle: 'We Are Legion (We Are Bob)', hint: 'Dennis E. Taylor', category: 'books' } },
  { source: 'openlibrary', case: 'details-we-are-legion', detailsFromSearch: true,
    query: { term: 'We Are Legion (We Are Bob)', typedTitle: 'We Are Legion (We Are Bob)', hint: 'Dennis E. Taylor', category: 'books' } },
  // The link is the user's to supply (R25): SPOTIFY_ALBUM_URL in .dev.vars. Goes through the chain, like a pasted link.
  { source: 'spotify', case: 'live-at-electric-lady', chain: true,
    termFromEnv: { name: 'SPOTIFY_ALBUM_URL', describe: 'a Spotify album link for Clairo \u2013 Live at Electric Lady',
      accept: (v) => parseSpotifyRef(v)?.kind === 'album' },
    query: { term: '', typedTitle: '', hint: '', category: 'albums' } },
  // IGDB needs IGDB_ID and IGDB_SECRET in .dev.vars; the token flow is recorded for real (secrets never reach the files).
  // Steam needs no key; the steam cases call the steam source directly, so they run with or without IGDB keys.
  { source: 'igdb', case: 'breath-of-the-wild',
    query: { term: 'breath of the wild', typedTitle: 'breath of the wild', hint: '', category: 'games' } },
  { source: 'igdb', case: 'details-breath-of-the-wild', detailsFromSearch: true,
    query: { term: 'breath of the wild', typedTitle: 'breath of the wild', hint: '', category: 'games' } },
  { source: 'steam', case: 'portal-2',
    query: { term: 'portal 2', typedTitle: 'portal 2', hint: '', category: 'games' } },
  { source: 'steam', case: 'details-portal-2', detailsFromSearch: true,
    query: { term: 'portal 2', typedTitle: 'portal 2', hint: '', category: 'games' } },
];
