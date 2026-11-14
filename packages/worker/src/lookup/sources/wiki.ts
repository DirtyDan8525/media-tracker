// Wikipedia/Wikidata lookup for movies, TV and games (port of wikiSearch_, wiki_
// and wikidataFacts_ from the script). Searches Wikipedia for pages whose short
// description says "film" (or TV series / video game), takes the poster from the
// page, and reads director/developer and genres from Wikidata. Free, no key.
// Details come from Wikidata (P577 publication date, P2047 duration) and the
// Wikipedia article intro.
import type { Category, Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { assertAnswered, fetchJson, logLine, markDegraded } from '../http';
import { formatMinutes } from './format';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

export type WikiKind = 'film' | 'tv' | 'game';

export const WIKI_KINDS: Record<WikiKind, { suffix: string; match: RegExp }> = {
  film: { suffix: 'film', match: /\bfilm\b/i },
  game: { suffix: 'video game', match: /\bvideo game\b/i },
  tv: { suffix: 'TV series', match: /\b(television|TV|web) series\b|\bsitcom\b|\bminiseries\b/i },
};

export const WIKI_HEADERS: Record<string, string> = {
  'Api-User-Agent': 'MediaTrackerApp/1.0 (private app; contact via GitHub DirtyDan8525/media-tracker)',
};

const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php?format=json&action=wbgetentities';
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const RANK_WEIGHT = 0.02;
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 10;
const MINUTE = 'Q7727';
const HOUR = 'Q25235';

export interface WikiPage {
  pageid?: number;
  title: string;
  description?: string;
  index?: number;
  thumbnail?: { source?: string };
  pageprops?: { wikibase_item?: string };
  extract?: string;
}

export interface ScoredPage {
  pg: WikiPage;
  name: string;
  score: number;
}

export interface Claim {
  mainsnak?: { datavalue?: { value?: unknown } };
}

interface Entity {
  claims?: Record<string, Claim[]>;
  labels?: { en?: { value?: string } };
  sitelinks?: { enwiki?: { title?: string } };
}

export interface Facts {
  directors: string[];
  developers: string[];
  genres: string[];
}

export function kindFor(category: Category): WikiKind | null {
  return category === 'movies' ? 'film' : category === 'tv' ? 'tv' : category === 'games' ? 'game' : null;
}

/** Whether a search hit's short description says it is the right kind of work (and not a character, soundtrack, company…). */
export function keepPage(kind: WikiKind, pg: WikiPage): boolean {
  const desc = pg.description || '';
  return WIKI_KINDS[kind].match.test(desc) && !/character|franchise|soundtrack|episode|developer|publisher|company/i.test(desc);
}

/** Title similarity ("Speed Racer (film)" counts as "Speed Racer") + 0.2 if the typed year appears + a small bonus for the search rank, best first. */
export function rankPages(pages: WikiPage[], typedTitle: string): ScoredPage[] {
  const { name: typedName, year } = splitYear(typedTitle);
  const target = normTitle(typedName);
  const ordered = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered
    .map((pg, rank): ScoredPage => {
      const name = pg.title.replace(/\s*\([^)]*\)\s*$/, '');
      const bonus = year && `${pg.title} ${pg.description || ''}`.includes(year) ? YEAR_BONUS : 0;
      return { pg, name, score: similarity(target, normTitle(name)) + bonus + RANK_WEIGHT * (1 - rank / ordered.length) };
    })
    .sort((a, b) => b.score - a.score);
}

