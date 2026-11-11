// Recorded fixture cases, run by `npm run record -w packages/worker` (no args).
// Each case runs through the REAL registered adapter (or the whole lookupChain
// when `chain: true`, or the adapter's details function for a `details` case)
// and is saved to test/fixtures/<source>/<case>/. Tasks 6-11 append theirs.
import type { SourceId } from '@media-tracker/shared';
import type { LookupQuery } from '../../src/lookup/sources/index';

export type FixtureCase =
  | { source: SourceId; case: string; query: LookupQuery; chain?: boolean }
  | { source: SourceId; case: string; details: string };

export const CASES: FixtureCase[] = [
  // Example (shape only):
  // { source: 'tmdb', case: 'speed-racer-2008',
  //   query: { term: 'Speed Racer 2008', typedTitle: 'Speed Racer', hint: '', category: 'movies' } },
  // { source: 'tmdb', case: 'details-11155', details: '11155' },
];
