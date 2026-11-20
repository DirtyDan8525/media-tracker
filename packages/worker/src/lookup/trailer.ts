// Trailers (GET /api/trailer): movies and TV shows from TMDB (needs TMDB_KEY), anime from Kitsu (`youtubeVideoId`).
// Answer is a YouTube video id or null. Cache (lookup_cache, source 'trailer'): hits 30 days, misses 1 day (expiry in the value).
// Errors and a missing key are not cached.
import { getCached, putCached } from './cache';
import { fetchJson, logLine } from './http';
import { tmdbRequest } from './sources/tmdb';
import { normalize } from './spotifyLink';
import type { LookupDeps } from './sources/index';
import { pickBest, type KitsuAnime } from './sources/kitsu';

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
export const TRAILER_SOURCE = 'trailer';
const KITSU = 'https://kitsu.io/api/edge/anime';
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export type TrailerKind = 'movie' | 'tv' | 'anime';

interface TmdbVideo { key?: unknown; site?: unknown; type?: unknown; official?: unknown; iso_639_1?: unknown }
interface TmdbHit { id?: unknown; title?: unknown; original_title?: unknown; name?: unknown; original_name?: unknown }

/** Best YouTube Trailer (else Teaser): official first, then English, then the order TMDB gave. */
export function pickVideo(list: TmdbVideo[]): string | null {
  const rank = (v: TmdbVideo) => (v.official === true ? 0 : 2) + (v.iso_639_1 === 'en' ? 0 : 1);
  for (const type of ['Trailer', 'Teaser']) {
    const ok = list.filter((v) => v && v.site === 'YouTube' && v.type === type && typeof v.key === 'string' && YT_ID.test(v.key));
    if (ok.length) return [...ok].sort((a, b) => rank(a) - rank(b))[0]!.key as string;
  }
  return null;
}

async function tmdb<T>(path: string, d: LookupDeps) {
  const { url, init } = tmdbRequest(path, d.env.TMDB_KEY ?? '');
  return fetchJson<T>(url, init, d);
}

type Outcome = { answered: boolean; id: string | null };

async function fromTmdb(kind: 'movie' | 'tv', title: string, year: string, tmdbId: string | null, d: LookupDeps): Promise<Outcome> {
  let id = tmdbId;
  if (!id) {
    const yearParam = year ? (kind === 'movie' ? `&year=${year}` : `&first_air_date_year=${year}`) : '';
    const s = await tmdb<{ results?: TmdbHit[] }>(`/search/${kind}?query=${encodeURIComponent(title)}${yearParam}`, d);
    if (s.status !== 200) return { answered: false, id: null };
    const want = normalize(title);
    const hit = (s.body?.results ?? []).find((h) => [h?.title, h?.original_title, h?.name, h?.original_name].some((n) => typeof n === 'string' && normalize(n) === want));
    id = hit && (typeof hit.id === 'number' || typeof hit.id === 'string') && /^\d{1,9}$/.test(String(hit.id)) ? String(hit.id) : null;
    if (!id) return { answered: true, id: null };
  }
  const v = await tmdb<{ results?: TmdbVideo[] }>(`/${kind}/${id}/videos?include_video_language=en,null`, d);
  if (v.status !== 200) return { answered: false, id: null };
  return { answered: true, id: pickVideo(v.body?.results ?? []) };
}

const ytOf = (a: KitsuAnime | null | undefined): string | null => {
  const v = (a?.attributes as { youtubeVideoId?: unknown } | null | undefined)?.youtubeVideoId;
  return typeof v === 'string' && YT_ID.test(v) ? v : null;
};

async function fromKitsu(title: string, year: string, kitsuId: string | null, d: LookupDeps): Promise<Outcome> {
  const json = { headers: { Accept: 'application/vnd.api+json' } };
  if (kitsuId) {
    const r = await fetchJson<{ data?: KitsuAnime }>(`${KITSU}/${kitsuId}`, json, d);
    return r.status === 200 ? { answered: true, id: ytOf(r.body?.data) } : { answered: false, id: null };
  }
  const r = await fetchJson<{ data?: KitsuAnime[] }>(`${KITSU}?filter[text]=${encodeURIComponent(title)}&page[limit]=10`, json, d);
  if (r.status !== 200) return { answered: false, id: null };
  return { answered: true, id: ytOf(pickBest(r.body?.data ?? [], year ? `${title} ${year}` : title)) };
}

interface Stored { id: string | null; exp: number }

/** The YouTube video id of a trailer, or null (nothing found, no TMDB key, or the source failed). Never throws. */
export async function trailerId(kind: TrailerKind, title: string, year: string, sourceId: string | null, d: LookupDeps): Promise<string | null> {
  if (kind !== 'anime' && !d.env.TMDB_KEY) return null;
  const key = `${kind}:${normalize(title)}|${year}|${sourceId ?? ''}`;
  const cached = await getCached<Stored>(d.env.DB, TRAILER_SOURCE, key);
  if (cached && typeof cached.exp === 'number' && Date.now() < cached.exp) return typeof cached.id === 'string' ? cached.id : null;
  try {
    const r = kind === 'anime' ? await fromKitsu(title, year, sourceId, d) : await fromTmdb(kind, title, year, sourceId, d);
    if (!r.answered) { logLine(d, 'trailer: source did not answer'); return null; }
    await putCached(d.env.DB, TRAILER_SOURCE, key, { id: r.id, exp: Date.now() + (r.id ? HIT_TTL_MS : MISS_TTL_MS) } satisfies Stored);
    return r.id;
  } catch (err) {
    logLine(d, `trailer: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return null;
  }
}
