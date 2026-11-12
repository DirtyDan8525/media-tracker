// Recorded fixture cases, run by `npm run record -w packages/worker` (no args).
// Each case runs through the REAL registered adapter (or the whole lookupChain
// when `chain: true`, or the adapter's details function for a `details` case)
// and is saved to test/fixtures/<source>/<case>/. Tasks 6-11 append theirs.
import type { SourceId } from '@media-tracker/shared';
import type { LookupQuery } from '../../src/lookup/sources/index';

export type FixtureCase =
  | { source: SourceId; case: string; query: LookupQuery; chain?: boolean }
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
];
