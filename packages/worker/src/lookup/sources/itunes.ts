// Apple (iTunes) search for albums and, as the fallback after Open Library,
// books (port of itunes_ and itunesInfo_ from the script), plus /lookup details.
// Free, no key, not paced (one request per lookup). Worst case per lookup: 1 request.
import type { Category, Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { fetchJson, logLine } from '../http';
import { cleanEditionGroups, trackCountLabel } from './format';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://itunes.apple.com';
const YEAR_BONUS = 0.2;
const SINGLE_PENALTY = 0.15;
const ORDER_WEIGHT = 0.02;
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 10;

export interface ItunesCfg {
  media: 'music' | 'ebook';
  entity: 'album' | 'ebook';
}

/** What each tab searches for (the script's cfg.media / cfg.entity). */
export const ITUNES_CFG: Partial<Record<Category, ItunesCfg>> = {
  albums: { media: 'music', entity: 'album' },
  books: { media: 'ebook', entity: 'ebook' },
};

export interface ItunesHit {
  collectionId?: number | null;
  trackId?: number | null;
  collectionName?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  artworkUrl100?: string | null;
  releaseDate?: string | null;
  trackCount?: number | null;
  genres?: unknown;
  primaryGenreName?: string | null;
  kind?: string | null;
  description?: string | null;
}

export interface ScoredHit {
  info: LookupInfo;
  score: number;
}

/** Albums: the collection id; ebooks: the track id. undefined when the hit has none. */
function idOf(cfg: ItunesCfg, hit: ItunesHit): string | undefined {
  const id = cfg.entity === 'album' ? hit.collectionId : hit.trackId;
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : undefined;
}

export function itunesInfo(cfg: ItunesCfg, hit: ItunesHit): LookupInfo {
  // Official name: the album name for music, otherwise the book title.
  let title = (cfg.entity === 'album' ? hit.collectionName : hit.trackName || hit.collectionName) || '';
  if (title && cfg.entity === 'album') title = cleanEditionGroups(title.replace(/\s+-\s+(EP|Single)$/i, ''));
  const listed = Array.isArray(hit.genres) ? (hit.genres as unknown[]).filter((g): g is string => typeof g === 'string' && g !== 'Books') : [];
  const genreList = Array.isArray(hit.genres) && hit.genres.length ? listed : [hit.primaryGenreName].filter((g): g is string => !!g);
  const year = (hit.releaseDate || '').slice(0, 4);
  const creator = hit.artistName || '';
  const info: LookupInfo = {
    title,
    trusted: false,
    cover: (hit.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/300x300bb.'),
    genres: genreList.join(', '),
    creator,
    sub: [creator, year, genreList[0]].filter(Boolean).join(' · '),
    source: 'itunes',
  };
  const sourceId = idOf(cfg, hit);
  if (sourceId) info.sourceId = sourceId;
  return info;
}

/**
 * Scores each hit by how well its name (and artist, when hinted) matches what
 * was typed, merges duplicate editions, +0.2 for the typed year, -0.15 for
 * singles/EPs (albums only), Apple's own order as a 0.02 tie-break. Best first.
 */
export function rankHits(cfg: ItunesCfg, hits: ItunesHit[], typedTitle: string, hint: string): ScoredHit[] {
  const { name: typedName, year } = splitYear(typedTitle);
  const target = normTitle(typedName);
  const seen = new Set<string>();
  const scored: ScoredHit[] = [];
  hits.forEach((hit, rank) => {
    const info = itunesInfo(cfg, hit);
    if (!info.title) return;
    const key = `${normTitle(info.title)}|${normTitle(info.creator)}`;
    if (seen.has(key)) return; // same album in another edition
    seen.add(key);
    const name = normTitle(info.title);
    const who = normTitle(info.creator);
    // Matches "Dark Side of the Moon" as well as "Pink Floyd Dark Side of the Moon".
    const titleSim = Math.max(similarity(target, name), similarity(target, `${who} ${name}`), similarity(target, `${name} ${who}`));
    let score = hint ? 0.7 * titleSim + 0.3 * similarity(normTitle(hint), who) : titleSim;
    if (year && (hit.releaseDate || '').startsWith(year)) score += YEAR_BONUS;
    // Lots of small singles share famous album names; rank full albums above them.
    if (cfg.entity === 'album' && (/\s-\s(Single|EP)$/i.test(hit.collectionName || '') || (hit.trackCount || 99) <= 3)) score -= SINGLE_PENALTY;
    score += ORDER_WEIGHT * (1 - rank / hits.length);
    scored.push({ info, score });
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** The best hit plus anything within 0.1 of it, at most 10 (no accept score, as in the script). */
export function pickHits(scored: ScoredHit[]): ScoredHit[] {
  const top = scored[0];
  if (!top) return [];
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const cfg = ITUNES_CFG[q.category];
  if (!cfg) return null;
  const url = `${BASE}/search?country=US&limit=50&media=${cfg.media}&entity=${cfg.entity}&term=${encodeURIComponent(splitYear(q.term).name)}`;
  const res = await fetchJson<{ results?: ItunesHit[] }>(url, {}, d);
  if (res.status !== 200) {
    logLine(d, `itunes: search failed with status ${res.status}`);
    return null;
  }
  const hits = (Array.isArray(res.body?.results) ? res.body!.results! : []).filter(Boolean);
  if (!hits.length) return null;
  const picks = pickHits(rankHits(cfg, hits, q.typedTitle || q.term, q.hint));
  if (!picks.length) return null;
  const infos = picks.map((c) => c.info);
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
};

// ---- details ----------------------------------------------------------------

/** From a /lookup result. iTunes has no label field, so origin stays empty. */
export function itunesDetails(hit: ItunesHit): Details {
  const ebook = hit.kind === 'ebook';
  const iso = /^\d{4}-\d{2}-\d{2}/.test(hit.releaseDate || '') ? hit.releaseDate!.slice(0, 10) : '';
  return {
    releaseDate: iso,
    synopsis: ebook && hit.description ? trimSynopsis(hit.description, 600) : '',
    lengthLabel: ebook ? '' : trackCountLabel(hit.trackCount),
    origin: '',
  };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!/^\d{1,15}$/.test(sourceId)) return null;
  const r = await fetchJson<{ results?: ItunesHit[] }>(`${BASE}/lookup?id=${sourceId}`, {}, d);
  const hit = r.status === 200 && Array.isArray(r.body?.results) ? r.body!.results![0] : undefined;
  return hit ? itunesDetails(hit) : null;
};
