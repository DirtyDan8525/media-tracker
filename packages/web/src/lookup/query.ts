import { CATEGORY_CONFIG, normTitle, similarity, type Category, type Entry, type LookupInfo } from '@media-tracker/shared';

/** The body of POST /api/lookup. */
export interface LookupQuery {
  category: Category;
  term: string;
  typedTitle: string;
  hint: string;
}

/** The Worker rejects a term, typedTitle or hint longer than this (POST /api/lookup). */
export const MAX_TERM = 500;

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/**
 * The one place that turns "a title and maybe a creator" into a lookup request. Where the creator
 * helps the search (albums, songs, books) it joins the term and is sent as the hint too.
 */
export function buildLookupQuery(category: Category, title: string, creator: string): LookupQuery {
  const hint = CATEGORY_CONFIG[category].creatorIsSearchHint;
  const t = clip(title, MAX_TERM);
  // The title stays whole; the creator hint is what gets cut to fit under the Worker's limit.
  const room = MAX_TERM - t.length - 1;
  const withCreator = hint && creator && room > 0 ? `${t} ${clip(creator, room)}` : t;
  return {
    category,
    term: withCreator,
    typedTitle: t,
    hint: hint ? clip(creator, MAX_TERM) : '',
  };
}

const TITLE_MIN = 0.5;
const SPOTIFY_LINK = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:album|track)\//;

/** A pasted Spotify album/track link is a lookup key, not a title. */
export const isSpotifyLink = (s: string): boolean => SPOTIFY_LINK.test(s);

/** The script's fixTitle_ rule: take the official title only if it is trusted or close to what was typed. */
export function shouldReplaceTitle(typed: string, info: Pick<LookupInfo, 'title' | 'trusted'>): boolean {
  if (!info.title) return false;
  if (info.trusted || isSpotifyLink(typed)) return true;
  return similarity(normTitle(typed), normTitle(info.title)) >= TITLE_MIN;
}

export type InfoPatch = Partial<Pick<Entry, 'title' | 'coverUrl' | 'genres' | 'creator' | 'album' | 'source' | 'sourceId'>> & {
  lookupState: 'ok';
};

/** Same rule the API enforces: an empty link or an http(s) URL of at most 2000 characters. */
export function isHttpUrl(s: string): boolean {
  if (s.length > 2000) return false;
  try {
    const p = new URL(s).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

/**
 * The PATCH body that applies a lookup result to an entry (never rating, status or notes).
 * `typed` is what the user typed (the title rule compares against it). A lookup field that came
 * back empty leaves what the entry already has. In 'add' mode a creator the user typed stays,
 * unless the creator is the search hint (the official spelling is better then).
 */
export function buildInfoPatch(
  entry: Pick<Entry, 'category' | 'title' | 'creator'>,
  typed: string,
  info: LookupInfo,
  mode: 'add' | 'refetch',
): InfoPatch {
  const patch: InfoPatch = { lookupState: 'ok' };
  if (shouldReplaceTitle(typed, info)) patch.title = clip(info.title, 300);
  if (info.cover && isHttpUrl(info.cover)) patch.coverUrl = info.cover;
  if (info.genres) patch.genres = clip(info.genres, 300);
  const keepTypedCreator = mode === 'add' && entry.creator && !CATEGORY_CONFIG[entry.category].creatorIsSearchHint;
  if (info.creator && !keepTypedCreator) patch.creator = clip(info.creator, 300);
  if (info.album) patch.album = clip(info.album, 300);
  patch.source = info.source;
  patch.sourceId = info.sourceId ? clip(info.sourceId, 300) : null;
  return patch;
}
