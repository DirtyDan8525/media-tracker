import type { Entry } from './types';

/** The fixed reaction set (spec §5.4). */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (v: unknown): v is Reaction => typeof v === 'string' && (REACTIONS as readonly string[]).includes(v);

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
> & { notes: string | null };

export type Target = { activityId: string } | { entryId: string };

export interface Comment {
  id: string;
  author: PublicUser;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

export interface PostSocial {
  reactions: Partial<Record<Reaction, number>>;
  mine: Reaction[];
  comments: number;
}

/** "Ren" when a display name is set, else "@ren". */
export const nameOf = (u: Pick<PublicUser, 'username' | 'displayName'>): string => u.displayName || `@${u.username}`;
