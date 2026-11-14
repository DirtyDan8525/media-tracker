// AniList anime lookup (port of anime_ and friends from the script), shared by the browser and
// the Worker: AniList blocks Cloudflare's IPs, so the device calls it directly and the Worker
// adapter is a thin wrapper over this. Tolerates typos and loose titles: candidate lists for
// the full title and shorter versions of it are scored by title similarity, and Kitsu's
// typo-tolerant search supplies the official title when nothing scores well.
import { normTitle, similarity, splitYear, trimSynopsis } from '../matching';
import type { Details, LookupInfo } from '../types';
import { SourceFailure, answeredStatus, fetchJsonMeta, logLine, paced, sleep, type FetchDeps } from './http';
import { kitsuTitle } from './kitsu';

const ENDPOINT = 'https://graphql.anilist.co';
const PACE_MS = 700;
const GOOD_SCORE = 0.85; // stop querying once something scores this well
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const NEAR_TIE = 0.15;
const MAX_CHOICES = 12;
const MAX_QUERIES = 7;
const DEFAULT_RETRY_WAIT_S = 2;
const MAX_RETRY_WAIT_S = 20; // longer than this: fail over instead of waiting

const ANIME_FIELDS =
  'id format episodes seasonYear startDate { year } title { romaji english } synonyms popularity coverImage { extraLarge large } genres '
  + 'studios(isMain: true) { nodes { name } }';

/** The AniList Media fields this adapter reads. */
export interface Media {
  id: number;
  format?: string | null;
  episodes?: number | null;
  duration?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  title?: { romaji?: string | null; english?: string | null } | null;
  synonyms?: string[] | null;
  popularity?: number | null;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
  genres?: string[] | null;
  studios?: { nodes?: { name: string }[] | null } | null;
  description?: string | null;
}

export interface Candidate {
  media: Media;
  score: number;
}

/** Full title first, then the normalised base, its first two words, and each word alone (max 7). */
export function queryVariants(term: string): string[] {
  const name = splitYear(term).name;
  // "Jojo's" -> "Jojo": AniList matches the base word, not the possessive.
  const base = normTitle(name.replace(/['’]s\b/gi, ''));
  const words = base.split(' ').filter((w) => w.length >= 3);
  const seen = new Set<string>();
  return [name, base, words.slice(0, 2).join(' '), ...words]
    .filter((q) => q && q.length >= 2 && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()))
    .slice(0, MAX_QUERIES);
}

const yearOf = (m: Media): number => m.seasonYear || m.startDate?.year || 0;

const FORMAT_SUB: Record<string, string> = {
  TV: 'TV series', TV_SHORT: 'TV short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Music video',
};

/** The picker's sub line: "TV series · 2023 · 28 ep". */
export function describe(m: Media): string {
  const fmt = (m.format && FORMAT_SUB[m.format]) || m.format || '';
  return [fmt, yearOf(m) || '', m.episodes ? `${m.episodes} ep` : ''].filter(Boolean).join(' · ');
}

/** Score = closest title match (romaji, English or any synonym), a small nudge for popularity, and a bonus for the typed year. */
export function scoreInto(pool: Map<number, Candidate>, target: string, list: Media[], year = ''): void {
  const maxPop = Math.max(1, ...list.map((m) => m.popularity || 0));
  for (const m of list) {
    const names = [m.title?.romaji, m.title?.english, ...(m.synonyms || [])].filter((n): n is string => !!n);
    const sim = Math.max(0, ...names.map((n) => similarity(target, normTitle(n))));
    const bonus = year && String(yearOf(m)) === year ? YEAR_BONUS : 0;
    const score = sim + 0.05 * ((m.popularity || 0) / maxPop) + bonus;
    const prev = pool.get(m.id);
    if (!prev || score > prev.score) pool.set(m.id, { media: m, score });
  }
}

export function toInfo(m: Media): LookupInfo {
  return {
    title: m.title?.english || m.title?.romaji || '',
    trusted: true,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
    genres: (m.genres || []).join(', '),
    creator: (m.studios?.nodes || []).map((s) => s.name).join(', '),
    source: 'anilist',
    sourceId: String(m.id),
  };
}

/**
 * Best candidate (null under the accept threshold) plus choices: near-ties and every entry
 * of the same series (sequels, movies, OVAs, which AniList stores as separate entries that
 * share the first part of the title), by year, top first.
 */
export function buildResult(pool: Map<number, Candidate>): LookupInfo | null {
  const ranked = [...pool.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top || top.score < ACCEPT_SCORE) return null;

  const stems = [top.media.title?.english, top.media.title?.romaji]
    .filter((t): t is string => !!t)
    .map((t) => normTitle(t.split(':')[0]!.replace(/\([^)]*\)/g, '')));
  const sameSeries = (m: Media) =>
    [m.title?.english, m.title?.romaji]
      .filter((t): t is string => !!t)
      .some((t) => stems.some((st) => st.length >= 4 && normTitle(t).startsWith(st)));
  const choices = ranked
    .filter((c) => c === top || c.score >= top.score - NEAR_TIE || sameSeries(c.media))
    .slice(0, MAX_CHOICES);

  const info = toInfo(top.media);
  if (choices.length > 1) {
    const rest = choices.slice(1).sort((a, b) => (yearOf(a.media) || 9999) - (yearOf(b.media) || 9999));
    info.choices = [top, ...rest].map((c) => ({ ...toInfo(c.media), sub: describe(c.media) }));
  }
  return info;
}

interface GraphqlReply<T> {
  data?: T;
}

// One GraphQL POST. A 429 is retried once, after Retry-After (default 2 s); a wait over
// 20 s is not taken, so the chain's own per-source timeout is never reached by our sleeping.
// A 429 we give up on throws SourceFailure, so search stops issuing further variants and the
// details endpoint reports a failure. `answered` is false for other non-answers (network, 5xx).
async function post<T>(query: string, variables: Record<string, unknown>, d: FetchDeps): Promise<{ data: T | null; answered: boolean }> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  };
  for (let attempt = 0; ; attempt++) {
    const r = await fetchJsonMeta<GraphqlReply<T>>(ENDPOINT, init, d);
    if (r.status === 200) return { data: r.body?.data ?? null, answered: true };
    if (r.status !== 429) {
      logLine(d, `anilist: giving up after status ${r.status}`);
      return { data: null, answered: answeredStatus(r.status) };
    }
    if (attempt > 0) {
      logLine(d, 'anilist: giving up after a second 429');
      throw new SourceFailure('anilist: rate limited');
    }
    const waitS = r.retryAfterSec ?? DEFAULT_RETRY_WAIT_S;
    if (waitS > MAX_RETRY_WAIT_S) {
      logLine(d, `anilist: 429 with Retry-After ${waitS} s, not waiting`);
      throw new SourceFailure('anilist: rate limited');
    }
    logLine(d, `anilist: 429, retrying once after ${waitS} s`);
    await sleep(waitS * 1000);
  }
}

