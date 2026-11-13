// IGDB game lookup (port of igdbToken_, igdbFetch_ and igdb_ from the script), plus details by game id.
// Needs IGDB_ID and IGDB_SECRET (a Twitch developer app); the chain skips this source without them.
// Every api.igdb.com request is paced at 250 ms (4 per second); the Twitch token request is not.
// Worst case per lookup or details call: 4 requests (token, API 401, token refresh, API retry); typically 1.
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { getCached, putCached } from '../cache';
import { assertAnswered, fetchJson, logLine, paced } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_URL = 'https://api.igdb.com/v4/games';
const PACE_MS = 250;
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const POPULARITY_WEIGHT = 0.15;
const DLC_PENALTY = 0.1;
const CHOICES_WINDOW = 0.12;
const MAX_CHOICES = 8;
const MAX_PLATFORMS = 4;
const SOURCE_ID_RE = /^\d{1,12}$/;
const TOKEN_MARGIN_SEC = 3600; // the script refreshes an hour before the token really expires

/** lookup_cache row holding the Twitch token: source 'igdb', key '__token', value {token, exp (ms)}. */
export const TOKEN_SOURCE = 'igdb';
export const TOKEN_KEY = '__token';

export interface Game {
  id: number;
  name: string;
  first_release_date?: number | null;
  cover?: { image_id?: string | null } | null;
  genres?: { name?: string | null }[] | null;
  involved_companies?: { developer?: boolean | null; company?: { name?: string | null } | null }[] | null;
  platforms?: { abbreviation?: string | null }[] | null;
  summary?: string | null;
  total_rating_count?: number | null;
  version_parent?: number | null;
  parent_game?: number | null;
}

export interface Scored {
  g: Game;
  y: string;
  score: number;
}

