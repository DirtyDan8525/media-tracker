import type { Tier, TierSet } from './ratings/types';

/** The nine lists every account has. */
export const BUILTIN_CATEGORIES = ['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga', 'youtube'] as const;
export type BuiltinCategory = (typeof BUILTIN_CATEGORIES)[number];
/** A person's own list (custom_lists row `id`): `c_<id>`. Short and URL-safe. */
export type CustomCategory = `c_${string}`;
/** A list key: built-in, or a custom list's `c_<id>`. Per-list settings go through `listConfig` (customLists.ts). */
export type Category = BuiltinCategory | CustomCategory;

export const isBuiltinCategory = (v: unknown): v is BuiltinCategory =>
  typeof v === 'string' && (BUILTIN_CATEGORIES as readonly string[]).includes(v);
/** The shape of a custom list key (not whether it exists). */
export const CUSTOM_KEY_RE = /^c_[a-z0-9]{6,16}$/;
export const isCustomCategory = (v: unknown): v is CustomCategory => typeof v === 'string' && CUSTOM_KEY_RE.test(v);
/** A built-in key, or anything shaped like a custom key (whether it exists is checked against its owner's lists). */
export const isCategoryKey = (v: unknown): v is Category => isBuiltinCategory(v) || isCustomCategory(v);

export type SourceId =
  | 'anilist' | 'kitsu' | 'tmdb' | 'wiki' | 'tvmaze' | 'deezer' | 'itunes' | 'spotify' | 'openlibrary' | 'steam' | 'igdb' | 'youtube';

export const STATUSES = [
  'Completed',
  'Watching / In Progress',
  'Rewatching',
  'On Hold',
  'Dropped',
  'Plan to watch',
] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Status words found in the Sheet (its Lists tab) and in the app, lower-case, trimmed -> canonical Status.
 * Look up with Object.hasOwn(STATUS_ALIASES, key).
 */
export const STATUS_ALIASES: Readonly<Record<string, Status>> = {
  'completed': 'Completed',
  'watching / in progress': 'Watching / In Progress',
  'watching': 'Watching / In Progress',
  'in progress': 'Watching / In Progress',
  'rewatching': 'Rewatching',
  'on hold': 'On Hold',
  'dropped': 'Dropped',
  'plan to watch': 'Plan to watch',
  'planned': 'Plan to watch',
  'plan to read': 'Plan to watch',
  'plan to play': 'Plan to watch',
  'watched': 'Completed',
};

export interface LookupInfo {
  title: string;
  trusted: boolean;
  cover: string;
  genres: string;
  creator: string;
  album?: string;
  sub?: string;
  source: SourceId;
  sourceId?: string;
  choices?: LookupInfo[];
}

export interface Details {
  /** 'YYYY-MM-DD', 'YYYY' or '' */
  releaseDate: string;
  synopsis: string;
  lengthLabel: string;
  origin: string;
  /** Episode or chapter total when the source knows it (anime episodes, manga chapters). Absent when unknown. */
  progressTotal?: number;
}

export const ORIGIN_LABEL: Record<BuiltinCategory, string> = {
  anime: 'Format',
  movies: 'Studio',
  tv: 'Network',
  albums: 'Label',
  songs: 'Label',
  games: 'Platforms',
  books: 'Publisher',
  manga: 'Format',
  youtube: 'Source',
};

export interface Entry {
  id: string;
  userId: string;
  category: Category;
  title: string;
  typedTitle: string;
  status: Status | null;
  rating: number | null;
  genres: string;
  creator: string;
  album: string;
  coverUrl: string;
  notes: string;
  releaseDate: string;
  synopsis: string;
  lengthLabel: string;
  origin: string;
  detailsState: 'none' | 'filled' | 'needs_review';
  isPrivate: boolean;
  notesPrivate: boolean;
  source: SourceId | null;
  sourceId: string | null;
  lookupState: 'ok' | 'not_found' | 'pending';
  importId: string | null;
  seasonAvg: number | null;
  /** Rating tier (null when unrated). Stored explicitly; never re-derived from an unchanged rating. */
  tier: Tier | null;
  /** Where the title starts inside its tier (a strength); null when unrated. */
  priorMean: number | null;
  /** The last fitted strength (= priorMean with no counted picks); null when unrated. */
  strength: number | null;
  /** A locked score shows exactly the typed number and still counts as an opponent. */
  scoreLocked: boolean;
  /** The number typed or imported: the truth; `rating` is what it shows after close-call nudges (Ruling N1). Absent on rows cached before Phase 5. */
  typed?: number | null;
  /** Position in the list's Plan to watch order (1 = up next); null when not planned or not yet placed (absent on rows cached before Phase 5). */
  planOrder?: number | null;
  /** Episodes watched / chapters read (anime, TV, manga); null when never counted (absent on rows cached before 0010). */
  progress?: number | null;
  /** Episode or chapter total when known (from a lookup or typed); null when unknown. */
  progressTotal?: number | null;
  /** Your own labels on this title, A-Z (absent on rows cached before 0018). */
  tags?: string[];
  /** 'YYYY-MM-DD' the title was started; null = not set (absent on rows cached before 0018). */
  startedAt?: string | null;
  /** 'YYYY-MM-DD' the title was finished; null = not set. */
  finishedAt?: string | null;
  /** How many times again you have been through it (absent on rows cached before 0018). */
  rewatches?: number;
  /** A web or map link (custom lists with a Link column); '' = none (absent on rows cached before 0020). */
  link?: string;
  createdAt: string;
  updatedAt: string;
}

