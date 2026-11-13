// TVmaze TV lookup (port of tvmaze_ from the script), plus /shows/{id} details.
// Free, no key. Every request is paced at 800 ms. Worst case per lookup: 1 request.
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { assertAnswered, fetchJson, logLine, paced } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://api.tvmaze.com';
const PACE_MS = 800;
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const API_SCORE_WEIGHT = 0.1;
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 8;

export interface Show {
  id: number;
  name: string;
  premiered?: string | null;
  genres?: string[] | null;
  image?: { original?: string | null; medium?: string | null } | null;
  network?: { name?: string | null } | null;
  webChannel?: { name?: string | null } | null;
  summary?: string | null;
  averageRuntime?: number | null;
  runtime?: number | null;
  status?: string | null;
}

export interface SearchHit {
  score?: number | null;
  show: Show;
}

export interface Scored {
  s: Show;
  y: string;
  score: number;
}

const yearOf = (s: Show) => (s.premiered || '').slice(0, 4);

/** Where a show aired: network, else web channel, else ''. */
export function originOf(s: Pick<Show, 'network' | 'webChannel'>): string {
  return s.network?.name || s.webChannel?.name || '';
}

/** '<averageRuntime> min episodes · <status>'; runtime when there is no average; status alone or '' when pieces are missing. */
export function lengthLabel(s: Pick<Show, 'averageRuntime' | 'runtime' | 'status'>): string {
  const min = [s.averageRuntime, s.runtime].find((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  return [min ? `${Math.round(min)} min episodes` : '', s.status || ''].filter(Boolean).join(' · ');
}

/** Title similarity + 0.2 for the typed year (against the premiere year) + 0.1 x TVmaze's own score, best first. */
export function rankShows(hits: SearchHit[], typedTitle: string): Scored[] {
  const { name, year } = splitYear(typedTitle);
  const target = normTitle(name);
  return hits
    .map((h): Scored => {
      const y = yearOf(h.show);
      return { s: h.show, y, score: similarity(target, normTitle(h.show.name || '')) + (year && y === year ? YEAR_BONUS : 0) + API_SCORE_WEIGHT * (h.score || 0) };
    })
    .sort((a, b) => b.score - a.score);
}

/** The best match (null under the accept score) plus anything within 0.1 of it, at most 8. */
export function pickShows(scored: Scored[]): Scored[] | null {
  const top = scored[0];
  if (!top || top.score < ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

export function toInfo(s: Show, y: string): LookupInfo {
  return {
    title: s.name,
    trusted: false,
    creator: '',
    genres: (s.genres || []).join(', '),
    cover: s.image?.original || s.image?.medium || '',
    sub: [originOf(s), y].filter(Boolean).join(' · '),
    source: 'tvmaze',
    sourceId: String(s.id),
  };
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const name = splitYear(q.term).name;
  const res = await paced('tvmaze', PACE_MS, () => fetchJson<SearchHit[]>(`${BASE}/search/shows?q=${encodeURIComponent(name)}`, {}, d));
  if (res.status !== 200) {
    logLine(d, `tvmaze: search failed with status ${res.status}`);
    return null;
  }
  const hits = (Array.isArray(res.body) ? res.body : []).filter((h) => h?.show);
  if (!hits.length) return null;

  const picks = pickShows(rankShows(hits, q.typedTitle || q.term));
  if (!picks) {
    logLine(d, 'tvmaze: best match under the accept score');
    return null;
  }
  const infos = picks.map((c) => toInfo(c.s, c.y));
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
};

// ---- details ----------------------------------------------------------------

export function formatDetails(s: Show): Details {
  return {
    releaseDate: s.premiered && /^\d{4}-\d{2}-\d{2}$/.test(s.premiered) ? s.premiered : '',
    synopsis: s.summary ? trimSynopsis(s.summary, 600) : '',
    lengthLabel: lengthLabel(s),
    origin: originOf(s),
  };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!/^\d{1,9}$/.test(sourceId)) return null;
  const r = await paced('tvmaze', PACE_MS, () => fetchJson<Show>(`${BASE}/shows/${sourceId}`, {}, d));
  assertAnswered(r.status, 'tvmaze details');
  return r.status === 200 && r.body ? formatDetails(r.body) : null;
};
