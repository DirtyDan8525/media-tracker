/**
 * Custom lists (Phase 7, wireframe docs/design/mockups/Phase7.wf.html section 3). A person makes up to
 * CUSTOM_LISTS_MAX lists of their own ("Restaurants"); each has the key `c_<id>` and works like a built-in list:
 * ratings (its own rating set, the key), notes, Top 5, Stats, Sharpen, Activity, Search, friends and public links.
 *
 * Every per-list question (its label, columns, status words, search source…) goes through `listConfig`, for
 * built-in and custom keys alike, so nothing else needs to know which kind a list is.
 */
import {
  CATEGORY_CONFIG, ORIGIN_LABEL, PROGRESS_CATEGORIES, isBuiltinCategory, isCustomCategory,
  type BuiltinCategory, type Category, type CustomCategory,
} from './types';

export const CUSTOM_LISTS_MAX = 6;
export const CUSTOM_LIST_NAME_MAX = 40;
export const CUSTOM_LIST_NOUN_MAX = 24;
export const CUSTOM_LIST_CREATOR_MAX = 24;
export const LINK_URL_MAX = 2000;

/** Which words the Status column uses. 'try' = Want to try / Trying / Been. Stored statuses never change. */
export const STATUS_WORDS = ['watch', 'read', 'play', 'try'] as const;
export type StatusWords = (typeof STATUS_WORDS)[number];

/** Where Add looks a title up; null = type it in. */
export const SEARCH_SOURCES = ['movies', 'tv', 'books', 'games', 'music'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];
/** The built-in list whose lookup a search source uses. */
export const SEARCH_SOURCE_LIST: Record<SearchSource, BuiltinCategory> = {
  movies: 'movies', tv: 'tv', books: 'books', games: 'games', music: 'albums',
};
export const SEARCH_SOURCE_LABEL: Record<SearchSource, string> = {
  movies: 'Movies', tv: 'TV', books: 'Books', games: 'Games', music: 'Music',
};

export interface CustomList {
  /** The row id (short, [a-z0-9]); the list key is `c_<id>`. */
  id: string;
  key: CustomCategory;
  name: string;
  /** One item is a… ("restaurant" -> "Add restaurant"). */
  noun: string;
  /** One emoji, or '' for none. */
  icon: string;
  /** The second line's name ("Cuisine"); null = no second line. */
  creatorLabel: string | null;
  hasStatus: boolean;
  statusWords: StatusWords;
  showTags: boolean;
  showYear: boolean;
  showGenres: boolean;
  showProgress: boolean;
  showLink: boolean;
  searchSource: SearchSource | null;
  createdAt: string;
}

/** What New list / Edit list sends. */
export type CustomListInput = Omit<CustomList, 'id' | 'key' | 'createdAt'>;

export const customKey = (id: string): CustomCategory => `c_${id}`;
export const customIdOf = (key: CustomCategory): string => key.slice(2);

/** Built-in display names (the nav, menus, headings). */
export const BUILTIN_LABEL: Record<BuiltinCategory, string> = {
  anime: 'Anime', movies: 'Movies', tv: 'TV Shows', albums: 'Albums', songs: 'Songs', games: 'Games', books: 'Books', manga: 'Manga', youtube: 'YouTube',
};
/** "Add anime", "Add TV show": the singular used on the add button. */
export const BUILTIN_NOUN: Record<BuiltinCategory, string> = {
  anime: 'anime', movies: 'movie', tv: 'TV show', albums: 'album', songs: 'song', games: 'game', books: 'book', manga: 'manga', youtube: 'video',
};

/** Everything a screen or the server needs to know about one list. */
export interface ListConfig {
  key: Category;
  custom: boolean;
  label: string;
  noun: string;
  /** A custom list's emoji ('' when none or built-in). */
  icon: string;
  titleLabel: string;
  creatorLabel: string | null;
  hasStatus: boolean;
  creatorIsSearchHint: boolean;
  square: boolean;
  hasSeasons: boolean;
  originLabel: string;
  hasProgress: boolean;
  /** Status wording; built-in lists keep their own (statusLabel). */
  statusWords: StatusWords | null;
  showTags: boolean;
  showYear: boolean;
  showGenres: boolean;
  showLink: boolean;
  /** The built-in list whose lookup Add uses; null = type it in (no lookup). */
  lookup: BuiltinCategory | null;
}

