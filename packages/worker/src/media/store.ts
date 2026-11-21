/**
 * Photos and voice memos in chats, and pictures in comments (migration 0026): the `media` ledger (migration 0022) beside the R2 bucket (binding MEDIA).
 * Retention (Dan, 2026-11-20): a file older than the admin's months is removed, and when one person's live files add up
 * past the admin's cap their oldest are removed until they fit. Both run daily from the scheduled handler (runRetention);
 * the cap is also checked at upload time (makeRoom). A removed file leaves its message in place: the message's image_key
 * is cleared, so the chat shows "Photo expired" / "Voice memo expired". A comment's picture works the same way: the comment's
 * media_key is cleared and media_expired set ("Picture expired"). A comment picture is uploaded before its comment exists
 * (a "pending" ledger row, comment_id NULL); one never attached within PENDING_MS is removed by the daily run.
 */
import { loadAppSettings } from '../settings/appSettings';
import type { Env } from '../env';

export type MediaKind = 'photo' | 'voice';

const MB = 1024 * 1024;
/** Ledger rows of removed files are kept this long (for the admin's numbers and debugging), then purged. */
const LEDGER_KEEP_MS = 30 * 86_400_000;
/** One sweep removes at most this many files per rule (R2 deletes up to 1000 keys a call; D1 batches stay small). */
const SWEEP_MAX = 500;
/** A comment picture uploaded but never posted with a comment is removed after this long. */
const PENDING_MS = 3_600_000;

