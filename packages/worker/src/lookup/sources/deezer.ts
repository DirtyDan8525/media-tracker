// Deezer music lookup (port of deezer_ and deezerTrack_ from the script), plus
// /album/{id} and /track/{id} details. Free, no key. Albums search /search/album
// (the tab's lookup), songs search /search/track (q.category === 'songs').
// Not paced: Deezer allows 50 requests per 5 s and one lookup stays far below it.
// Worst case per lookup: albums 1 search + 6 album pages = 7 requests (the pages
// run in parallel); songs 1 + 4 = 5; details 1 (album) or 2 (track + its album).
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear } from '@media-tracker/shared';
import { fetchJson, logLine } from '../http';
import { cleanEditionGroups, formatMmSs, trackCountLabel } from './format';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://api.deezer.com';
const TRACK_ACCEPT_SCORE = 0.45; // albums have none (as in the script)
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 8;
const ALBUM_PAGES = 6; // genres and year are read for the first 6 album picks
const TRACK_PAGES = 4; // and for the first 4 track picks
const ALBUM_RANK_WEIGHT = 0.12;
const TRACK_RANK_WEIGHT = 0.15;
const SINGLE_EP_PENALTY = 0.15;
const YEAR_BONUS = 0.2;

interface Named {
  name?: string | null;
}

export interface DzAlbumHit {
  id: number;
  title: string;
  artist?: Named | null;
  record_type?: string | null;
  cover_xl?: string | null;
  cover_big?: string | null;
  cover_medium?: string | null;
}

export interface DzTrackHit {
  id: number;
  title: string;
  title_short?: string | null;
  rank?: number | null;
  artist?: Named | null;
  album?: { id?: number | null; title?: string | null; cover_xl?: string | null; cover_big?: string | null } | null;
}

export interface ScoredAlbum {
  a: DzAlbumHit;
  title: string;
  who: string;
  score: number;
}

export interface ScoredTrack {
  t: DzTrackHit;
  title: string;
  who: string;
  score: number;
}

interface AlbumPage {
  genres?: { data?: Named[] | null } | null;
  release_date?: string | null;
  label?: string | null;
  nb_tracks?: number | null;
  duration?: number | null;
  error?: unknown;
}

interface TrackPage {
  release_date?: string | null;
  duration?: number | null;
  album?: { id?: number | null } | null;
  error?: unknown;
}

/** An album title without edition groups, exactly as the script does it: "Abbey Road (Remastered)" -> "Abbey Road". */
export const cleanAlbumTitle = cleanEditionGroups;

/** A song title without remaster/version/edit/mono/stereo/live groups (verbatim from deezerTrack_). */
export function cleanTrackTitle(t: unknown): string {
  return String(t ?? '')
    .replace(/\s*[\(\[][^\)\]]*(remaster|version|edit|mono|stereo|live)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+.*remaster.*$/i, '')
    .trim();
}

// Matches "Dark Side of the Moon" as well as "Pink Floyd Dark Side of the Moon" (either order).
function titleSimilarity(target: string, name: string, who: string): number {
  return Math.max(similarity(target, name), similarity(target, `${who} ${name}`), similarity(target, `${name} ${who}`));
}

const withHint = (titleSim: number, hint: string, who: string) =>
  hint ? 0.7 * titleSim + 0.3 * similarity(normTitle(hint), who) : titleSim;

/** Albums scored by title (+ artist when hinted), singles/EPs -0.15, Deezer's order as a 0.12 tie-break; best first. */
export function scoreAlbums(results: DzAlbumHit[], typedName: string, hint: string): ScoredAlbum[] {
  const target = normTitle(typedName);
  const seen = new Set<string>();
  const scored: ScoredAlbum[] = [];
  results.forEach((a, rank) => {
    const title = cleanAlbumTitle(a.title);
    const who = a.artist?.name || '';
    const key = `${normTitle(title)}|${normTitle(who)}`;
    if (!title || seen.has(key)) return; // other editions of an album already listed
    seen.add(key);
    let score = withHint(titleSimilarity(target, normTitle(title), normTitle(who)), hint, normTitle(who));
    if (a.record_type && a.record_type !== 'album') score -= SINGLE_EP_PENALTY;
    score += ALBUM_RANK_WEIGHT * (1 - rank / results.length);
    scored.push({ a, title, who, score });
  });
  return scored.sort((x, y) => y.score - x.score);
}

