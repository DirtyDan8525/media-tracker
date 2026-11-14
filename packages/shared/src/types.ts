export type Category = 'anime' | 'movies' | 'tv' | 'albums' | 'songs' | 'games' | 'books';

export type SourceId =
  | 'anilist' | 'kitsu' | 'tmdb' | 'wiki' | 'tvmaze' | 'deezer' | 'itunes' | 'spotify' | 'openlibrary' | 'steam' | 'igdb';

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
}

export const ORIGIN_LABEL: Record<Category, string> = {
  anime: 'Format',
  movies: 'Studio',
  tv: 'Network',
  albums: 'Label',
  songs: 'Label',
  games: 'Platforms',
  books: 'Publisher',
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
  createdAt: string;
  updatedAt: string;
}

export interface Season {
  id: string;
  entryId: string;
  label: string;
  rating: number | null;
  notes: string;
}

export interface CategoryConfig {
  titleLabel: 'Title' | 'Album' | 'Song';
  creatorLabel: 'Studio' | 'Director' | 'Artist' | 'Author' | 'Developer' | null;
  hasStatus: boolean;
  creatorIsSearchHint: boolean;
  square: boolean;
  hasSeasons: boolean;
}

export const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  anime:  { titleLabel: 'Title', creatorLabel: 'Studio',    hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: true },
  movies: { titleLabel: 'Title', creatorLabel: 'Director',  hasStatus: false, creatorIsSearchHint: false, square: false, hasSeasons: false },
  tv:     { titleLabel: 'Title', creatorLabel: null,        hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: true },
  albums: { titleLabel: 'Album', creatorLabel: 'Artist',    hasStatus: false, creatorIsSearchHint: true,  square: true,  hasSeasons: false },
  songs:  { titleLabel: 'Song',  creatorLabel: 'Artist',    hasStatus: false, creatorIsSearchHint: true,  square: true,  hasSeasons: false },
  games:  { titleLabel: 'Title', creatorLabel: 'Developer', hasStatus: true,  creatorIsSearchHint: false, square: false, hasSeasons: false },
  books:  { titleLabel: 'Title', creatorLabel: 'Author',    hasStatus: true,  creatorIsSearchHint: true,  square: false, hasSeasons: false },
};

export interface UserSettings {
  theme: string;
  colors: Record<string, string>;
  tabs: Record<string, boolean>;
  compareAsk: string;
  compareStyle: string;
  compareRoom: string;
  compareWindow: number;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'Midnight',
  colors: {},
  tabs: {
    anime: true, movies: true, tv: true, albums: true, songs: true, games: true, books: true,
    animeSeasons: true, tvSeasons: true,
  },
  compareAsk: 'Both',
  compareStyle: 'Meet in the middle',
  compareRoom: 'Use in-between scores',
  compareWindow: 1,
};

// Allowed values for the three compare options (the Sheet's Settings dropdowns).
export const COMPARE_ASK = ['Both', 'Only when I start it', 'Only for new ratings', 'Off'] as const;
export const COMPARE_STYLE = ['Meet in the middle', 'Swap the numbers'] as const;
export const COMPARE_ROOM = ['Use in-between scores', 'Give the same score', 'Push others down'] as const;

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
}

export interface ImportPreview {
  rows: ImportRow[];
  counts: Partial<Record<Category, number>>;
  /** `row` is the 1-based sheet row. */
  skipped: { tab: string; row: number; reason: string }[];
  warnings: { tab: string; row: number; message: string }[];
  settings: Partial<UserSettings> | null;
}
