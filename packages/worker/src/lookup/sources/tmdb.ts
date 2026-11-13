// TMDB movie lookup (port of tmdbFetch_ and tmdbMovie_ from the script), plus the
// /movie/{id} details. Needs a TMDB key: the long "Read Access Token" goes in an
// Authorization header, the short "API Key" in the URL. Either way the key only
// ever lives in the outgoing request: URLs are scrubbed by the http helpers' log
// redaction, and nothing here puts it into a returned value.
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { assertAnswered, fetchJson, logLine, markDegraded } from '../http';
import { formatMinutes } from './format';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const BEARER_MIN_LENGTH = 41; // longer than 40 characters = the Read Access Token
const MAX_RESULTS = 20;
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const POP_WEIGHT = 0.12;
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 6;

export interface Movie {
  id: number;
  title?: string | null;
  original_title?: string | null;
  release_date?: string | null;
  popularity?: number | null;
  poster_path?: string | null;
}

export interface Scored {
  m: Movie;
  y: string;
  score: number;
}

export interface MovieDetails {
  genres?: { name: string }[] | null;
  credits?: { crew?: { job?: string | null; name?: string | null }[] | null } | null;
  release_date?: string | null;
  overview?: string | null;
  runtime?: number | null;
  production_companies?: { name: string }[] | null;
}

/** The URL and init for a TMDB call (tmdbFetch_): Bearer header for a key over 40 characters, else the api_key param. */
export function tmdbRequest(path: string, key: string): { url: string; init: RequestInit } {
  const bearer = key.length >= BEARER_MIN_LENGTH;
  const url = BASE + path + (bearer ? '' : `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${key}`;
  return { url, init: { headers } };
}

function get<T>(path: string, d: LookupDeps) {
  const { url, init } = tmdbRequest(path, d.env.TMDB_KEY ?? '');
  return fetchJson<T>(url, init, d);
}

const yearOf = (m: Movie) => (m.release_date || '').slice(0, 4);

/** Title similarity (title or original title) + up to 0.12 for popularity rank + 0.2 for the typed year, best first. */
export function rankMovies(results: Movie[], typedTitle: string): Scored[] {
  const { name, year } = splitYear(typedTitle);
  const target = normTitle(name);
  const byPop = results.map((m) => m.popularity || 0).sort((a, b) => b - a);
  return results
    .map((m): Scored => {
      const y = yearOf(m);
      const sim = Math.max(similarity(target, normTitle(m.title || '')), similarity(target, normTitle(m.original_title || '')));
      const popRank = byPop.indexOf(m.popularity || 0) / results.length;
      return { m, y, score: sim + (year && y === year ? YEAR_BONUS : 0) + POP_WEIGHT * (1 - popRank) };
    })
    .sort((a, b) => b.score - a.score);
}

/** The best match (null under the accept score) plus anything within 0.1 of it, at most 6. */
export function pickMovies(scored: Scored[]): Scored[] | null {
  const top = scored[0];
  if (!top || top.score < ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

export function directorOf(credits: MovieDetails['credits']): string {
  return (credits?.crew || [])
    .filter((p) => p.job === 'Director' && p.name)
    .map((p) => p.name)
    .join(', ');
}

export function toInfo(m: Movie, genres: string, director: string): LookupInfo {
  return {
    title: m.title || '',
    trusted: false,
    cover: m.poster_path ? IMAGE_BASE + m.poster_path : '',
    genres,
    creator: director,
    sub: [yearOf(m), director].filter(Boolean).join(' · '),
    source: 'tmdb',
    sourceId: String(m.id),
  };
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const name = splitYear(q.term).name;
  const res = await get<{ results?: Movie[] }>(`/search/movie?include_adult=false&query=${encodeURIComponent(name)}`, d);
  if (res.status !== 200) {
    logLine(d, `tmdb: search failed with status ${res.status}`);
    return null;
  }
  const results = (res.body?.results || []).slice(0, MAX_RESULTS);
  if (!results.length) return null;

  const picks = pickMovies(rankMovies(results, q.typedTitle || q.term));
  if (!picks) {
    logLine(d, 'tmdb: best match under the accept score');
    return null;
  }
  let degraded = false;
  const infos = await Promise.all(picks.map(async (c) => {
    // Genres and director are optional extras: a failed call keeps the movie (but the result is not cached).
    const r = await get<MovieDetails>(`/movie/${c.m.id}?append_to_response=credits`, d);
    const body = r.status === 200 ? r.body : null;
    if (!body) degraded = true;
    return toInfo(c.m, (body?.genres || []).map((g) => g.name).join(', '), directorOf(body?.credits));
  }));
  const top = infos[0]!;
  const out = infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
  return degraded ? markDegraded(out) : out;
};

// ---- details ----------------------------------------------------------------

export function formatDetails(m: MovieDetails): Details {
  return {
    releaseDate: m.release_date && /^\d{4}-\d{2}-\d{2}$/.test(m.release_date) ? m.release_date : '',
    synopsis: m.overview ? trimSynopsis(m.overview, 600) : '',
    lengthLabel: formatMinutes(m.runtime),
    origin: (m.production_companies || []).slice(0, 2).map((c) => c.name).filter(Boolean).join(', '),
  };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!/^\d{1,9}$/.test(sourceId)) return null;
  const r = await get<MovieDetails>(`/movie/${sourceId}`, d);
  assertAnswered(r.status, 'tmdb details');
  return r.status === 200 && r.body ? formatDetails(r.body) : null;
};
