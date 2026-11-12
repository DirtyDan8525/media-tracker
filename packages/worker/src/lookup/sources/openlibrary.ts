// Open Library book lookup (port of openLibrary_ and BOOK_GENRES from the script), plus work details.
// Free, no key; every request carries a User-Agent naming the app.
// Worst case per lookup: 1 request. Worst case per details call: 2 requests (run in parallel).
import type { Details, LookupInfo } from '@media-tracker/shared';
import { normTitle, similarity, splitYear, trimSynopsis } from '@media-tracker/shared';
import { fetchJson, logLine } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const BASE = 'https://openlibrary.org';
const ACCEPT_SCORE = 0.45;
const YEAR_BONUS = 0.2;
const EDITION_WEIGHT = 0.12;
const CHOICES_WINDOW = 0.1;
const MAX_CHOICES = 8;
const SOURCE_ID_RE = /^[\w.:\-]{1,200}$/;
const WORK_ID_RE = /^OL\d+W$/;

/** The script's OL_HEADERS, naming this app instead of the sheet. */
export const OL_HEADERS: Record<string, string> = {
  'User-Agent': 'MediaTrackerApp/1.0 (private app; contact via GitHub DirtyDan8525/media-tracker)',
  Accept: 'application/json',
};

export const BOOK_GENRES: readonly string[] = ['science fiction', 'fantasy', 'horror', 'mystery', 'thriller', 'romance', 'historical fiction',
  'humor', 'adventure', 'dystopia', 'space opera', 'young adult', 'graphic novel', 'manga', 'comics', 'biography',
  'memoir', 'history', 'philosophy', 'poetry', 'self-help', 'science', 'psychology', 'business', 'true crime', 'classics'];

export interface OlDoc {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  subject?: string[];
  edition_count?: number;
}
export interface Scored {
  d: OlDoc;
  who: string;
  score: number;
}
export interface WorkMeta {
  first_publish_year?: number;
  number_of_pages_median?: number;
  publisher?: string[];
}

/** Up to 3 genres found in the subject list ("science fiction" beats "science"), title-cased and joined with ', '. */
export function genresOf(subject: string[] | null | undefined): string {
  const subj = (subject || []).map((x) => String(x).toLowerCase());
  const hits = BOOK_GENRES.filter((g) => subj.some((x) => x.includes(g)));
  return hits
    .filter((g) => !hits.some((h) => h !== g && h.includes(g)))
    .slice(0, 3)
    .map((g) => g.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(', ');
}

/** '/works/OL17618W' -> 'OL17618W'. */
export const workId = (key: string | undefined): string => String(key || '').replace(/^\/works\//, '');

// "We Are Legion (We Are Bob)" -> "we are legion"
const strip = (t: unknown): string => normTitle(String(t || '').replace(/\s*[(\[][^)\]]*[)\]]/g, ''));

