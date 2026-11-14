// lookup_cache: chain results (source 'chain:<category>'), details
// (source '<SourceId>', key 'details:<id>') and adapter state such as tokens.
// A cache problem must never break a lookup, so both helpers swallow errors.
import type { LookupInfo } from '@media-tracker/shared';

export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The cached value, or null when missing, older than 30 days, unreadable, or on a DB error. */
export async function getCached<T = LookupInfo>(db: D1Database, source: string, key: string): Promise<T | null> {
  try {
    const row = await db
      .prepare('SELECT result_json, fetched_at FROM lookup_cache WHERE source = ? AND query_key = ?')
      .bind(source, key)
      .first<{ result_json: string | null; fetched_at: string | null }>();
    if (!row?.result_json || !row.fetched_at) return null;
    const age = Date.now() - Date.parse(row.fetched_at);
    if (!(age >= 0 && age < CACHE_TTL_MS)) return null; // stale, future-dated or unparseable
    return JSON.parse(row.result_json) as T;
  } catch (err) {
    console.warn('lookup_cache read failed', err);
    return null;
  }
}

/** Stores (or overwrites) a value, stamped now. */
export async function putCached(db: D1Database, source: string, key: string, value: unknown): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO lookup_cache (source, query_key, result_json, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (source, query_key) DO UPDATE SET result_json = excluded.result_json, fetched_at = excluded.fetched_at`,
      )
      .bind(source, key, JSON.stringify(value), new Date().toISOString())
      .run();
  } catch (err) {
    console.warn('lookup_cache write failed', err);
  }
}