/** The best album plus anything within 0.1 of it, at most 8 (no accept score: the script takes the best album it has). */
export function pickAlbums(scored: ScoredAlbum[]): ScoredAlbum[] {
  const top = scored[0];
  if (!top) return [];
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

/** Songs scored by title (+ artist when hinted) and popularity (Deezer's `rank`); best first. */
export function scoreTracks(results: DzTrackHit[], typedName: string, hint: string): ScoredTrack[] {
  const target = normTitle(typedName);
  const ranks = results.map((t) => t.rank || 0).sort((a, b) => b - a);
  const seen = new Set<string>();
  const scored: ScoredTrack[] = [];
  results.forEach((t) => {
    const title = cleanTrackTitle(t.title_short || t.title);
    const who = t.artist?.name || '';
    const key = `${normTitle(title)}|${normTitle(who)}`;
    if (!title || seen.has(key)) return; // same song on several albums: keep the first
    seen.add(key);
    let score = withHint(titleSimilarity(target, normTitle(title), normTitle(who)), hint, normTitle(who));
    score += TRACK_RANK_WEIGHT * (1 - ranks.indexOf(t.rank || 0) / results.length); // popular versions first
    scored.push({ t, title, who, score });
  });
  return scored.sort((x, y) => y.score - x.score);
}

/** The best song (null under 0.45) plus anything within 0.1 of it, at most 8. */
export function pickTracks(scored: ScoredTrack[]): ScoredTrack[] | null {
  const top = scored[0];
  if (!top || top.score < TRACK_ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

/** '<n> tracks · <minutes> min'; either half is left out when missing, '' when both are. */
export function albumLengthLabel(nbTracks: number | null | undefined, seconds: number | null | undefined): string {
  const mins = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : 0;
  return [trackCountLabel(nbTracks), mins > 0 ? `${mins} min` : ''].filter(Boolean).join(' · ');
}

/** Song length as m:ss. */
export const trackLengthLabel = formatMmSs;

export function albumInfo(c: ScoredAlbum, genres: string, rel: string): LookupInfo {
  const type = c.a.record_type && c.a.record_type !== 'album' ? c.a.record_type.toUpperCase() : '';
  return {
    title: c.title,
    trusted: false,
    creator: c.who,
    genres,
    cover: c.a.cover_xl || c.a.cover_big || c.a.cover_medium || '',
    sub: [c.who, rel, type].filter(Boolean).join(' · '),
    source: 'deezer',
    sourceId: `album:${c.a.id}`,
  };
}

export function trackInfo(c: ScoredTrack, genres: string, year: string): LookupInfo {
  const album = c.t.album?.title || '';
  return {
    title: c.title,
    trusted: false,
    creator: c.who,
    album,
    genres,
    cover: c.t.album?.cover_xl || c.t.album?.cover_big || '',
    sub: [c.who, album, year].filter(Boolean).join(' · '),
    source: 'deezer',
    sourceId: `track:${c.t.id}`,
  };
}

/** When the typed title had a year: +0.2 for albums released that year, then best first. Without a year the order is kept. */
export function reorderByYear<T extends { rel: string; score: number }>(items: T[], year: string): T[] {
  if (!year) return items;
  return items
    .map((i) => ({ i, s: i.score + (i.rel === year ? YEAR_BONUS : 0) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

const dateOf = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && s !== '0000-00-00' ? s : '');

export function albumDetails(al: Pick<AlbumPage, 'release_date' | 'label' | 'nb_tracks' | 'duration'>): Details {
  return { releaseDate: dateOf(al.release_date), synopsis: '', lengthLabel: albumLengthLabel(al.nb_tracks, al.duration), origin: al.label || '' };
}

/** `al` is the track's album page (label, and the date when the track has none); null when it wasn't read. */
export function trackDetails(t: Pick<TrackPage, 'release_date' | 'duration'>, al: Pick<AlbumPage, 'release_date' | 'label'> | null): Details {
  return {
    releaseDate: dateOf(t.release_date) || dateOf(al?.release_date),
    synopsis: '',
    lengthLabel: trackLengthLabel(t.duration),
    origin: al?.label || '',
  };
}

const genresOf = (al: AlbumPage | null) => (al?.genres?.data || []).map((g) => g.name).filter(Boolean).join(', ');
const yearOf = (al: AlbumPage | null) => (al?.release_date || '').slice(0, 4);

// An album's own page, or null on any failure (genres and year are optional).
async function albumPage(id: number | null | undefined, d: LookupDeps): Promise<AlbumPage | null> {
  if (!id) return null;
  const r = await fetchJson<AlbumPage>(`${BASE}/album/${id}`, {}, d);
  return r.status === 200 && r.body && !r.body.error ? r.body : null;
}

async function searchAlbums(q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> {
  const { name: typedName, year } = splitYear(q.typedTitle || q.term);
  const query = q.hint ? `artist:"${q.hint}" album:"${typedName}"` : splitYear(q.term).name;
  const res = await fetchJson<{ data?: DzAlbumHit[]; error?: unknown }>(`${BASE}/search/album?limit=40&q=${encodeURIComponent(query)}`, {}, d);
  if (res.status !== 200 || !res.body) {
    logLine(d, `deezer: album search failed with status ${res.status}`);
    return null;
  }
  if (res.body.error) {
    logLine(d, `deezer: album search error ${JSON.stringify(res.body.error).slice(0, 150)}`);
    return null;
  }
  const results = Array.isArray(res.body.data) ? res.body.data.filter((a) => a && a.id) : [];
  logLine(d, `deezer: album search "${query}": ${results.length} results`);
  if (!results.length) return null;

  const picks = pickAlbums(scoreAlbums(results, typedName, q.hint));
  if (!picks.length) return null;
  const pages = await Promise.all(picks.map((c, i) => (i < ALBUM_PAGES ? albumPage(c.a.id, d) : Promise.resolve(null))));
  const entries = picks.map((c, i) => {
    const rel = yearOf(pages[i]!);
    return { info: albumInfo(c, genresOf(pages[i]!), rel), rel, score: c.score };
  });
  const infos = reorderByYear(entries, year).map((e) => e.info);
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
}

async function searchTracks(q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> {
  const { name: typedName } = splitYear(q.typedTitle || q.term);
  const query = q.hint ? `artist:"${q.hint}" track:"${typedName}"` : typedName;
  const res = await fetchJson<{ data?: DzTrackHit[]; error?: unknown }>(`${BASE}/search/track?limit=40&q=${encodeURIComponent(query)}`, {}, d);
  if (res.status !== 200 || !res.body || res.body.error) {
    logLine(d, `deezer: song search failed with status ${res.status}`);
    return null;
  }
  const results = Array.isArray(res.body.data) ? res.body.data.filter((t) => t && t.id) : [];
  logLine(d, `deezer: song search "${query}": ${results.length} results`);
  if (!results.length) return null;

  const picks = pickTracks(scoreTracks(results, typedName, q.hint));
  if (!picks) {
    logLine(d, 'deezer: best song under the accept score');
    return null;
  }
  const pages = await Promise.all(picks.map((c, i) => (i < TRACK_PAGES ? albumPage(c.t.album?.id, d) : Promise.resolve(null))));
  const infos = picks.map((c, i) => trackInfo(c, genresOf(pages[i]!), yearOf(pages[i]!)));
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> =>
  q.category === 'songs' ? searchTracks(q, d) : searchAlbums(q, d);

// ---- details ----------------------------------------------------------------

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  const m = /^(album|track):(\d{1,12})$/.exec(sourceId);
  if (!m) return null;
  const id = m[2]!;
  if (m[1] === 'album') {
    const r = await fetchJson<AlbumPage>(`${BASE}/album/${id}`, {}, d);
    return r.status === 200 && r.body && !r.body.error ? albumDetails(r.body) : null;
  }
  const r = await fetchJson<TrackPage>(`${BASE}/track/${id}`, {}, d);
  if (r.status !== 200 || !r.body || r.body.error) return null;
  // The label always lives on the album page; it also supplies the date when the track has none.
  return trackDetails(r.body, await albumPage(r.body.album?.id, d));
};