export const TAG_NAME_MAX = 30;
export const TAGS_PER_USER_MAX = 50;
export const TAGS_PER_ENTRY_MAX = 20;
export const REWATCHES_MAX = 999;

/** A tag with how many of your titles carry it (Settings > Tags). */
export interface TagInfo { id: string; name: string; count: number }

/** Statuses that count as "started": the first time a title gets one, Started fills itself. */
export const ACTIVE_STATUSES: readonly Status[] = ['Watching / In Progress', 'Rewatching'];

/** TVmaze's show statuses (kept in a TV title's length label) in the app's words. */
const AIRING_WORDS: Record<string, string> = {
  'Running': 'Still airing',
  'Ended': 'Finished airing',
  'To Be Determined': 'Between seasons',
  'In Development': 'In development',
};

/** Whether a TV title is still airing, from what its lookup stored; null when nothing is stored (anime, other lists). */
export function airingOf(e: Pick<Entry, 'category' | 'lengthLabel'>): string | null {
  if (e.category !== 'tv') return null;
  for (const part of e.lengthLabel.split('·').map((x) => x.trim())) {
    if (Object.hasOwn(AIRING_WORDS, part)) return AIRING_WORDS[part]!;
  }
  return null;
}

export interface Season {
  id: string;
  entryId: string;
  label: string;
  rating: number | null;
  notes: string;
  tier: Tier | null;
  priorMean: number | null;
  strength: number | null;
  scoreLocked: boolean;
  /** The typed number (Ruling N1); absent on rows cached before Phase 5. */
  typed?: number | null;
}

export interface CategoryConfig {
  titleLabel: string;
  creatorLabel: string | null;
  hasStatus: boolean;
  creatorIsSearchHint: boolean;
  square: boolean;
  hasSeasons: boolean;
}

export const CATEGORY_CONFIG: Record<BuiltinCategory, CategoryConfig> = {
  anime:  { titleLabel: 'Title', creatorLabel: 'Studio',    hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: true },
  movies: { titleLabel: 'Title', creatorLabel: 'Director',  hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: false },
  tv:     { titleLabel: 'Title', creatorLabel: null,        hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: true },
  albums: { titleLabel: 'Album', creatorLabel: 'Artist',    hasStatus: false, creatorIsSearchHint: true,  square: true,  hasSeasons: false },
  songs:  { titleLabel: 'Song',  creatorLabel: 'Artist',    hasStatus: false, creatorIsSearchHint: true,  square: true,  hasSeasons: false },
  games:  { titleLabel: 'Title', creatorLabel: 'Developer', hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: false },
  books:  { titleLabel: 'Title', creatorLabel: 'Author',    hasStatus: true,  creatorIsSearchHint: true,  square: false, hasSeasons: false },
  // Series-level only: no volume entries, no seasons. The author is not a search hint (Kitsu's text search is by title).
  manga:  { titleLabel: 'Title', creatorLabel: 'Author',    hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: false },
  // One video at a time: found by pasting a link or by title; thumbnails are 16:9, shown in the square frame (no wide cover shape).
  youtube: { titleLabel: 'Video', creatorLabel: 'Channel', hasStatus: true, creatorIsSearchHint: false, square: true, hasSeasons: false },
};

