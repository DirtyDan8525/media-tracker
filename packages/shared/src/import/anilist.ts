// Import from AniList: read a user's public anime and manga lists (GraphQL MediaListCollection, no
// login) and map them to the same ImportRow shape the Sheet import uses.
//
// Choices: the title is the English title when AniList has one, otherwise the romaji title.
// startedAt / completedAt map to started_at / finished_at only when AniList has the full day (a bare
// year or month can't be a 'YYYY-MM-DD'); the repeat count maps to rewatches.
// Runs in the browser (AniList blocks Cloudflare's IPs, so the device calls it, like the lookups).
import { fetchJsonMeta, type FetchDeps } from '../lookup/http';
import { normTitle } from '../matching';
import { REWATCHES_MAX, type AniListImportPreview, type Category, type ImportRow, type Status } from '../types';

const ENDPOINT = 'https://graphql.anilist.co';
const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;

const QUERY = `query ($user: String, $type: MediaType) {
  MediaListCollection(userName: $user, type: $type) {
    lists { entries {
      status score(format: POINT_10_DECIMAL) progress notes private repeat
      startedAt { year month day } completedAt { year month day }
      media {
        id idMal title { romaji english native } synonyms episodes chapters coverImage { large } startDate { year } genres format
        studios(isMain: true) { nodes { name } }
        staff(perPage: 1) { nodes { name { full } } }
      }
    } }
  }
}`;

export type AniListErrorCode = 'invalid_name' | 'not_found' | 'private' | 'rate_limited' | 'unreachable';

export class AniListError extends Error {
  constructor(public code: AniListErrorCode, message: string) {
    super(message);
    this.name = 'AniListError';
  }
}

type FuzzyDate = { year?: number | null; month?: number | null; day?: number | null };

