import type { Category } from './types';
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
  payload: {
    rating?: number | null;
    status?: string | null;
    from?: number | string | null;
    to?: number | string;
    via?: 'compare';
  };
  createdAt: string;
}

/** Every row of up to 30 posts, plus their authors and their reactions / comment counts by post id. */
export interface ActivityPage {
  items: ActivityItem[];
  users: Record<string, PublicUser>;
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
  title: string;
  coverUrl: string;
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
        title: n.title,
        coverUrl: n.coverUrl,
        at: n.createdAt,
        added,
        rating,
        status,
      },
    });
  }
  return lines.sort((a, b) => newerFirst(a.newest, b.newest)).map((l) => l.line);
}