export interface UserSettings {
  theme: string;
  colors: Record<string, string>;
  tabs: Record<string, boolean>;
  compareAsk: string;
  /** Where Search looks: every list that is turned on, or only the current list (SEARCH_SCOPE). */
  searchScope: string;
  /** Rating tiers per list (missing = DEFAULT_TIERS). Written only by PUT /api/ratings/tiers/:list (Ruling Q3). */
  tiers: Partial<Record<Category, TierSet>>;
  /** Which kinds of push notification this user wants (Phase 6b, P4). All on by default. */
  notify: Record<NotifyKey, boolean>;
  /** PC side nav: which side it sits on and whether it is folded to an icon rail (Dan, 2026-11-18). */
  nav: NavSettings;
  /** PC: clicking a list row opens the cover viewer panel (Dan, 2026-11-19). On by default. */
  coverViewer: boolean;
  /** Your own order for the lists (side bar, list menus, phone Lists menu). Lists not named keep the admin's order after these. Empty = the admin's order. */
  listOrder: Category[];
  /** Quiet mode: until this ISO time nothing the person does posts to Activity (null = off). Personal, never an admin default. */
  quietUntil: string | null;
}

export const NAV_SIDES = ['left', 'right'] as const;
export interface NavSettings {
  side: (typeof NAV_SIDES)[number];
  collapsed: boolean;
}

export const NOTIFY_KEYS = ['messages', 'friendRequests', 'comments', 'reactions', 'signups'] as const;
export type NotifyKey = (typeof NOTIFY_KEYS)[number];

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'Midnight',
  colors: {},
  tabs: {
    anime: true, movies: true, tv: true, albums: true, songs: true, games: true, books: true, manga: true, youtube: true,
    animeSeasons: true, tvSeasons: true,
  },
  compareAsk: 'Both',
  searchScope: 'all',
  tiers: {},
  notify: { messages: true, friendRequests: true, comments: true, reactions: true, signups: true },
  nav: { side: 'left', collapsed: false },
  coverViewer: true,
  listOrder: [],
  quietUntil: null,
};

// Allowed values for "Ask to compare" (the Sheet's other compare options were dropped).
export const COMPARE_ASK = ['Both', 'Only when I start it', 'Only for new ratings', 'Off'] as const;

export const SEARCH_SCOPE = ['all', 'current'] as const;

/** One list row parsed from a Sheet workbook, ready to send to POST /api/import. */
export interface ImportRow {
  category: Category;
  title: string;
  status: Status | null;
  rating: number | null;
  genres: string;
  creator: string;
  album: string;
  coverUrl: string;
  notes: string;
  seasons?: { label: string; rating: number | null; notes: string }[];
  /** Optional extras (the AniList import sets them; the Sheet import never does). */
  progress?: number;
  progressTotal?: number;
  source?: SourceId;
  sourceId?: string;
  /** 'YYYY' */
  releaseDate?: string;
  isPrivate?: boolean;
  /** 'YYYY-MM-DD' */
  startedAt?: string;
  finishedAt?: string;
  rewatches?: number;
}

/** GET /api/import/anilist: the user's public AniList lists, mapped to import rows with duplicates already left out. */
export interface AniListImportPreview {
  user: string;
  rows: ImportRow[];
  /** Rows per list that will be imported (duplicates excluded). */
  counts: { anime: number; manga: number };
  /** Titles left out because they are already on the user's lists. */
  skipped: { anime: number; manga: number };
}

export interface ImportPreview {
  rows: ImportRow[];
  counts: Partial<Record<Category, number>>;
  /** `row` is the 1-based sheet row. */
  skipped: { tab: string; row: number; reason: string }[];
  warnings: { tab: string; row: number; message: string }[];
  settings: Partial<UserSettings> | null;
}

/** The stored status that Plan to watch means on every list (the list's own wording: statusLabel). */
export const PLAN_STATUS: Status = 'Plan to watch';
/** Most titles one plan-order save may carry. */
export const PLAN_ORDER_MAX = 500;

/** Statuses that mean "in progress": the progress counter shows only for these (stored values). */
export const PROGRESS_STATUSES: readonly Status[] = ['Watching / In Progress', 'Rewatching'];
/** The most a progress count or total may be (API limit). */
export const PROGRESS_MAX = 100000;
/** Lists that count episodes or chapters. */
export const PROGRESS_CATEGORIES: readonly Category[] = ['anime', 'tv', 'manga'];

/**
 * True when the progress control applies: a progress list and an in-progress status. A custom list counts when its
 * Progress column is on: pass its `hasProgress` (listConfig) as `listHasProgress`.
 */
export function showsProgress(e: Pick<Entry, 'category' | 'status'>, listHasProgress?: boolean): boolean {
  const on = listHasProgress ?? PROGRESS_CATEGORIES.includes(e.category);
  return on && e.status !== null && PROGRESS_STATUSES.includes(e.status);
}

/** Clamps a progress count to 0..total (0..PROGRESS_MAX when the total is unknown). */
export function clampProgress(n: number, total: number | null | undefined): number {
  const max = total != null && total >= 0 ? total : PROGRESS_MAX;
  return Math.min(Math.max(Math.trunc(n), 0), max);
}
