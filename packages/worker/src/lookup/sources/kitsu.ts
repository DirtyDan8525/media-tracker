// Kitsu anime lookup: the server's backup behind AniList (the device searches AniList directly;
// this runs when that finds nothing or fails), plus /anime/{id} details. Free, no key. Worst case
// per lookup: 1 request. (Kitsu is also the spelling oracle inside the shared AniList search.)
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { assertAnswered, fetchJson, logLine } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://kitsu.io/api/edge/anime';
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const MAX_GENRES = 5;
const JSON_API = { Accept: 'application/vnd.api+json' };

interface KitsuAttrs {
  titles?: { en?: string | null; en_jp?: string | null } | null;
  canonicalTitle?: string | null;
  abbreviatedTitles?: string[] | null;
  startDate?: string | null;
  synopsis?: string | null;
  subtype?: string | null;
  episodeCount?: number | null;
  episodeLength?: number | null;
  posterImage?: { large?: string | null; original?: string | null } | null;
}

export interface KitsuAnime {
  id: string;
  attributes?: KitsuAttrs | null;
  relationships?: { categories?: { data?: { id: string }[] | null } | null } | null;
}

interface KitsuReply {
  data?: KitsuAnime[];
  included?: { id: string; type?: string; attributes?: { title?: string | null } | null }[];
}

const titleOf = (a: KitsuAttrs | null | undefined): string => a?.titles?.en || a?.canonicalTitle || a?.titles?.en_jp || '';
const yearOf = (a: KitsuAttrs | null | undefined): string => (a?.startDate || '').slice(0, 4);

/** The best hit by title similarity (any title, English, canonical, Japanese romaji or abbreviation) plus 0.2 for the typed year; null under 0.45. */
export function pickBest(list: KitsuAnime[], term: string): KitsuAnime | null {
  const { name, year } = splitYear(term);
  const target = normTitle(name);
  let best: KitsuAnime | null = null;
  let bestScore = -1;
  for (const a of list) {
    const at = a.attributes;
    const names = [at?.titles?.en, at?.canonicalTitle, at?.titles?.en_jp, ...(at?.abbreviatedTitles || [])].filter((n): n is string => !!n);
    const sim = Math.max(0, ...names.map((n) => similarity(target, normTitle(n))));
    const score = sim + (year && yearOf(at) === year ? YEAR_BONUS : 0);
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best && bestScore >= ACCEPT_SCORE ? best : null;
}

export function toInfo(a: KitsuAnime, included: KitsuReply['included'] = []): LookupInfo {
  const titles = new Map(included.filter((i) => i.type === 'categories').map((i) => [i.id, i.attributes?.title || '']));
  const genres = (a.relationships?.categories?.data || []).map((c) => titles.get(c.id) || '').filter(Boolean).slice(0, MAX_GENRES);
  const img = a.attributes?.posterImage;
  return {
    title: titleOf(a.attributes),
    trusted: true,
    cover: img?.large || img?.original || '',
    genres: genres.join(', '),
    creator: '',
    source: 'kitsu',
    sourceId: a.id,
  };
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const { name } = splitYear(q.term);
  const url = `${BASE}?filter[text]=${encodeURIComponent(name)}&page[limit]=10&include=categories`;
  const { status, body } = await fetchJson<KitsuReply>(url, { headers: JSON_API }, d);
  if (status !== 200) return null;
  const best = pickBest(body?.data || [], q.term);
  if (!best) {
    logLine(d, 'kitsu: no hit scored well enough');
    return null;
  }
  return toInfo(best, body?.included);
};

// ---- details ----------------------------------------------------------------

const SUBTYPE_LABEL: Record<string, string> = {
  tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', music: 'Music',
};

export function formatDetails(a: KitsuAttrs): Details {
  const start = a.startDate || '';
  const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : /^\d{4}/.test(start) ? start.slice(0, 4) : '';
  const lengthLabel = [a.episodeCount ? `${a.episodeCount} ep` : '', a.episodeLength ? `${a.episodeLength} min` : ''].filter(Boolean).join(' · ');
  const subtype = a.subtype ? SUBTYPE_LABEL[a.subtype.toLowerCase()] ?? a.subtype : '';
  const origin = [subtype, yearOf(a)].filter(Boolean).join(' · ');
  return { releaseDate, synopsis: a.synopsis ? trimSynopsis(a.synopsis, 600) : '', lengthLabel, origin };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!/^\d{1,9}$/.test(sourceId)) return null;
  const { status, body } = await fetchJson<{ data?: KitsuAnime }>(`${BASE}/${sourceId}`, { headers: JSON_API }, d);
  assertAnswered(status, 'kitsu details');
  const a = body?.data?.attributes;
  return a ? formatDetails(a) : null;
};