/** 'YYYY-MM-DD' when AniList has year, month and day and it is a real, acceptable day; otherwise null. */
export function dayOf(d: FuzzyDate | null | undefined): string | null {
  if (!d?.year || !d.month || !d.day) return null;
  const v = `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  // A real calendar day from 1900 on, not in the far future (the entry API refuses anything else).
  const t = Date.parse(`${v}T00:00:00Z`);
  const ok = Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '1900-01-01' && t <= Date.now() + 366 * 86_400_000;
  return ok ? v : null;
}

export interface AniListEntry {
  status?: string | null;
  score?: number | null;
  progress?: number | null;
  notes?: string | null;
  private?: boolean | null;
  repeat?: number | null;
  startedAt?: FuzzyDate | null;
  completedAt?: FuzzyDate | null;
  media?: {
    id: number;
    title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
    synonyms?: (string | null)[] | null;
    episodes?: number | null;
    chapters?: number | null;
    coverImage?: { large?: string | null } | null;
    startDate?: { year?: number | null } | null;
    genres?: string[] | null;
    studios?: { nodes?: { name?: string | null }[] | null } | null;
    staff?: { nodes?: { name?: { full?: string | null } | null }[] | null } | null;
  } | null;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function aniListStatus(anilist: string | null | undefined): Status | null {
  switch (anilist) {
    case 'CURRENT': return 'Watching / In Progress';
    case 'PLANNING': return 'Plan to watch';
    case 'COMPLETED': return 'Completed';
    case 'PAUSED': return 'On Hold';
    case 'DROPPED': return 'Dropped';
    case 'REPEATING': return 'Rewatching';
    default: return null;
  }
}

/** One AniList list entry -> an import row, or null when it has no usable title. */
export function mapAniListEntry(e: AniListEntry, category: 'anime' | 'manga'): ImportRow | null {
  const m = e.media;
  if (!m) return null;
  const title = (m.title?.english?.trim() || m.title?.romaji?.trim() || '');
  if (!title) return null;
  const total = category === 'anime' ? m.episodes : m.chapters;
  const totalN = typeof total === 'number' && total > 0 ? Math.trunc(total) : null;
  let progress = typeof e.progress === 'number' && e.progress > 0 ? Math.trunc(e.progress) : null;
  if (progress !== null && totalN !== null) progress = Math.min(progress, totalN);
  const score = typeof e.score === 'number' && e.score > 0 ? Math.round(Math.min(e.score, 10) * 100) / 100 : null;
  const creator = category === 'anime'
    ? m.studios?.nodes?.[0]?.name
    : m.staff?.nodes?.[0]?.name?.full;
  const year = m.startDate?.year;
  const cover = m.coverImage?.large ?? '';
  const row: ImportRow = {
    category,
    title: clip(title, 300),
    status: aniListStatus(e.status),
    rating: score,
    genres: clip((m.genres ?? []).join(', '), 300),
    creator: clip(creator ?? '', 300),
    album: '',
    coverUrl: /^https?:\/\//.test(cover) && cover.length <= 2000 ? cover : '',
    notes: clip(e.notes ?? '', 5000),
  };
  if (progress !== null) row.progress = progress;
  if (totalN !== null) row.progressTotal = totalN;
  // AniList's lookup is anime-only (its details query is Media(type: ANIME)); manga lookups go through
  // Kitsu with its own 'manga:<id>' ids, which AniList does not know. So manga carries no source.
  if (category === 'anime') {
    row.source = 'anilist';
    row.sourceId = String(m.id);
  }
  if (typeof year === 'number' && year >= 1000 && year <= 9999) row.releaseDate = String(year);
  if (e.private) row.isPrivate = true;
  const started = dayOf(e.startedAt);
  const finished = dayOf(e.completedAt);
  if (started) row.startedAt = started;
  if (finished) row.finishedAt = finished;
  if (typeof e.repeat === 'number' && e.repeat > 0) row.rewatches = Math.min(Math.trunc(e.repeat), REWATCHES_MAX);
  return row;
}

const BUSY = 'AniList is busy. Try again in a minute.';
const UNREACHABLE = "Couldn't reach AniList. Try again in a minute.";

async function fetchList(user: string, type: 'ANIME' | 'MANGA', d: FetchDeps): Promise<AniListEntry[]> {
  const r = await fetchJsonMeta<{
    data?: { MediaListCollection?: { lists?: { entries?: AniListEntry[] | null }[] | null } | null } | null;
    errors?: { message?: string; status?: number }[];
  }>(
    ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { user, type } }),
    },
    d,
    { timeoutMs: 30_000 },
  );
  if (r.status === 429) throw new AniListError('rate_limited', BUSY);
  const err = r.body?.errors?.[0];
  if (r.status === 0 || (!err && (r.status < 200 || r.status >= 300))) throw new AniListError('unreachable', UNREACHABLE);
  if (err || r.status !== 200) {
    const msg = (err?.message ?? '').toLowerCase();
    const status = err?.status ?? r.status;
    if (status === 429) throw new AniListError('rate_limited', BUSY);
    if (msg.includes('private')) {
      throw new AniListError('private', 'This AniList list is private. Make your profile public in AniList settings, then try again.');
    }
    if (status === 404 || msg.includes('not found')) {
      throw new AniListError('not_found', `No AniList user called "${user}". Check the spelling.`);
    }
    throw new AniListError('unreachable', UNREACHABLE);
  }
  return (r.body?.data?.MediaListCollection?.lists ?? []).flatMap((l) => l?.entries ?? []);
}

/** What matching needs from a title already on the user's lists (a full Entry fits). */
export interface Existing {
  category: Category;
  title: string;
  source: string | null;
  sourceId: string | null;
  /** 'YYYY' or 'YYYY-MM-DD'; used only to rule out close names from different years. */
  releaseDate?: string | null;
}

/** 'same' = same AniList id or an equal title; 'possible' = close names only. */
export type MatchKind = 'same' | 'possible';
export interface AniListMatch<E extends Existing = Existing> {
  kind: MatchKind;
  /** Why it matched. */
  reason: 'id' | 'title' | 'close';
  /** The AniList entry, mapped to an import row. */
  row: ImportRow;
  /** The entry already on the user's list. */
  existing: E;
}

/** Rows to import (no match), the matches to ask about, and counts. */
export interface AniListLookup<E extends Existing = Existing> extends AniListImportPreview {
  matches: AniListMatch<E>[];
}

/** Every name AniList knows for the title (English, romaji, native, synonyms), normalized, without blanks or repeats. */
export function aniListNames(e: AniListEntry): string[] {
  const t = e.media?.title;
  const all = [t?.english, t?.romaji, t?.native, ...(e.media?.synonyms ?? [])];
  return [...new Set(all.map((x) => (typeof x === 'string' ? normTitle(x) : '')).filter(Boolean))];
}

const tokenSet = (s: string) => new Set(s.split(' ').filter(Boolean));
/** Jaccard similarity of the word sets: 1 = same words in any order. */
export function tokenSimilarity(a: string, b: string): number {
  const x = tokenSet(a);
  const y = tokenSet(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  x.forEach((t) => { if (y.has(t)) both++; });
  return both / (x.size + y.size - both);
}

const yearOf = (v: string | null | undefined): number | null => {
  const m = /^(\d{4})/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};

/** 0..1 closeness of two normalized names, or 0 when they are not close (one contains the other as whole words, 4+ chars, or similar word sets). */
function closeness(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && ` ${long} `.includes(` ${short} `)) return 0.9;
  const t = tokenSimilarity(a, b);
  return t >= 0.8 ? t : 0;
}

/** Finds the user's entry for an AniList entry, in the same category only. Id and equal titles beat close names. */
export function findExisting<E extends Existing>(
  row: ImportRow,
  names: readonly string[],
  year: number | null,
  existing: readonly E[],
): { kind: MatchKind; reason: AniListMatch['reason']; existing: E } | null {
  const pool = existing.filter((e) => e.category === row.category);
  if (row.sourceId) {
    const byId = pool.find((e) => e.source === 'anilist' && e.sourceId === row.sourceId);
    if (byId) return { kind: 'same', reason: 'id', existing: byId };
  }
  const nameSet = new Set(names);
  const norm = pool.map((e) => normTitle(e.title));
  const eq = pool.findIndex((_, i) => nameSet.has(norm[i]!));
  if (eq >= 0) return { kind: 'same', reason: 'title', existing: pool[eq]! };
  let best: { score: number; e: E } | null = null;
  pool.forEach((e, i) => {
    const n = norm[i]!;
    if (!n) return;
    const ey = yearOf(e.releaseDate);
    if (year !== null && ey !== null && ey !== year) return;
    for (const name of names) {
      const c = closeness(name, n);
      if (c > 0 && (!best || c > best.score)) best = { score: c, e };
    }
  });
  const hit = best as { score: number; e: E } | null;
  return hit ? { kind: 'possible', reason: 'close', existing: hit.e } : null;
}

/**
 * Reads and maps both lists. Titles with no counterpart on the user's lists are `rows`; the rest are
 * `matches` (same title, or possibly the same) for the person to decide. `skipped` counts the same-title ones.
 */
export async function lookupAniList<E extends Existing>(user: string, existing: readonly E[], deps: FetchDeps): Promise<AniListLookup<E>> {
  const name = user.trim();
  if (!NAME_RE.test(name)) throw new AniListError('invalid_name', 'AniList names are 2 to 20 letters, digits or underscores.');
  // One after the other: AniList's rate limit is tight and a second request is wasted if the first fails.
  const anime = await fetchList(name, 'ANIME', deps);
  const manga = await fetchList(name, 'MANGA', deps);

  const out: AniListLookup<E> = { user: name, rows: [], counts: { anime: 0, manga: 0 }, skipped: { anime: 0, manga: 0 }, matches: [] };
  for (const [category, entries] of [['anime', anime], ['manga', manga]] as const) {
    const seen = new Set<string>();
    for (const e of entries) {
      const row = mapAniListEntry(e, category);
      if (!row) continue;
      const titleKey = `${category}:${normTitle(row.title)}`;
      const idKey = row.sourceId ? `${category}:${row.sourceId}` : null;
      // Also guards a title that AniList lists twice (e.g. in two custom lists).
      if (seen.has(titleKey) || (idKey && seen.has(idKey))) continue;
      seen.add(titleKey);
      if (idKey) seen.add(idKey);
      const y = e.media?.startDate?.year;
      const hit = findExisting(row, aniListNames(e), typeof y === 'number' ? y : null, existing);
      if (hit) {
        out.matches.push({ ...hit, row });
        if (hit.kind === 'same') out.skipped[category]++;
        continue;
      }
      out.rows.push(row);
      out.counts[category]++;
    }
  }
  return out;
}