type ListsArg = Iterable<CustomList> | ReadonlyMap<string, CustomList> | null | undefined;

function findList(key: CustomCategory, lists: ListsArg): CustomList | undefined {
  if (!lists) return undefined;
  if (lists instanceof Map) return (lists as ReadonlyMap<string, CustomList>).get(key);
  for (const l of lists as Iterable<CustomList>) if (l.key === key) return l;
  return undefined;
}

/** A custom list from its key, if known. */
export const customListOf = (key: Category, lists: ListsArg): CustomList | undefined =>
  isCustomCategory(key) ? findList(key, lists) : undefined;

/** The config of a custom list (`l`). */
export function customListConfig(l: CustomList): ListConfig {
  const lookup = l.searchSource ? SEARCH_SOURCE_LIST[l.searchSource] : null;
  return {
    key: l.key, custom: true, label: l.name, noun: l.noun, icon: l.icon,
    titleLabel: 'Name', creatorLabel: l.creatorLabel, hasStatus: l.hasStatus,
    // A second line helps a lookup only where the built-in list uses it that way (an author for books, an artist for music).
    creatorIsSearchHint: lookup !== null && CATEGORY_CONFIG[lookup].creatorIsSearchHint,
    square: lookup !== null && CATEGORY_CONFIG[lookup].square,
    hasSeasons: false, originLabel: lookup ? ORIGIN_LABEL[lookup] : 'Details',
    hasProgress: l.showProgress, statusWords: l.statusWords,
    showTags: l.showTags, showYear: l.showYear, showGenres: l.showGenres, showLink: l.showLink, lookup,
  };
}

/** A custom key nobody here knows (deleted, or not shared with you): a plain list. */
function unknownConfig(key: Category): ListConfig {
  return {
    key, custom: true, label: 'List', noun: 'item', icon: '', titleLabel: 'Name', creatorLabel: null, hasStatus: false,
    creatorIsSearchHint: false, square: false, hasSeasons: false, originLabel: 'Details', hasProgress: false, statusWords: null,
    showTags: true, showYear: false, showGenres: false, showLink: false, lookup: null,
  };
}

/**
 * The one resolver for per-list config. Built-in keys come from CATEGORY_CONFIG; a custom key from `lists` (the
 * owner's custom lists, or any set that holds it: keys are unique across everyone).
 */
export function listConfig(key: Category, lists?: ListsArg): ListConfig {
  if (isBuiltinCategory(key)) {
    const c = CATEGORY_CONFIG[key];
    return {
      key, custom: false, label: BUILTIN_LABEL[key], noun: BUILTIN_NOUN[key], icon: '', ...c,
      originLabel: ORIGIN_LABEL[key], hasProgress: PROGRESS_CATEGORIES.includes(key), statusWords: null,
      showTags: true, showYear: true, showGenres: true, showLink: false, lookup: key,
    };
  }
  const l = findList(key, lists);
  return l ? customListConfig(l) : unknownConfig(key);
}

/** A list's display name, with its emoji in front for custom lists that have one. */
export function listTitle(key: Category, lists?: ListsArg): string {
  const c = listConfig(key, lists);
  return c.icon ? `${c.icon} ${c.label}` : c.label;
}

// ---------- validation (the server checks every write with this; the form uses it too) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanText = (v: unknown, max: number, min = 1): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return [...t].length >= min && [...t].length <= max ? t : null;
};

const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** '' or exactly one emoji (one grapheme, e.g. 🍜, 👩🏽‍🍳, 🇯🇵). */
export function isOneEmoji(v: string): boolean {
  if (v === '') return true;
  if (v.length > 32 || !PICTO.test(v)) return false;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: 'grapheme' }).segment(v)].length === 1;
  return [...v].length <= 8;
}

