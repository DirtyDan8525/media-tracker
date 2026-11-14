import { CATEGORY_CONFIG, STATUSES, type Category, type Entry } from '@media-tracker/shared';

const SOURCES = ['anilist', 'kitsu', 'tmdb', 'wiki', 'tvmaze', 'deezer', 'itunes', 'spotify', 'openlibrary', 'steam', 'igdb'];
const LOOKUP_STATES = ['ok', 'not_found', 'pending'];
const DETAILS_STATES = ['none', 'filled', 'needs_review'];
const DATE_RE = /^(\d{4}|\d{4}-\d{2}-\d{2})$/;

export const CATEGORIES = Object.keys(CATEGORY_CONFIG) as Category[];

export type EntryFields = Partial<
  Pick<
    Entry,
    | 'title' | 'typedTitle' | 'status' | 'rating' | 'genres' | 'creator' | 'album' | 'coverUrl' | 'notes'
    | 'releaseDate' | 'synopsis' | 'lengthLabel' | 'origin' | 'detailsState' | 'isPrivate' | 'notesPrivate'
    | 'source' | 'sourceId' | 'lookupState'
  >
>;

export type EntryValidation = { ok: true; value: EntryFields } | { ok: false };
export type SeasonFields = { label?: string; rating?: number | null; notes?: string };
export type SeasonValidation = { ok: true; value: SeasonFields } | { ok: false };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** null or a finite number 0-10 with at most 2 decimals. */
export function isValidRating(r: unknown): r is number | null {
  if (r === null) return true;
  if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 10) return false;
  return Math.abs(r * 100 - Math.round(r * 100)) < 1e-9;
}

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function isCoverUrl(v: unknown): boolean {
  if (!isStr(v, 2000)) return false;
  if (v === '') return true;
  try {
    const p = new URL(v).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

// key -> validator for the simple, category-independent fields.
const FIELD_CHECKS: Record<string, (v: unknown) => boolean> = {
  typedTitle: (v) => isStr(v, 300),
  genres: (v) => isStr(v, 300),
  creator: (v) => isStr(v, 300),
  album: (v) => isStr(v, 300),
  origin: (v) => isStr(v, 300),
  lengthLabel: (v) => isStr(v, 300),
  notes: (v) => isStr(v, 5000),
  synopsis: (v) => isStr(v, 5000),
  coverUrl: isCoverUrl,
  releaseDate: (v) => typeof v === 'string' && (v === '' || DATE_RE.test(v)),
  detailsState: (v) => typeof v === 'string' && DETAILS_STATES.includes(v),
  lookupState: (v) => typeof v === 'string' && LOOKUP_STATES.includes(v),
  isPrivate: (v) => typeof v === 'boolean',
  notesPrivate: (v) => typeof v === 'boolean',
  source: (v) => v === null || (typeof v === 'string' && SOURCES.includes(v)),
  sourceId: (v) => v === null || isStr(v, 300),
  rating: isValidRating,
};

/**
 * Validates a create/patch body. Unknown keys (and server-owned ones such as
 * id, userId, category, importId, createdAt) are dropped. Any bad value fails.
 * `category` is the entry's category (from the body on create, the row on patch).
 */
export function validateEntryInput(input: unknown, mode: 'create' | 'patch', category: Category): EntryValidation {
  if (!isPlainObject(input)) return { ok: false };
  const out: Record<string, unknown> = {};

  if (mode === 'create' || 'title' in input) {
    const t = input.title;
    if (!isStr(t, 300) || t.trim() === '') return { ok: false };
    out.title = t;
  }
  for (const [key, check] of Object.entries(FIELD_CHECKS)) {
    if (!(key in input)) continue;
    if (!check(input[key])) return { ok: false };
    out[key] = input[key];
  }
  if ('status' in input) {
    const s = input.status;
    if (s !== null && !(typeof s === 'string' && (STATUSES as readonly string[]).includes(s))) return { ok: false };
    if (s !== null && !CATEGORY_CONFIG[category].hasStatus) return { ok: false };
    out.status = s;
  }
  return { ok: true, value: out as EntryFields };
}

export function validateSeasonInput(input: unknown): SeasonValidation {
  if (!isPlainObject(input)) return { ok: false };
  const out: SeasonFields = {};
  if ('label' in input) {
    if (!isStr(input.label, 100)) return { ok: false };
    out.label = input.label;
  }
  if ('rating' in input) {
    if (!isValidRating(input.rating)) return { ok: false };
    out.rating = input.rating;
  }
  if ('notes' in input) {
    if (!isStr(input.notes, 5000)) return { ok: false };
    out.notes = input.notes;
  }
  return { ok: true, value: out };
}