/** Script scoring: title similarity (full, with subtitle, brackets dropped); 0.7/0.3 with the author hint; +0.2 typed year; +0.12 x edition rank. Best first. */
export function scoreDocs(docs: OlDoc[], typedTitle: string, hint: string): Scored[] {
  const { name, year } = splitYear(typedTitle);
  const target = normTitle(name);
  const targetShort = strip(name);
  const byEd = docs.map((d) => d.edition_count || 0).sort((a, b) => b - a);
  return docs
    .map((d): Scored => {
      const title = d.title || '';
      const full = d.subtitle ? `${title} ${d.subtitle}` : title;
      const titleSim = Math.max(similarity(target, normTitle(title)), similarity(target, normTitle(full)), similarity(targetShort, strip(title)));
      const who = (d.author_name || []).join(', ');
      let score = hint ? 0.7 * titleSim + 0.3 * similarity(normTitle(hint), normTitle(who)) : titleSim;
      if (year && String(d.first_publish_year) === year) score += YEAR_BONUS;
      score += EDITION_WEIGHT * (1 - byEd.indexOf(d.edition_count || 0) / docs.length);
      return { d, who, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** The best match (null under 0.45) plus anything within 0.1 of it, at most 8. */
export function pickDocs(scored: Scored[]): Scored[] | null {
  const top = scored[0];
  if (!top || top.score < ACCEPT_SCORE) return null;
  return scored.filter((c) => c === top || c.score >= top.score - CHOICES_WINDOW).slice(0, MAX_CHOICES);
}

export function toInfo(c: Scored): LookupInfo {
  const id = workId(c.d.key);
  const info: LookupInfo = {
    title: c.d.title || '',
    trusted: false,
    creator: c.who,
    genres: genresOf(c.d.subject),
    cover: c.d.cover_i ? `https://covers.openlibrary.org/b/id/${c.d.cover_i}-L.jpg` : '',
    sub: [c.who, c.d.first_publish_year].filter(Boolean).join(' · '),
    source: 'openlibrary',
  };
  if (SOURCE_ID_RE.test(id)) info.sourceId = id;
  return info;
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const typed = q.typedTitle || q.term;
  const name = splitYear(typed).name;
  let url = `${BASE}/search.json?limit=20&fields=key,title,subtitle,author_name,first_publish_year,cover_i,subject,edition_count&q=${encodeURIComponent(name)}`;
  if (q.hint) url += `&author=${encodeURIComponent(q.hint)}`;
  const res = await fetchJson<{ docs?: OlDoc[] }>(url, { headers: OL_HEADERS }, d);
  if (res.status !== 200) {
    logLine(d, `openlibrary: search failed with status ${res.status}`);
    return null;
  }
  const docs = (Array.isArray(res.body?.docs) ? res.body!.docs! : []).filter((x) => x && typeof x === 'object');
  if (!docs.length) return null;

  const picks = pickDocs(scoreDocs(docs, typed, q.hint));
  if (!picks) {
    logLine(d, 'openlibrary: best match under the accept score');
    return null;
  }
  const infos = picks.map(toInfo);
  const top = infos[0]!;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
};

// ---- details ----------------------------------------------------------------

/** '432 pages'; '' when missing or not positive. */
export function pagesLabel(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? `${Math.round(n)} pages` : '';
}

/** A work's description: a plain string, or an object's `.value`. */
export function descriptionOf(desc: unknown): string {
  if (typeof desc === 'string') return desc;
  if (desc && typeof desc === 'object' && typeof (desc as { value?: unknown }).value === 'string') return (desc as { value: string }).value;
  return '';
}

/** Null only when neither request gave anything; a missing half leaves its fields ''. */
export function formatDetails(work: { description?: unknown } | null, meta: WorkMeta | null): Details | null {
  if (!work && !meta) return null;
  const year = meta?.first_publish_year;
  const publisher = Array.isArray(meta?.publisher) ? meta!.publisher![0] : '';
  const synopsis = descriptionOf(work?.description);
  return {
    releaseDate: typeof year === 'number' && Number.isFinite(year) && year > 0 ? String(year) : '',
    synopsis: synopsis ? trimSynopsis(synopsis, 600) : '',
    lengthLabel: pagesLabel(meta?.number_of_pages_median),
    origin: typeof publisher === 'string' ? publisher : '',
  };
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  if (!WORK_ID_RE.test(sourceId)) return null;
  const metaUrl = `${BASE}/search.json?q=${encodeURIComponent(`key:/works/${sourceId}`)}&fields=first_publish_year,number_of_pages_median,publisher&limit=1`;
  const [w, m] = await Promise.all([
    fetchJson<{ description?: unknown }>(`${BASE}/works/${sourceId}.json`, { headers: OL_HEADERS }, d),
    fetchJson<{ docs?: WorkMeta[] }>(metaUrl, { headers: OL_HEADERS }, d),
  ]);
  const work = w.status === 200 && w.body && typeof w.body === 'object' ? w.body : null;
  const meta = m.status === 200 ? (Array.isArray(m.body?.docs) ? m.body!.docs![0] ?? {} : {}) : null;
  return formatDetails(work, meta);
};
