export type Category = 'anime' | 'movies' | 'tv' | 'albums' | 'songs' | 'games' | 'books';

export type SourceId =
  | 'anilist' | 'tmdb' | 'wiki' | 'tvmaze' | 'deezer' | 'itunes' | 'spotify' | 'openlibrary' | 'steam' | 'igdb';

export const STATUSES = [
  'Completed',
  'Watching / In Progress',
  'Rewatching',
  'On Hold',
  'Dropped',
  'Plan to watch',
] as const;
export type Status = (typeof STATUSES)[number];

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
  tabs: { anime: true, movies: true, tv: true, albums: true, songs: true, games: true, books: true },
  compareAsk: 'Both',
  compareStyle: 'Meet in the middle',
  compareRoom: 'Use in-between scores',
  compareWindow: 1,
};