function releaseDateObj(sec: number | null | undefined): Date | null {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec === 0) return null;
  const date = new Date(sec * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The UTC year of a Unix `first_release_date` ('2017'); '' when missing. */
export function unixYear(sec: number | null | undefined): string {
  const date = releaseDateObj(sec);
  return date ? String(date.getUTCFullYear()) : '';
}

/** The UTC date of a Unix `first_release_date` as 'YYYY-MM-DD'; '' when missing. */
export function unixDate(sec: number | null | undefined): string {
  const date = releaseDateObj(sec);
  return date ? date.toISOString().slice(0, 10) : '';
}

/** Up to 4 platform abbreviations joined with `sep` ('/' in sub, ', ' in details). */
export function platformsOf(g: Pick<Game, 'platforms'>, sep: string): string {
  return (g.platforms || [])
    .map((p) => p?.abbreviation)
    .filter((a): a is string => !!a)
    .slice(0, MAX_PLATFORMS)
    .join(sep);
}

/** The search text with the characters that could end the quoted string or start a statement removed: " \ ; */
export function searchText(name: string): string {
  return name.replace(/["\\;]/g, '').trim();
}

/** The Apicalypse body for a text search (the script's field list plus `summary`). */
export function searchBody(name: string): string {
  return `search "${searchText(name)}"; fields name,first_release_date,cover.image_id,genres.name,`
    + 'involved_companies.company.name,involved_companies.developer,platforms.abbreviation,summary,total_rating_count,version_parent,parent_game; limit 25;';
}

/** Drops version_parent copies, then scores: similarity + 0.2 typed year + 0.15 popularity rank - 0.1 for DLC; best first. */
export function rankGames(all: Game[], typedTitle: string): Scored[] {
  const { name, year } = splitYear(typedTitle);
  const games = all.filter((g) => g && !g.version_parent); // skip "GOTY edition" style copies
  const target = normTitle(name);
  const byPop = games.map((g) => g.total_rating_count || 0).sort((a, b) => b - a);
  return games
    .map((g): Scored => {
      const y = unixYear(g.first_release_date);
      let score = similarity(target, normTitle(g.name || ''))
        + (year && y === year ? YEAR_BONUS : 0)
        + POPULARITY_WEIGHT * (1 - byPop.indexOf(g.total_rating_count || 0) / games.length); // well-known games first
      if (g.parent_game) score -= DLC_PENALTY; // DLC and expansions below the main game
      return { g, y, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** The best match (null under 0.45) plus anything within 0.12 of it, at most 8. */
export function pickGames(scored: Scored[]): Scored[] | null {
  const top = scored[0];
  if (!top || top.score < ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

export function toInfo(g: Game, y: string): LookupInfo {
  const dev = (g.involved_companies || [])
    .filter((x) => x?.developer)
    .map((x) => x.company?.name)
    .filter((n): n is string => !!n)
    .slice(0, 3)
    .join(', ');
  return {
    title: g.name,
    trusted: false,
    creator: dev,
    genres: (g.genres || []).map((x) => x?.name).filter((n): n is string => !!n).slice(0, 4).join(', '),
    cover: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : '',
    sub: [y, platformsOf(g, '/'), dev].filter(Boolean).join(' · '),
    source: 'igdb',
    sourceId: String(g.id),
  };
}

// ---- token and request (igdbToken_, igdbFetch_) -----------------------------

interface StoredToken {
  token?: unknown;
  exp?: unknown;
}

/**
 * A Twitch app token: the stored one while it is valid (its own expiry check, on
 * top of the cache's 30-day limit), else a new one, stored under igdb/__token.
 * '' when the token request fails. The token is never logged.
 */
export async function igdbToken(d: LookupDeps, forceNew: boolean): Promise<string> {
  if (!forceNew) {
    const stored = await getCached<StoredToken>(d.env.DB, TOKEN_SOURCE, TOKEN_KEY);
    if (stored && typeof stored.token === 'string' && stored.token && typeof stored.exp === 'number' && Date.now() < stored.exp) return stored.token;
  }
  if (!d.env.IGDB_ID || !d.env.IGDB_SECRET) return ''; // no keys: nothing to ask Twitch for
  const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(d.env.IGDB_ID ?? '')}&client_secret=${encodeURIComponent(d.env.IGDB_SECRET ?? '')}`;
  const res = await fetchJson<{ access_token?: unknown; expires_in?: unknown }>(url, { method: 'POST' }, d);
  const token = res.body?.access_token;
  if (res.status !== 200 || typeof token !== 'string' || !token) {
    logLine(d, `igdb: token request failed with status ${res.status}`);
    return '';
  }
  const expiresIn = res.body?.expires_in;
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn)) {
    await putCached(d.env.DB, TOKEN_SOURCE, TOKEN_KEY, { token, exp: Date.now() + (expiresIn - TOKEN_MARGIN_SEC) * 1000 });
  }
  return token;
}

/** POST an Apicalypse body to /v4/games; a 401 refreshes the token once and retries once. */
async function igdbFetch(body: string, d: LookupDeps): Promise<{ status: number; body: unknown }> {
  const send = (token: string) =>
    paced('igdb', PACE_MS, () =>
      fetchJson<unknown>(API_URL, {
        method: 'POST',
        headers: { 'Client-ID': d.env.IGDB_ID ?? '', Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
        body,
      }, d));
  const first = await igdbToken(d, false);
  if (!first) return { status: 0, body: null };
  let res = await send(first);
  if (res.status === 401) {
    const fresh = await igdbToken(d, true); // the token expired early
    if (fresh) res = await send(fresh);
  }
  return res;
}

// ---- search -----------------------------------------------------------------

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const name = splitYear(q.typedTitle || q.term).name;
  if (!searchText(name)) return null;
  const res = await igdbFetch(searchBody(name), d);
  if (res.status !== 200) {
    logLine(d, `igdb: search failed with status ${res.status}`);
    return null;
  }
  const games = (Array.isArray(res.body) ? (res.body as Game[]) : []).filter((g) => g && typeof g.id === 'number' && typeof g.name === 'string');
  const picks = pickGames(rankGames(games, q.typedTitle || q.term));
  if (!picks) {
    logLine(d, games.length ? 'igdb: best match under the accept score' : 'igdb: no results');
    return null;
  }
  const infos = picks.map((c) => toInfo(c.g, c.y));
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
};

// ---- details ----------------------------------------------------------------

export function formatDetails(g: Game): Details {
  return {
    releaseDate: unixDate(g.first_release_date),
    synopsis: g.summary ? trimSynopsis(g.summary, 600) : '',
    lengthLabel: '',
    origin: platformsOf(g, ', '),
  };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!SOURCE_ID_RE.test(sourceId)) return null;
  const res = await igdbFetch(`fields summary,first_release_date,platforms.abbreviation; where id = ${sourceId};`, d);
  assertAnswered(res.status, 'igdb details');
  const g = res.status === 200 && Array.isArray(res.body) ? (res.body[0] as Game | undefined) : undefined;
  return g ? formatDetails(g) : null;
};
