// The lookup chain: a port of the script's lookup_ (reference/MediaTrackerCovers.gs).
import type { Category, LookupInfo, SourceId } from '@media-tracker/shared';
import { getCached, putCached } from './cache';
import { logLine } from './http';
import { SOURCES, keysPresent, type LookupDeps, type LookupQuery } from './sources/index';

/** Sources tried in order per tab, exactly as lookup_ does after the Spotify check. */
export const CHAINS: Record<Category, SourceId[]> = {
  anime: ['anilist'], // Kitsu spelling correction happens inside the anilist adapter
  songs: ['deezer'], // the deezer adapter searches tracks when q.category === 'songs'
  games: ['igdb', 'steam', 'wiki'],
  movies: ['tmdb', 'wiki'],
  tv: ['tvmaze', 'wiki'],
  albums: ['deezer', 'itunes'],
  books: ['openlibrary', 'itunes'],
};

/** A source that hasn't answered within this long is abandoned and the chain moves on. */
export const CHAIN_SOURCE_TIMEOUT_MS = 25_000;

// Verbatim from lookup_ (script lines 882 and 884).
const SPOTIFY_ALBUM = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/([A-Za-z0-9]+)/;
const SPOTIFY_TRACK = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]+)/;

/** A pasted Spotify album/track link, normalized (no /intl-xx/, no ?si=). */
export function parseSpotifyLink(term: string): { kind: 'album' | 'track'; id: string; url: string } | null {
  const album = SPOTIFY_ALBUM.exec(term);
  if (album) return { kind: 'album', id: album[1]!, url: `https://open.spotify.com/album/${album[1]}` };
  const track = SPOTIFY_TRACK.exec(term);
  if (track) return { kind: 'track', id: track[1]!, url: `https://open.spotify.com/track/${track[1]}` };
  return null;
}

/**
 * Cache key for a chain lookup: JSON of [term, hint, typedTitle], each trimmed
 * and lowercased (JSON so no part can bleed into another). A Spotify link keys
 * on its canonical URL with case preserved, since Spotify IDs are case-sensitive
 * and the same album pasted with another ?si= or /intl-xx/ should hit.
 */
export function chainCacheKey(q: Pick<LookupQuery, 'term' | 'hint' | 'typedTitle'>): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const term = parseSpotifyLink(q.term)?.url ?? norm(q.term);
  return JSON.stringify([term, norm(q.hint), norm(q.typedTitle)]);
}

const TIMED_OUT = Symbol('timeout');

// Runs one source; any throw, null or timeout becomes null (logged). Never throws.
async function runSource(id: SourceId, q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> {
  const entry = SOURCES[id];
  if (!entry) {
    logLine(d, `${id}: skipped (not registered)`);
    return null;
  }
  if (!keysPresent(id, entry, d.env)) {
    logLine(d, `${id}: skipped (no key)`);
    return null;
  }
  const limit = d.sourceTimeoutMs ?? CHAIN_SOURCE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      entry.search(q, d),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), limit);
      }),
    ]);
    if (result === TIMED_OUT) {
      logLine(d, `${id}: timeout after ${limit} ms`);
      return null;
    }
    logLine(d, result ? `${id}: found "${result.title}"` : `${id}: no match`);
    return result;
  } catch (err) {
    logLine(d, `${id}: threw ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runChain(category: Category, q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> {
  const link = parseSpotifyLink(q.term);
  if (link) {
    // As in the script, a Spotify link goes to Spotify only; no text search on a URL.
    logLine(d, `spotify ${link.kind} link`);
    return runSource('spotify', { ...q, term: link.url }, d);
  }
  for (const id of CHAINS[category]) {
    const term = category === 'books' && id === 'openlibrary' ? q.typedTitle || q.term : q.term;
    const result = await runSource(id, { ...q, term }, d);
    if (result) return result;
  }
  return null;
}

/**
 * Looks `q` up through the category's chain, with a 30-day cache in
 * lookup_cache (source 'chain:<category>'). Misses are not cached, so Retry
 * can succeed later. Never throws.
 */
export async function lookupChain(category: Category, q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> {
  const query: LookupQuery = { ...q, category };
  const source = `chain:${category}`;
  const key = chainCacheKey(query);
  const cached = await getCached<LookupInfo>(d.env.DB, source, key);
  if (cached) {
    logLine(d, `cache hit (${source})`);
    return cached;
  }
  let result: LookupInfo | null = null;
  try {
    result = await runChain(category, query, d);
  } catch (err) {
    // runSource already contains source errors; this guards the chain itself.
    logLine(d, `chain failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  }
  if (result) await putCached(d.env.DB, source, key, result);
  return result;
}
