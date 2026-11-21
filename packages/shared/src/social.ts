import type { Entry } from './types';

/** The quick set shown in the React popover (spec §5.4, amended by Phase 5: any single emoji is allowed too). */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'] as const;
/** One emoji, as a string. */
export type Reaction = string;
export const REACTION_MAX_UNITS = 32;

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Exactly one emoji grapheme (a flag, a skin-toned hand and a ZWJ family each count as one); no text, digits or extras. */
export const isReaction = (v: unknown): v is Reaction => {
  if (typeof v !== 'string' || v.length === 0 || v.length > REACTION_MAX_UNITS) return false;
  if (!EMOJI.test(v)) return false;
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(v)) if (++n > 1) return false;
    return n === 1;
  }
  return false;
};

/** How many custom emoji (not in REACTIONS) each person's "Recent" row keeps. */
export const RECENT_EMOJI_MAX = 4;

/** A stored recent-emoji list (users.recent_emoji, JSON text): only valid custom emoji, deduplicated, at most RECENT_EMOJI_MAX. */
export function parseRecentEmoji(json: string | null | undefined): string[] {
  if (!json) return [];
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const e of v) {
    if (isReaction(e) && !(REACTIONS as readonly string[]).includes(e) && !out.includes(e)) out.push(e);
    if (out.length === RECENT_EMOJI_MAX) break;
  }
  return out;
}

/** The list after reacting with `emoji`: a custom one moves to the front (newest first); a quick-set one changes nothing. */
export function withRecentEmoji(list: readonly string[], emoji: string): string[] {
  if ((REACTIONS as readonly string[]).includes(emoji) || !isReaction(emoji)) return [...list];
  return [emoji, ...list.filter((e) => e !== emoji)].slice(0, RECENT_EMOJI_MAX);
}

export const COMMENT_MAX = 500;
/** Cloudflare Access free plan. */
export const ACCESS_SEATS = 50;
/** Group Top 5 counts a title only when at least this many people rated it. */
export const GROUP_MIN_RATERS = 2;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarAt: string | null;
}

export type Relation = 'self' | 'friend' | 'pending_out' | 'pending_in' | 'none';

/** What a friend may see of an entry: no picks-derived fields, no private flags, notes only when not private. */
export type FriendEntry = Pick<
  Entry,
  | 'id' | 'userId' | 'category' | 'title' | 'status' | 'rating' | 'tier' | 'genres' | 'creator' | 'album'
  | 'coverUrl' | 'releaseDate' | 'synopsis' | 'lengthLabel' | 'origin' | 'detailsState' | 'source'
  | 'sourceId' | 'seasonAvg' | 'createdAt'
> & { notes: string | null; /** The owner's tags on a title the viewer may see (never on private titles). */ tags?: string[]; /** A custom list's per-item link ('' = none). */ link?: string };

/** What the API's reactions and comments routes are asked by. Either way they are the title's (migration 0025): a post id is resolved to its entry. */
export type Target = { activityId: string } | { entryId: string };

export interface Comment {
  id: string;
  author: PublicUser;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

export interface PostSocial {
  reactions: Record<string, number>;
  mine: Reaction[];
  comments: number;
}

/** "Ren" when a display name is set, else "@ren". */
export const nameOf = (u: Pick<PublicUser, 'username' | 'displayName'>): string => u.displayName || `@${u.username}`;
