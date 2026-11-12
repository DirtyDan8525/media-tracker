// The source registry. Tasks 6-11 import their adapters here and add them to
// SOURCES; the chain (../chain.ts) and the details endpoint only look sources
// up through this map, so an unregistered source is simply skipped.
import type { Category, Details, LookupInfo, SourceId } from '@media-tracker/shared';
import type { Env } from '../../env';
import * as anilist from './anilist';
import * as deezer from './deezer';
import * as itunes from './itunes';
import * as spotify from './spotify';
import * as tmdb from './tmdb';
import * as tvmaze from './tvmaze';
import * as wiki from './wiki';

export interface LookupQuery {
  term: string;
  typedTitle: string;
  hint: string;
  /** The tab being looked up for (the wiki adapter picks film/tv/game from it; deezer searches tracks for 'songs'). */
  category: Category;
}

export interface LookupDeps {
  fetch: typeof fetch;
  env: Env;
  /** When present, request and chain decisions are appended here (secrets scrubbed). */
  log?: string[];
  /** Per-source wall-clock limit inside lookupChain (default CHAIN_SOURCE_TIMEOUT_MS). */
  sourceTimeoutMs?: number;
}

export type SourceFn = (q: LookupQuery, d: LookupDeps) => Promise<LookupInfo | null>;
export type DetailsFn = (sourceId: string, d: LookupDeps) => Promise<Details | null>;

export interface SourceEntry {
  search: SourceFn;
  /** Absent: the search result already carries what there is (the client's job). */
  details?: DetailsFn;
  /** Whether the source can run with this env. Defaults to KEY_CHECKS[source]. */
  needsKey?: (env: Env) => boolean;
}

export const SOURCE_IDS: readonly SourceId[] = [
  'anilist', 'tmdb', 'wiki', 'tvmaze', 'deezer', 'itunes', 'spotify', 'openlibrary', 'steam', 'igdb',
];

export const hasTmdbKey = (env: Env): boolean => !!env.TMDB_KEY;
export const hasIgdbKeys = (env: Env): boolean => !!env.IGDB_ID && !!env.IGDB_SECRET;

/** Key rules from the script (tmdbKey_, igdbKeys_). Adapters reuse these as their needsKey. */
export const KEY_CHECKS: Partial<Record<SourceId, (env: Env) => boolean>> = {
  tmdb: hasTmdbKey,
  igdb: hasIgdbKeys,
};

/** Registered adapters (Tasks 6-11 add theirs here). */
export const SOURCES: Partial<Record<SourceId, SourceEntry>> = {
  anilist: { search: anilist.search, details: anilist.details },
  tmdb: { search: tmdb.search, details: tmdb.details },
  wiki: { search: wiki.search, details: wiki.details },
  tvmaze: { search: tvmaze.search, details: tvmaze.details },
  deezer: { search: deezer.search, details: deezer.details },
  itunes: { search: itunes.search, details: itunes.details },
  spotify: { search: spotify.search, details: spotify.details },
};

/** Whether a registered source can run with this env: its own needsKey, else KEY_CHECKS. */
export function keysPresent(id: SourceId, entry: SourceEntry, env: Env): boolean {
  const check = entry.needsKey ?? KEY_CHECKS[id];
  return check ? check(env) : true;
}