/** The ISO time `months` calendar months before `now` (UTC). */
export function monthsBefore(now: Date, months: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

/**
 * Removes these files: from R2, and in one batch marks their ledger rows removed and clears their messages' keys
 * (the message stays and reads "expired"). Safe to repeat. Returns how many keys it was given.
 */
export async function removeMedia(env: Pick<Env, 'DB' | 'MEDIA'>, keys: string[], now = new Date()): Promise<number> {
  if (keys.length === 0) return 0;
  for (let i = 0; i < keys.length; i += 1000) {
    if (env.MEDIA) await env.MEDIA.delete(keys.slice(i, i + 1000));
  }
  const json = JSON.stringify(keys);
  await env.DB.batch([
    env.DB.prepare('UPDATE media SET deleted_at = ?1 WHERE key IN (SELECT value FROM json_each(?2)) AND deleted_at IS NULL').bind(now.toISOString(), json),
    env.DB.prepare('UPDATE messages SET image_key = NULL WHERE image_key IN (SELECT value FROM json_each(?1))').bind(json),
    env.DB.prepare('UPDATE comments SET media_key = NULL, media_expired = 1 WHERE media_key IN (SELECT value FROM json_each(?1))').bind(json),
  ]);
  return keys.length;
}

/**
 * The oldest live files of `userId` to remove so that what stays plus `incoming` bytes fits `capBytes` (1 query).
 * `kept` is what stays if removal stops before this file: this file and every newer one.
 */
async function overCapKeys(db: D1Database, userId: string, capBytes: number, incoming: number): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT key, SUM(bytes) OVER (ORDER BY created_at DESC, key DESC ROWS UNBOUNDED PRECEDING) AS kept
       FROM media WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY created_at, key`,
  ).bind(userId).all<{ key: string; kept: number }>();
  const out: string[] = [];
  for (const r of results) {
    if (out.length >= SWEEP_MAX || r.kept + incoming <= capBytes) break;
    out.push(r.key);
  }
  return out;
}

/** Upload time: removes the sender's oldest files when adding `incoming` bytes would pass their cap. 1 query + removals. */
export async function makeRoom(env: Pick<Env, 'DB' | 'MEDIA'>, userId: string, capMb: number, incoming: number): Promise<number> {
  const totalRow = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE user_id = ? AND deleted_at IS NULL').bind(userId).first<{ n: number }>();
  const capBytes = capMb * MB;
  if ((totalRow?.n ?? 0) + incoming <= capBytes) return 0;
  return removeMedia(env, await overCapKeys(env.DB, userId, capBytes, incoming));
}

export interface RetentionReport {
  /** Older than the admin's months. */
  aged: number;
  /** Over someone's storage cap. */
  overCap: number;
  /** Ledger rows whose message or comment is gone or no longer points at the file (deleted message or comment, left chat, deleted account), and comment pictures never posted. */
  orphaned: number;
  /** Removed rows older than 30 days, dropped from the ledger. */
  purged: number;
}

/** The daily run (scheduled handler). `now` is passed in so tests can move the clock. */
export async function runRetention(env: Pick<Env, 'DB' | 'MEDIA'>, now = new Date()): Promise<RetentionReport> {
  const db = env.DB;
  const { media } = await loadAppSettings(db);
  // 1. Orphans first, so their bytes do not count against anyone's cap.
  const { results: orphanRows } = await db.prepare(
    `SELECT md.key FROM media md
       LEFT JOIN messages m ON m.id = md.message_id
       LEFT JOIN comments c ON c.id = md.comment_id
      WHERE md.deleted_at IS NULL AND CASE
        WHEN md.message_id IS NOT NULL THEN (m.id IS NULL OR m.image_key IS NULL OR m.image_key <> md.key)
        WHEN md.comment_id IS NOT NULL THEN (c.id IS NULL OR c.deleted_at IS NOT NULL OR c.media_key IS NULL OR c.media_key <> md.key)
        ELSE md.created_at < ?1 END
      LIMIT ${SWEEP_MAX}`,
  ).bind(new Date(now.getTime() - PENDING_MS).toISOString()).all<{ key: string }>();
  const orphaned = await removeMedia(env, orphanRows.map((r) => r.key), now);
  // 2. Age.
  const { results: oldRows } = await db.prepare(
    `SELECT key FROM media WHERE deleted_at IS NULL AND created_at < ? ORDER BY created_at LIMIT ${SWEEP_MAX}`,
  ).bind(monthsBefore(now, media.retentionMonths)).all<{ key: string }>();
  const aged = await removeMedia(env, oldRows.map((r) => r.key), now);
  // 3. Cap, per person over it.
  const capBytes = media.capMb * MB;
  const { results: over } = await db.prepare(
    'SELECT user_id FROM media WHERE deleted_at IS NULL GROUP BY user_id HAVING SUM(bytes) > ?',
  ).bind(capBytes).all<{ user_id: string }>();
  let overCap = 0;
  for (const u of over) overCap += await removeMedia(env, await overCapKeys(db, u.user_id, capBytes, 0), now);
  // 4. Forget long-removed rows.
  const purge = await db.prepare('DELETE FROM media WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .bind(new Date(now.getTime() - LEDGER_KEEP_MS).toISOString()).run();
  return { aged, overCap, orphaned, purged: purge.meta.changes ?? 0 };
}

/** Admin "Delete account": that person's files go too (the ledger outlives the cascade). Call after the user row is gone. */
export async function removeUserMedia(env: Pick<Env, 'DB' | 'MEDIA'>, userId: string): Promise<number> {
  const { results } = await env.DB.prepare('SELECT key FROM media WHERE user_id = ? AND deleted_at IS NULL').bind(userId).all<{ key: string }>();
  return removeMedia(env, results.map((r) => r.key));
}

/** The admin's storage numbers: live bytes and files in all, and the biggest users. 1 batch of 2. */
export async function mediaUsage(db: D1Database): Promise<{ bytes: number; files: number; people: { userId: string; username: string | null; bytes: number }[] }> {
  const [all, top] = await db.batch([
    db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS files FROM media WHERE deleted_at IS NULL'),
    db.prepare(
      `SELECT md.user_id, u.username, SUM(md.bytes) AS bytes FROM media md LEFT JOIN users u ON u.id = md.user_id
        WHERE md.deleted_at IS NULL GROUP BY md.user_id ORDER BY bytes DESC LIMIT 10`,
    ),
  ]);
  const a = all!.results[0] as { bytes: number; files: number };
  return {
    bytes: a.bytes, files: a.files,
    people: (top!.results as { user_id: string; username: string | null; bytes: number }[]).map((r) => ({ userId: r.user_id, username: r.username, bytes: r.bytes })),
  };
}
