/**
 * The entry visibility rule (spec §4, plan S9): a viewer sees an entry if they own it, or are an
 * accepted friend of the owner and the entry isn't private. Notes are left out when notes_private.
 * Picks-derived fields (strength, priorMean, scoreLocked) and comparisons never leave for anyone but
 * the owner. Every friend-visible route filters with `visibleEntrySql` and maps rows through
 * `toFriendEntry`, which re-checks `canView`.
 */
import type { FriendEntry, PublicUser, Relation } from '@media-tracker/shared';
import { parseTags, type EntryRow } from '../api/entries';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sorted pair: friendships rows store user_a < user_b. */
export function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * One query (none when viewer = owner). A8: an owner who is not active (pending or removed) is a
 * stranger to everyone else, whatever the friendships table says.
 */
export async function relationOf(db: D1Database, viewerId: string, ownerId: string): Promise<Relation> {
  if (viewerId === ownerId) return 'self';
  const [a, b] = pair(viewerId, ownerId);
  const row = await db
    .prepare(
      `SELECT f.status, f.requested_by FROM users u JOIN friendships f ON f.user_a = ?1 AND f.user_b = ?2
       WHERE u.id = ?3 AND u.status = 'active'`,
    )
    .bind(a, b, ownerId)
    .first<{ status: 'pending' | 'accepted'; requested_by: string }>();
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friend';
  return row.requested_by === viewerId ? 'pending_out' : 'pending_in';
}

export function canView(rel: Relation, entry: { isPrivate: boolean }): boolean {
  if (rel === 'self') return true;
  return rel === 'friend' && !entry.isPrivate;
}

/** Only the owner edits. Existing write routes keep their own `user_id = ?` guards too. */
export function canEdit(viewerId: string, ownerId: string): boolean {
  return viewerId === ownerId;
}

/** Accepted friends' ids of the user bound at `param` (e.g. '?1'). A8: active friends only. */
export function FRIEND_IDS_SQL(param: string): string {
  return `SELECT fu.id FROM friendships f JOIN users fu ON fu.id = CASE WHEN f.user_a = ${param} THEN f.user_b ELSE f.user_a END
    WHERE (f.user_a = ${param} OR f.user_b = ${param}) AND f.status = 'accepted' AND fu.status = 'active'`;
}

/** SQL twin of `canView` for the entries row aliased `alias`, viewer bound at `viewerParam`. */
export function visibleEntrySql(alias: string, viewerParam: string): string {
  return `(${alias}.user_id = ${viewerParam} OR (${alias}.is_private = 0 AND ${alias}.user_id IN (${FRIEND_IDS_SQL(viewerParam)})))`;
}

/**
 * Feed visibility of an activity post (S9, amended by Dan 2026-11-16: Everyone = all active users):
 * your own posts, or any non-private entry's post by an active user, friend or not. Entry pages,
 * entry-level threads and friend lists stay friends-only (`canView`, `visibleEntrySql`).
 */
export function canViewPost(viewerId: string, post: { ownerId: string; isPrivate: boolean; ownerStatus: string }): boolean {
  if (post.ownerId === viewerId) return true;
  return !post.isPrivate && post.ownerStatus === 'active';
}

/** SQL twin of `canViewPost` for the entries row aliased `alias`, viewer bound at `viewerParam`. */
export function feedVisibleSql(alias: string, viewerParam: string): string {
  return `(${alias}.user_id = ${viewerParam} OR (${alias}.is_private = 0 AND ${alias}.user_id IN (SELECT au.id FROM users au WHERE au.status = 'active')))`;
}

export class NotVisible extends Error {
  constructor() {
    super('not visible');
  }
}

/** The friend-safe shape. Throws when the viewer may not see the row. */
export function toFriendEntry(row: EntryRow, rel: Relation): FriendEntry {
  if (!canView(rel, { isPrivate: row.is_private === 1 })) throw new NotVisible();
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    title: row.title,
    status: row.status,
    rating: row.rating,
    tier: row.tier,
    genres: row.genres,
    creator: row.creator,
    album: row.album,
    coverUrl: row.cover_url,
    releaseDate: row.release_date,
    synopsis: row.synopsis,
    lengthLabel: row.length_label,
    origin: row.origin,
    detailsState: row.details_state,
    source: row.source,
    sourceId: row.source_id,
    seasonAvg: row.season_avg === null || row.season_avg === undefined ? null : round2(row.season_avg),
    createdAt: row.created_at,
    notes: row.notes_private === 1 ? null : row.notes,
    // The owner's tags go where the title goes (canView above refused a private one): friends and public links.
    tags: parseTags(row.tags_json),
    link: row.link ?? '',
  };
}

export interface PublicUserRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_at: string | null;
}

/** Columns to select for `publicUser` (prefix with an alias as needed). */
export const PUBLIC_USER_COLS = 'id, username, display_name, avatar_at';

export function publicUser(row: PublicUserRow): PublicUser {
  return { id: row.id, username: row.username ?? '', displayName: row.display_name, avatarAt: row.avatar_at };
}
