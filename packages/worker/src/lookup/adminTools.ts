/**
 * Admin lookup tools (Phase 6c, AD8). "Check sources" runs one fixed search per source, and
 * "Why didn't it find this?" runs the real chain for a title with a trace of every step.
 * Neither touches the lookup cache's contents (explain only reads it, to say a cached answer exists).
 */
import type { Category, SourceId } from '@media-tracker/shared';
import { getCached } from './cache';
import { CHAINS, chainCacheKey, runChain } from './chain';
import { envSecrets, redactSecrets } from './http';
import { SOURCES, keysPresent, type LookupDeps, type LookupQuery, type TraceStep } from './sources/index';

export interface SourceCheck {
  source: SourceId;
  /** What a person would call it (a source with two checks gets two rows). */
  label: string;
  /** The fixed query that was run. */
  query: string;
  /** true: answered with a match. false: failed, timed out or found nothing (see `error`). null: not set up (no key). */
  ok: boolean | null;
  /** How long the source took (0 when it was skipped). The screen shows "slow" from this. */
  ms: number;
  error?: string;
}

/** One well-known title per source, so "no result" means the source is broken, not that the title is missing. */
export const SOURCE_CHECKS: { source: SourceId; label: string; category: Category; term: string }[] = [
  { source: 'anilist', label: 'AniList (anime)', category: 'anime', term: 'Cowboy Bebop' },
  { source: 'kitsu', label: 'Kitsu (anime)', category: 'anime', term: 'Cowboy Bebop' },
  { source: 'kitsu', label: 'Kitsu (manga)', category: 'manga', term: 'Berserk' },
  { source: 'tmdb', label: 'TMDB (movies)', category: 'movies', term: 'Inception' },
  { source: 'tvmaze', label: 'TVmaze (TV)', category: 'tv', term: 'Breaking Bad' },
  { source: 'wiki', label: 'Wikipedia (movies)', category: 'movies', term: 'Inception' },
  { source: 'deezer', label: 'Deezer (albums)', category: 'albums', term: 'Abbey Road' },
  { source: 'itunes', label: 'iTunes (albums)', category: 'albums', term: 'Abbey Road' },
  { source: 'igdb', label: 'IGDB (games)', category: 'games', term: 'Portal 2' },
  { source: 'steam', label: 'Steam (games)', category: 'games', term: 'Portal 2' },
  { source: 'openlibrary', label: 'Open Library (books)', category: 'books', term: 'Dune' },
  // A pasted link goes to oEmbed, which needs no key.
  { source: 'youtube', label: 'YouTube (oEmbed)', category: 'youtube', term: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
];

export const CHECK_TIMEOUT_MS = 10_000;

const message = (err: unknown, secrets: string[]) => redactSecrets(String(err instanceof Error ? err.message : err), secrets).slice(0, 200);

/** Runs every check at once (about a dozen requests). Never throws; each row says what happened. */
export async function checkSources(d: LookupDeps, timeoutMs = CHECK_TIMEOUT_MS): Promise<SourceCheck[]> {
  const secrets = envSecrets(d.env);
  return Promise.all(
    SOURCE_CHECKS.map(async ({ source, label, category, term }): Promise<SourceCheck> => {
      const base = { source, label, query: term };
      const entry = SOURCES[source];
      if (!entry) return { ...base, ok: null, ms: 0, error: 'not set up' };
      if (!keysPresent(source, entry, d.env)) return { ...base, ok: null, ms: 0, error: 'not set up' };
      const q: LookupQuery = { term, typedTitle: term, hint: '', category };
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          entry.search(q, { ...d, log: undefined, trace: undefined }),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
          }),
        ]);
        const ms = Date.now() - started;
        if (result === 'timeout') return { ...base, ok: false, ms, error: `no answer after ${timeoutMs} ms` };
        return result ? { ...base, ok: true, ms } : { ...base, ok: false, ms, error: 'answered, but found nothing' };
      } catch (err) {
        return { ...base, ok: false, ms: Date.now() - started, error: message(err, secrets) };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

export interface Explanation {
  category: Category;
  title: string;
  /** What the chain tried, in order, stopping at the first match. */
  steps: TraceStep[];
  /** The title the chain chose, or null when nothing matched. */
  found: string | null;
  /** The title a normal lookup would return from the 30-day cache instead (the chain is not consulted then), if any. */
  cached: string | null;
}

/** Runs the real chain for `title` with a trace. Skips the cache (it only reports a cached answer); writes nothing. 1 query + the sources. */
export async function explainLookup(category: Category, title: string, d: LookupDeps): Promise<Explanation> {
  const q: LookupQuery = { term: title, typedTitle: title, hint: '', category };
  const secrets = envSecrets(d.env);
  const cached = await getCached<{ title?: string }>(d.env.DB, `chain:${category}`, chainCacheKey(q));
  const trace: TraceStep[] = [];
  let found: string | null = null;
  try {
    found = (await runChain(category, q, { ...d, log: undefined, trace }))?.title ?? null;
  } catch (err) {
    trace.push({ source: CHAINS[category][0]!, query: title, results: 0, reason: `failed: ${message(err, secrets)}` });
  }
  const steps = trace.map((s) => ({ ...s, ...(s.reason ? { reason: redactSecrets(s.reason, secrets) } : {}) }));
  return { category, title, steps, found, cached: cached?.title ?? null };
}
