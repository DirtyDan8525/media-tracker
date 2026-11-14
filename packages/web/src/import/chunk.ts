import { IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS, type ImportRow } from '@media-tracker/shared';

/**
 * Splits rows (in order) into POST /api/import bodies, each within both Worker limits:
 * at most IMPORT_CHUNK_ROWS rows and IMPORT_CHUNK_SEASONS seasons summed over its rows.
 * A single row with more seasons than the limit travels alone (the Worker will refuse it).
 */
export function chunkRows(rows: ImportRow[]): ImportRow[][] {
  const chunks: ImportRow[][] = [];
  let cur: ImportRow[] = [];
  let seasons = 0;
  for (const r of rows) {
    const n = r.seasons?.length ?? 0;
    if (cur.length > 0 && (cur.length >= IMPORT_CHUNK_ROWS || seasons + n > IMPORT_CHUNK_SEASONS)) {
      chunks.push(cur);
      cur = [];
      seasons = 0;
    }
    cur.push(r);
    seasons += n;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}
