// Steam store game lookup (port of steam_ from the script), plus appdetails.
// Free, no key. Console-only games fall through to Wikipedia in the chain.
// Worst case per lookup: 11 requests = 1 search + up to 5 candidates x (appdetails + art check HEAD); the
// per-candidate requests run in parallel. Details: 1 request.
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { fetchJson, fetchText, logLine } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const APPDETAILS_URL = 'https://store.steampowered.com/api/appdetails';
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const ACCEPT_SCORE = 0.6; // stricter than other tabs: Steam returns loosely related games
const RANK_WEIGHT = 0.05;
const YEAR_BONUS = 0.2;
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 5;
const APP_ID_RE = /^\d{1,10}$/;

/** Names the script drops from Steam results. */
export const EXCLUDED = /soundtrack|\bost\b|\bdlc\b|demo|season pass|artbook/i;

export interface StoreItem {
  id: number;
  name: string;
}
export interface Scored {
  it: StoreItem;
  score: number;
}
export interface Candidate {
  info: LookupInfo;
  y: string;
  score: number;
}
export interface AppData {
  genres?: { description?: string | null }[] | null;
  developers?: string[] | null;
  release_date?: { date?: string | null } | null;
  short_description?: string | null;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean } | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function ymd(year: string, monthName: string, day: string): string | null {
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  const y = Number(year);
  const dd = Number(day);
  if (month < 0 || dd < 1 || dd > new Date(Date.UTC(y, month + 1, 0)).getUTCDate()) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Steam's release_date.date ("19 Apr, 2011", "Apr 19, 2011") as 'YYYY-MM-DD'; when it
 * does not parse unambiguously, its 4-digit year; '' when there is no year.
 */
export function parseSteamDate(s: string | null | undefined): string {
  const t = String(s ?? '').trim();
  const dayFirst = /^(\d{1,2}) ([A-Za-z]{3,9}),? (\d{4})$/.exec(t);
  const monthFirst = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(t);
  const full = dayFirst ? ymd(dayFirst[3]!, dayFirst[2]!, dayFirst[1]!) : monthFirst ? ymd(monthFirst[3]!, monthFirst[1]!, monthFirst[2]!) : null;
  return full ?? t.match(/\d{4}/)?.[0] ?? '';
}

/** 'Windows, Mac, Linux' for the platforms flagged true; '' for none. */
export function platformsLabel(p: AppData['platforms']): string {
  if (!p) return '';
  return ([['Windows', p.windows], ['Mac', p.mac], ['Linux', p.linux]] as const).filter(([, on]) => on).map(([n]) => n).join(', ');
}

export function artUrl(id: number | string, file: 'library_600x900.jpg' | 'header.jpg'): string {
  return `${ASSET_BASE}/${id}/${file}`;
}

/** Drops excluded names, then similarity + 0.05 x list position weight; best first. */
export function rankItems(all: StoreItem[], typedName: string): Scored[] {
  const items = all.filter((it) => it && !EXCLUDED.test(it.name));
  const target = normTitle(typedName);
  return items
    .map((it, rank): Scored => ({ it, score: similarity(target, normTitle(it.name)) + RANK_WEIGHT * (1 - rank / items.length) }))
    .sort((a, b) => b.score - a.score);
}

/** The best match (null under 0.6) plus anything within 0.1 of it, at most 5. */
export function pickItems(scored: Scored[]): Scored[] | null {
  const top = scored[0];
  if (!top || top.score < ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

/** With a typed year: +0.2 for candidates released that year, re-sorted. Without: unchanged. */
export function applyYear(cands: Candidate[], year: string): Candidate[] {
  if (!year) return cands;
  return cands.map((c) => (c.y === year ? { ...c, score: c.score + YEAR_BONUS } : c)).sort((a, b) => b.score - a.score);
}

async function candidate(c: Scored, d: LookupDeps): Promise<Candidate> {
  const id = c.it.id;
  // Portrait box art when the game has it (status only), otherwise the wide store banner.
  const artCheck = async () => {
    const r = await fetchText(artUrl(id, 'library_600x900.jpg'), { method: 'HEAD' }, d);
    return r.status === 200 ? artUrl(id, 'library_600x900.jpg') : artUrl(id, 'header.jpg');
  };
  const [cover, res] = await Promise.all([
    artCheck(),
    fetchJson<Record<string, { data?: AppData } | undefined>>(`${APPDETAILS_URL}?appids=${id}&filters=basic,genres,developers,release_date`, {}, d),
  ]);
  const data = res.status === 200 ? res.body?.[String(id)]?.data || {} : {}; // details are optional
  const dev = (data.developers || []).slice(0, 3).join(', ');
  const dateText = data.release_date?.date || '';
  const y = dateText.match(/\d{4}/)?.[0] || '';
  const info: LookupInfo = {
    title: c.it.name,
    trusted: false,
    creator: dev,
    genres: (data.genres || []).map((g) => g?.description).filter((n): n is string => !!n).slice(0, 4).join(', '),
    cover,
    sub: [y, dev].filter(Boolean).join(' · '),
    source: 'steam',
    sourceId: String(id),
  };
  return { info, y, score: c.score };
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const { name, year } = splitYear(q.typedTitle || q.term);
  const res = await fetchJson<{ items?: StoreItem[] }>(`${SEARCH_URL}?cc=us&l=en&term=${encodeURIComponent(name)}`, {}, d);
  if (res.status !== 200) {
    logLine(d, `steam: search failed with status ${res.status}`);
    return null;
  }
  const items = (Array.isArray(res.body?.items) ? res.body!.items! : []).filter((it) => it && typeof it.id === 'number' && typeof it.name === 'string');
  const picks = pickItems(rankItems(items, name));
  if (!picks) {
    logLine(d, 'steam: no usable match');
    return null;
  }
  const cands = applyYear(await Promise.all(picks.map((c) => candidate(c, d))), year);
  const infos = cands.map((c) => c.info);
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
};

// ---- details ----------------------------------------------------------------

export function formatDetails(a: AppData): Details {
  return {
    releaseDate: a.release_date?.date ? parseSteamDate(a.release_date.date) : '',
    synopsis: a.short_description ? trimSynopsis(a.short_description, 600) : '',
    lengthLabel: '',
    origin: platformsLabel(a.platforms),
  };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!APP_ID_RE.test(sourceId)) return null;
  const r = await fetchJson<Record<string, { success?: boolean; data?: AppData } | undefined>>(`${APPDETAILS_URL}?appids=${sourceId}`, {}, d);
  const entry = r.status === 200 ? r.body?.[sourceId] : undefined;
  return entry?.success !== false && entry?.data ? formatDetails(entry.data) : null;
};
