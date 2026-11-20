import type { Category, Entry } from './types';
import type { PostSocial, PublicUser } from './social';

export const ACTIVITY_TYPES = ['added', 'rated', 're-rated', 'status'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Which posts `GET /api/activity?show=` returns (S6). */
export type FeedScope = 'you' | 'friends' | 'everyone';
export const FEED_SCOPES: readonly FeedScope[] = ['you', 'friends', 'everyone'];

export interface ActivityItem {
  id: string;
  /** The post this row belongs to: its anchor row's id (the anchor's own id for the anchor). S5. */
  postId: string;
  userId: string;
  type: ActivityType;
  entryId: string;
  category: Category;
  title: string;
  coverUrl: string;
  /** The entry's creator (artist, studio, director, author); '' when it has none. */
  creator?: string;
  /** Where the title came from (e.g. Deezer track id), so Play preview / trailer find the exact one; and its release date. */
  source?: Entry['source'];
  sourceId?: string | null;
  releaseDate?: string;
  /** The owner's note on the title when this viewer may read it (yours, or a friend's that isn't private); else null. */
  note?: string | null;
  payload: {
    rating?: number | null;
    status?: string | null;
    from?: number | string | null;
    to?: number | string;
    via?: 'compare';
    /** A season rating: the season's id and label (the row's entry is its parent). */
    seasonId?: string;
    season?: string;
  };
  createdAt: string;
}

/** Every row of up to 30 posts, plus their authors (and which are friends) and their reactions / comment counts by post id. */
export interface ActivityPage {
  items: ActivityItem[];
  users: Record<string, PublicUser>;
  /** Which of `users` are your accepted friends (a non-friend's entry page is closed to you). */
  friends: string[];
  social: Record<string, PostSocial>;
  next: { before: string; beforeId: string } | null;
}

/** One displayed line: one post (every row sharing a post id) folded together. */
export interface ActivityLine {
  /** The post id. */
  key: string;
  userId: string;
  entryId: string;
  category: Category;
  /** The title as shown: a season post reads "Title · Season". */
  title: string;
  /** The entry's own title (what Add to mine copies). */
  entryTitle: string;
  coverUrl: string;
  creator: string;
  source: Entry['source'];
  sourceId: string | null;
  releaseDate: string;
  note: string | null;
  at: string;
  added: boolean;
  rating: { from: number | null; to: number } | null;
  status: { from: string | null; to: string } | null;
}

/** A post takes a user's changes to one entry within this long of the post's first change (S5). */
export const ACTIVITY_MERGE_MS = 600_000;

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const newerFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1;

/**
 * Folds activity rows into lines, one per post id (S5, amends B15: the server groups rows into
 * posts when it writes them). Within a post the first `from` and the last `to` win; a change that
 * ends where it began (7 to 8 to 7) shows nothing, and a post with nothing left to show is
 * dropped. Lines come out newest first, by each post's newest row.
 */
export function foldPosts(items: ActivityItem[]): ActivityLine[] {
  const posts = new Map<string, ActivityItem[]>();
  for (const row of items) {
    const rows = posts.get(row.postId);
    if (rows) rows.push(row);
    else posts.set(row.postId, [row]);
  }

  const lines: { line: ActivityLine; newest: ActivityItem }[] = [];
  for (const [postId, rows] of posts) {
    const oldestFirst = [...rows].sort(newerFirst).reverse();
    let added = false;
    let ratingFrom: number | null | undefined;
    let ratingTo: number | null = null;
    let statusFrom: string | null | undefined;
    let statusTo: string | null = null;
    for (const r of oldestFirst) {
      const p = r.payload;
      if (r.type === 'added') {
        added = true;
        if (p.rating !== undefined && p.rating !== null) {
          if (ratingFrom === undefined) ratingFrom = null;
          ratingTo = p.rating;
        }
        if (p.status !== undefined && p.status !== null) {
          if (statusFrom === undefined) statusFrom = null;
          statusTo = p.status;
        }
      } else if (r.type === 'rated' || r.type === 're-rated') {
        if (ratingFrom === undefined) ratingFrom = num(p.from);
        ratingTo = num(p.to);
      } else if (r.type === 'status') {
        if (statusFrom === undefined) statusFrom = str(p.from);
        statusTo = str(p.to);
      }
    }
    const rating =
      ratingTo !== null && ratingFrom !== undefined && ratingFrom !== ratingTo ? { from: ratingFrom, to: ratingTo } : null;
    const status =
      statusTo !== null && statusFrom !== undefined && statusFrom !== statusTo ? { from: statusFrom, to: statusTo } : null;
    if (!added && !rating && !status) continue;
    const n = oldestFirst[oldestFirst.length - 1]!;
    lines.push({
      newest: n,
      line: {
        key: postId,
        userId: n.userId,
        entryId: n.entryId,
        category: n.category,
        title: str(n.payload.season) !== null ? `${n.title} · ${str(n.payload.season)}` : n.title,
        entryTitle: n.title,
        coverUrl: n.coverUrl,
        creator: n.creator ?? '',
        source: n.source ?? null,
        sourceId: n.sourceId ?? null,
        releaseDate: n.releaseDate ?? '',
        note: n.note && n.note.trim() !== '' ? n.note : null,
        at: n.createdAt,
        added,
        rating,
        status,
      },
    });
  }
  return lines.sort((a, b) => newerFirst(a.newest, b.newest)).map((l) => l.line);
}
