// Kitsu anime and manga lookup. Anime: the server's backup behind AniList (the device searches AniList directly;
// this runs when that finds nothing or fails), plus /anime/{id} details. Manga (q.category 'manga'):
// the series search on /manga, with source ids written 'manga:<id>' so details and links know the kind.
// Free, no key. Worst case per lookup: 1 request (manga: 2, when Kitsu rejects the author include). (Kitsu is also the spelling oracle inside the shared AniList search.)
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { assertAnswered, fetchJson, logLine } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://kitsu.io/api/edge/anime';
const MANGA_BASE = 'https://kitsu.io/api/edge/manga';
const MANGA_PREFIX = 'manga:';
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

/** The search with its outcome: `answered` is false when Kitsu did not give a real answer (so a caller must not remember "no match"). */
export async function searchKitsu(q: LookupQuery, d: LookupDeps): Promise<{ answered: boolean; info: LookupInfo | null }> {
  const { name } = splitYear(q.term);
  const url = `${BASE}?filter[text]=${encodeURIComponent(name)}&page[limit]=10&include=categories`;
  const { status, body } = await fetchJson<KitsuReply>(url, { headers: JSON_API }, d);
  if (status !== 200) return { answered: false, info: null };
  const best = pickBest(body?.data || [], q.term);
  if (!best) {
    logLine(d, 'kitsu: no hit scored well enough');
    return { answered: true, info: null };
  }
  return { answered: true, info: toInfo(best, body?.included) };
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> =>
  q.category === 'manga' ? searchManga(q, d) : (await searchKitsu(q, d)).info;

// ---- manga ------------------------------------------------------------------

interface MangaAttrs extends KitsuAttrs {
  volumeCount?: number | null;
  chapterCount?: number | null;
}

export interface KitsuManga {
  id: string;
  attributes?: MangaAttrs | null;
  relationships?: {
    categories?: { data?: { id: string }[] | null } | null;
    staff?: { data?: { id: string }[] | null } | null;
  } | null;
}

interface MangaReply {
  data?: KitsuManga[];
  included?: {
    id: string;
    type?: string;
    attributes?: { title?: string | null; name?: string | null; role?: string | null } | null;
    relationships?: { person?: { data?: { id: string } | null } | null } | null;
  }[];
}

// Novels and light novels are not manga series; a one-shot is a single chapter, not a series to rank.
const NOT_A_SERIES = new Set(['novel', 'oneshot']);
const AUTHOR_ROLE = /story|art|author|illust|original/i;
const MAX_AUTHORS = 3;

/** The best series by title: novels and one-shots only count when no other hit matches well enough. */
export function pickMangaBest(list: KitsuManga[], term: string): KitsuManga | null {
  const series = list.filter((m) => !NOT_A_SERIES.has((m.attributes?.subtype || '').toLowerCase()));
  return pickBest(series, term) ?? pickBest(list, term);
}

/** Story/art people from the included staff and people records (translators and the like are left out). */
function authorsOf(m: KitsuManga, included: MangaReply['included'] = []): string {
  const staffIds = new Set(m.relationships?.staff?.data?.map((x) => x.id));
  const people = new Map(included.filter((i) => i.type === 'people').map((i) => [i.id, i.attributes?.name || '']));
  const names: string[] = [];
  for (const i of included) {
    if (i.type !== 'mediaStaff' || (staffIds.size > 0 && !staffIds.has(i.id)) || !AUTHOR_ROLE.test(i.attributes?.role || '')) continue;
    const name = people.get(i.relationships?.person?.data?.id ?? '') || '';
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, MAX_AUTHORS).join(', ');
}

export function mangaToInfo(m: KitsuManga, included: MangaReply['included'] = []): LookupInfo {
  const info = toInfo(m, included as KitsuReply['included']);
  return { ...info, creator: authorsOf(m, included), sourceId: `${MANGA_PREFIX}${m.id}` };
}

async function searchManga(q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> {
  const { name } = splitYear(q.term);
  const url = `${MANGA_BASE}?filter[text]=${encodeURIComponent(name)}&page[limit]=10&include=categories`;
  // The author needs staff.person; if Kitsu refuses that include, search again for the series alone.
  let r = await fetchJson<MangaReply>(`${url},staff.person`, { headers: JSON_API }, d);
  if (r.status !== 200) r = await fetchJson<MangaReply>(url, { headers: JSON_API }, d);
  if (r.status !== 200) return null;
  const best = pickMangaBest(r.body?.data || [], q.term);
  if (!best) {
    logLine(d, 'kitsu manga: no hit scored well enough');
    return null;
  }
  return mangaToInfo(best, r.body?.included);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FORMAT_LABEL: Record<string, string> = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua', doujin: 'Doujin', oneshot: 'One-shot', novel: 'Novel' };

export function formatMangaDetails(a: MangaAttrs): Details {
  const base = formatDetails(a);
  const lengthLabel = a.volumeCount ? plural(a.volumeCount, 'volume') : a.chapterCount ? plural(a.chapterCount, 'chapter') : '';
  const origin = a.subtype ? FORMAT_LABEL[a.subtype.toLowerCase()] ?? a.subtype : '';
  return { releaseDate: base.releaseDate, synopsis: base.synopsis, lengthLabel, origin };
}

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
  if (sourceId.startsWith(MANGA_PREFIX)) {
    const id = sourceId.slice(MANGA_PREFIX.length);
    if (!/^\d{1,9}$/.test(id)) return null;
    const { status, body } = await fetchJson<{ data?: KitsuManga }>(`${MANGA_BASE}/${id}`, { headers: JSON_API }, d);
    assertAnswered(status, 'kitsu manga details');
    const a = body?.data?.attributes;
    return a ? formatMangaDetails(a) : null;
  }
  if (!/^\d{1,9}$/.test(sourceId)) return null;
  const { status, body } = await fetchJson<{ data?: KitsuAnime }>(`${BASE}/${sourceId}`, { headers: JSON_API }, d);
  assertAnswered(status, 'kitsu details');
  const a = body?.data?.attributes;
  return a ? formatDetails(a) : null;
};