/** '' or an http(s) URL of at most LINK_URL_MAX characters. */
export function isLinkUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > LINK_URL_MAX) return false;
  if (v === '') return true;
  try {
    const p = new URL(v).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

export type CustomListError = 'name' | 'noun' | 'icon' | 'creatorLabel' | 'statusWords' | 'searchSource' | 'invalid';
export type CustomListValidation = { ok: true; value: Partial<CustomListInput> } | { ok: false; error: CustomListError };

const BOOL_KEYS = ['hasStatus', 'showTags', 'showYear', 'showGenres', 'showProgress', 'showLink'] as const;

/** A new list's defaults for anything the form leaves out. */
export const NEW_LIST_DEFAULTS: CustomListInput = {
  name: '', noun: '', icon: '', creatorLabel: null, hasStatus: true, statusWords: 'watch',
  showTags: true, showYear: false, showGenres: false, showProgress: false, showLink: false, searchSource: null,
};

/**
 * Checks a New list (create: name and noun required; the rest default) or Edit list (patch: only what is sent) body.
 * Text is trimmed and inner runs of spaces collapse. Unknown keys are dropped.
 */
export function validateCustomList(input: unknown, mode: 'create' | 'patch'): CustomListValidation {
  if (!isObj(input)) return { ok: false, error: 'invalid' };
  const out: Partial<CustomListInput> = {};
  if (mode === 'create' || 'name' in input) {
    const n = cleanText(input.name, CUSTOM_LIST_NAME_MAX);
    if (n === null) return { ok: false, error: 'name' };
    out.name = n;
  }
  if (mode === 'create' || 'noun' in input) {
    const n = cleanText(input.noun, CUSTOM_LIST_NOUN_MAX);
    if (n === null) return { ok: false, error: 'noun' };
    out.noun = n;
  }
  if ('icon' in input) {
    const i = typeof input.icon === 'string' ? input.icon.trim() : null;
    if (i === null || !isOneEmoji(i)) return { ok: false, error: 'icon' };
    out.icon = i;
  }
  if ('creatorLabel' in input) {
    if (input.creatorLabel === null || input.creatorLabel === '') out.creatorLabel = null;
    else {
      const t = cleanText(input.creatorLabel, CUSTOM_LIST_CREATOR_MAX);
      if (t === null) return { ok: false, error: 'creatorLabel' };
      out.creatorLabel = t;
    }
  }
  for (const k of BOOL_KEYS) {
    if (!(k in input)) continue;
    if (typeof input[k] !== 'boolean') return { ok: false, error: 'invalid' };
    out[k] = input[k] as boolean;
  }
  if ('statusWords' in input) {
    if (!(STATUS_WORDS as readonly unknown[]).includes(input.statusWords)) return { ok: false, error: 'statusWords' };
    out.statusWords = input.statusWords as StatusWords;
  }
  if ('searchSource' in input) {
    const s = input.searchSource;
    if (s !== null && !(SEARCH_SOURCES as readonly unknown[]).includes(s)) return { ok: false, error: 'searchSource' };
    out.searchSource = s as SearchSource | null;
  }
  return { ok: true, value: mode === 'create' ? { ...NEW_LIST_DEFAULTS, ...out } : out };
}

/** The shape the server stores and sends (DB rows use 0/1 for the switches). */
export interface CustomListRow {
  id: string; name: string; noun: string; icon: string | null; creator_label: string | null;
  has_status: number | boolean; status_words: string; show_tags: number | boolean; show_year: number | boolean;
  show_genres: number | boolean; show_progress: number | boolean; show_link: number | boolean; search_source: string | null; created_at: string;
}

export function rowToCustomList(r: CustomListRow): CustomList {
  const b = (v: number | boolean) => v === true || v === 1;
  return {
    id: r.id, key: customKey(r.id), name: r.name, noun: r.noun, icon: r.icon ?? '', creatorLabel: r.creator_label ?? null,
    hasStatus: b(r.has_status), statusWords: (STATUS_WORDS as readonly string[]).includes(r.status_words) ? r.status_words as StatusWords : 'watch',
    showTags: b(r.show_tags), showYear: b(r.show_year), showGenres: b(r.show_genres), showProgress: b(r.show_progress), showLink: b(r.show_link),
    searchSource: (SEARCH_SOURCES as readonly (string | null)[]).includes(r.search_source) ? r.search_source as SearchSource | null : null,
    createdAt: r.created_at,
  };
}

/** A JSON array of custom_lists rows (the server's `json_group_array` sub-select) as lists; junk gives none. */
export function parseCustomListsJson(json: string | null | undefined): CustomList[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is CustomListRow => isObj(r) && typeof r.id === 'string' && typeof r.name === 'string').map(rowToCustomList);
  } catch {
    return [];
  }
}