/** The best page (null under the accept score) plus anything within 0.1 of it, at most 10. */
export function pickPages(scored: ScoredPage[]): ScoredPage[] | null {
  const top = scored[0];
  if (!top || top.score < ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

async function wikiSearch(query: string, d: LookupDeps): Promise<WikiPage[]> {
  const url = `${WIKIPEDIA}?action=query&format=json&formatversion=2`
    + `&generator=search&gsrlimit=15&gsrsearch=${encodeURIComponent(query)}`
    + '&prop=pageimages|description|pageprops&piprop=thumbnail&pithumbsize=500&pilicense=any&ppprop=wikibase_item';
  const r = await fetchJson<{ query?: { pages?: WikiPage[] } }>(url, { headers: WIKI_HEADERS }, d);
  if (r.status !== 200) {
    logLine(d, `wiki: search "${query}" failed with status ${r.status}`);
    return [];
  }
  return r.body?.query?.pages || [];
}

const refs = (e: Entity, prop: string): string[] =>
  (e.claims?.[prop] || [])
    .map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((id): id is string => !!id);

/** Director (P57), developer (P178) and genres (P136) for a batch of Wikidata items, with readable English names. */
export async function wikidataFacts(ids: string[], d: LookupDeps, state?: { failed: boolean }): Promise<Record<string, Facts>> {
  if (!ids.length) return {};
  const get = async (query: string): Promise<Record<string, Entity> | null> => {
    const r = await fetchJson<{ entities?: Record<string, Entity> }>(`${WIKIDATA}&${query}`, { headers: WIKI_HEADERS }, d);
    if (r.status !== 200 && state) state.failed = true;
    return r.status === 200 ? r.body?.entities ?? {} : null;
  };
  const ents = await get(`props=claims&ids=${ids.join('|')}`);
  if (!ents) return {};
  const labelIds = [...new Set(ids.flatMap((id) => {
    const e = ents[id];
    return e ? [...refs(e, 'P57'), ...refs(e, 'P136'), ...refs(e, 'P178').slice(0, 3)] : [];
  }))].slice(0, 50);
  const labels = labelIds.length ? (await get(`props=labels&languages=en&ids=${labelIds.join('|')}`)) ?? {} : {};
  const name = (id: string) => labels[id]?.labels?.en?.value || '';
  const tidy = (g: string) => g.replace(/\s+(film|television series|TV series|video game)$/i, '').replace(/^./, (ch) => ch.toUpperCase());
  const out: Record<string, Facts> = {};
  for (const id of ids) {
    const e = ents[id];
    if (!e) continue;
    out[id] = {
      directors: refs(e, 'P57').map(name).filter(Boolean),
      developers: refs(e, 'P178').slice(0, 3).map(name).filter(Boolean),
      genres: [...new Set(refs(e, 'P136').map(name).filter(Boolean).map(tidy))].slice(0, 4),
    };
  }
  return out;
}

function toInfo(c: ScoredPage, kind: WikiKind, facts: Record<string, Facts>): LookupInfo {
  const qid = c.pg.pageprops?.wikibase_item;
  const f = (qid && facts[qid]) || { directors: [], developers: [], genres: [] };
  const creator = kind === 'film' ? f.directors : kind === 'game' ? f.developers : [];
  const sourceId = qid || (c.pg.pageid !== undefined ? String(c.pg.pageid) : undefined);
  return {
    title: c.name,
    trusted: false,
    cover: c.pg.thumbnail?.source || '',
    genres: f.genres.join(', '),
    creator: creator.join(', '),
    sub: c.pg.description || '',
    source: 'wiki',
    ...(sourceId ? { sourceId } : {}),
  };
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const kind = kindFor(q.category);
  if (!kind) {
    logLine(d, `wiki: no ${q.category} search`);
    return null;
  }
  const keep = (pg: WikiPage) => keepPage(kind, pg);
  let pages = (await wikiSearch(`${q.term} ${WIKI_KINDS[kind].suffix}`, d)).filter(keep);
  if (!pages.length) pages = (await wikiSearch(splitYear(q.term).name, d)).filter(keep); // retry: plain title, no year or "film" hint
  logLine(d, `wiki: kept ${pages.length} page(s) described as ${kind}`);
  if (!pages.length) return null;

  const picks = pickPages(rankPages(pages, q.typedTitle || q.term));
  if (!picks) {
    logLine(d, 'wiki: best match under the accept score');
    return null;
  }
  const state = { failed: false };
  const facts = await wikidataFacts(
    picks.map((c) => c.pg.pageprops?.wikibase_item).filter((id): id is string => !!id),
    d,
    state,
  );
  const infos = picks.map((c) => toInfo(c, kind, facts));
  const top = infos[0]!;
  const out = infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
  return state.failed ? markDegraded(out) : out;
};

// ---- details ----------------------------------------------------------------

/** 'YYYY-MM-DD' for a day-precision Wikidata time, 'YYYY' for year or month precision, '' for anything coarser or unusable. */
export function parseWikidataDate(value: unknown): string {
  const v = value as { time?: unknown; precision?: unknown } | null | undefined;
  const m = typeof v?.time === 'string' ? /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(v.time) : null;
  const precision = typeof v?.precision === 'number' ? v.precision : 0;
  if (!m || precision < 9) return '';
  const [, y, mo, da] = m;
  return precision >= 11 && mo !== '00' && da !== '00' ? `${y}-${mo}-${da}` : y!;
}

/** The earliest usable publication date (P577) among the claims. */
export function earliestDate(claims: Claim[] | undefined): string {
  const dates = (claims || []).map((c) => parseWikidataDate(c.mainsnak?.datavalue?.value)).filter(Boolean).sort();
  return dates[0] ?? '';
}

/** The first duration claim (P2047) in minutes or hours, as whole minutes; other units are not converted. */
export function parseWikidataMinutes(claims: Claim[] | undefined): number | null {
  for (const c of claims || []) {
    const v = c.mainsnak?.datavalue?.value as { amount?: unknown; unit?: unknown } | undefined;
    const unit = typeof v?.unit === 'string' ? v.unit.split('/').pop() : '';
    const factor = unit === MINUTE ? 1 : unit === HOUR ? 60 : 0;
    const amount = typeof v?.amount === 'string' ? Number(v.amount) : NaN;
    const minutes = Math.round(amount * factor);
    if (factor && Number.isFinite(minutes) && minutes > 0) return minutes;
  }
  return null;
}

export function formatDetails(entity: { claims?: Record<string, Claim[]> } | null, intro: string): Details {
  return {
    releaseDate: earliestDate(entity?.claims?.P577),
    synopsis: intro ? trimSynopsis(intro, 600) : '',
    lengthLabel: formatMinutes(parseWikidataMinutes(entity?.claims?.P2047)),
    origin: '', // Wikidata has no studio-like field in what the lookup reads
  };
}

async function entityOf(qid: string, d: LookupDeps): Promise<Entity | null> {
  const r = await fetchJson<{ entities?: Record<string, Entity> }>(
    `${WIKIDATA}&props=claims|sitelinks&sitefilter=enwiki&ids=${qid}`, { headers: WIKI_HEADERS }, d,
  );
  assertAnswered(r.status, 'wikidata entity');
  return r.status === 200 ? r.body?.entities?.[qid] ?? null : null;
}

/** The article intro (3 sentences, plain text) by title or page id; null when the request failed. */
async function introOf(by: 'titles' | 'pageids', value: string, d: LookupDeps): Promise<WikiPage | null> {
  const url = `${WIKIPEDIA}?action=query&format=json&formatversion=2&prop=extracts|pageprops&exintro=1&explaintext=1`
    + `&exsentences=3&redirects=1&ppprop=wikibase_item&${by}=${encodeURIComponent(value)}`;
  const r = await fetchJson<{ query?: { pages?: WikiPage[] } }>(url, { headers: WIKI_HEADERS }, d);
  assertAnswered(r.status, 'wikipedia intro');
  return r.status === 200 ? r.body?.query?.pages?.[0] ?? {} as WikiPage : null;
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (/^Q\d{1,12}$/.test(sourceId)) {
    const entity = await entityOf(sourceId, d);
    const title = entity?.sitelinks?.enwiki?.title;
    const page = title ? await introOf('titles', title, d) : null;
    if (!entity && !page) return null;
    return formatDetails(entity, page?.extract || '');
  }
  if (/^\d{1,12}$/.test(sourceId)) {
    const page = await introOf('pageids', sourceId, d);
    if (!page) return null;
    const qid = page.pageprops?.wikibase_item;
    const entity = qid && /^Q\d{1,12}$/.test(qid) ? await entityOf(qid, d) : null;
    return formatDetails(entity, page.extract || '');
  }
  return null;
};