async function candidates(q: string, d: FetchDeps): Promise<Media[]> {
  const query = 'query ($s: String) { Page(perPage: 15) { media(search: $s, type: ANIME, '
    + `sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${ANIME_FIELDS} } } }`;
  const { data, answered } = await post<{ Page?: { media?: Media[] } }>(query, { s: q }, d);
  // Blocked, offline or erroring: more variants will not help, so fail now and let the caller fall back.
  if (!answered) throw new SourceFailure('anilist: request failed');
  return data?.Page?.media || [];
}

/** Searches AniList for `q.term`; null when nothing scores well. Throws SourceFailure when AniList rate-limits us. */
export async function search(q: { term: string }, d: FetchDeps): Promise<LookupInfo | null> {
  const { name, year } = splitYear(q.term);
  const norm = normTitle(name);
  const queries = queryVariants(q.term);

  const pool = new Map<number, Candidate>();
  const bestScore = () => Math.max(0, ...[...pool.values()].map((c) => c.score));
  for (const v of queries) {
    scoreInto(pool, norm, await paced('anilist', PACE_MS, () => candidates(v, d)), year);
    if (bestScore() >= GOOD_SCORE) break;
  }
  if (bestScore() < GOOD_SCORE) {
    const base = normTitle(name.replace(/['’]s\b/gi, ''));
    const official = await kitsuTitle(base, d);
    if (official) {
      // Kitsu already corrected the spelling, so score against its title.
      scoreInto(pool, normTitle(official), await paced('anilist', PACE_MS, () => candidates(official, d)), year);
    }
  }
  return buildResult(pool);
}

// ---- details ----------------------------------------------------------------

const DETAILS_QUERY = 'query ($id: Int) { Media(id: $id, type: ANIME) { id description '
  + 'startDate { year month day } episodes duration format season seasonYear } }';

const FORMAT_LABEL: Record<string, string> = {
  TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Music',
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|_)(\w)/g, (_, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase());

export function formatDetails(m: Media): Details {
  const sd = m.startDate;
  const pad = (n: number) => String(n).padStart(2, '0');
  const releaseDate = sd?.year ? (sd.month && sd.day ? `${sd.year}-${pad(sd.month)}-${pad(sd.day)}` : String(sd.year)) : '';

  const lengthLabel = [m.episodes ? `${m.episodes} ep` : '', m.duration ? `${m.duration} min` : ''].filter(Boolean).join(' · ');

  const format = m.format ? FORMAT_LABEL[m.format] ?? titleCase(m.format) : '';
  const season = [m.season ? titleCase(m.season) : '', m.seasonYear || ''].filter(Boolean).join(' ');
  const origin = [format, season].filter(Boolean).join(' · ');

  return { releaseDate, synopsis: m.description ? trimSynopsis(m.description, 600) : '', lengthLabel, origin };
}

/** The four detail fields for an AniList id; null when AniList has no such entry. Throws SourceFailure when it could not answer. */
export async function details(sourceId: string, d: FetchDeps): Promise<Details | null> {
  if (!/^\d{1,9}$/.test(sourceId)) return null;
  const { data, answered } = await paced('anilist', PACE_MS, () => post<{ Media?: Media }>(DETAILS_QUERY, { id: Number(sourceId) }, d));
  if (!answered) throw new SourceFailure('anilist: details request failed');
  return data?.Media ? formatDetails(data.Media) : null;
}
