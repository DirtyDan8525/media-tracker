// D1 limits, verified 2026-11-10 on Cloudflare's D1 limits page
// (https://developers.cloudflare.com/d1/platform/limits/):
// max 100 bound parameters per query; max 50 queries per Worker invocation
// (free plan). We count every statement inside a db.batch() toward the 50
// (conservative).
export const D1_MAX_PARAMS = 100;
export const D1_MAX_QUERIES = 50;

// ---- Import chunk sizing ----------------------------------------------------
// One POST /api/import = one Worker invocation, so everything it runs counts toward
// D1_MAX_QUERIES (every statement in a db.batch() counts):
//   requireUser: up to 3 (select, insert on first sign-in, select)
//   import lookup: 1
//   batch: 1 imports upsert + N entry inserts + M season inserts
// and every statement is a multi-row INSERT whose bound params must be <= D1_MAX_PARAMS.
// The Worker enforces these limits; the web client uses them to split an import into chunks.
export const IMPORT_AUTH_QUERIES = 3;
export const IMPORT_LOOKUP_QUERIES = 1;
export const IMPORT_UPSERT_STATEMENTS = 1;
const INSERT_BUDGET = D1_MAX_QUERIES - IMPORT_AUTH_QUERIES - IMPORT_LOOKUP_QUERIES - IMPORT_UPSERT_STATEMENTS; // 45

// Bound params per row: id, user_id, category, title, typed_title, status, rating, genres,
// creator, album, cover_url, notes, lookup_state, import_id, created_at, updated_at.
// (details_state is the literal 'none'.)
export const IMPORT_ENTRY_PARAMS = 16;
// id, entry_id, label, rating, notes, created_at.
export const IMPORT_SEASON_PARAMS = 6;
export const ENTRIES_PER_STATEMENT = Math.floor(D1_MAX_PARAMS / IMPORT_ENTRY_PARAMS); // 6
export const SEASONS_PER_STATEMENT = Math.floor(D1_MAX_PARAMS / IMPORT_SEASON_PARAMS); // 16

// Two thirds of the insert budget goes to entry statements, the rest to season statements.
const ENTRY_STATEMENTS = Math.floor((INSERT_BUDGET * 2) / 3); // 30
const SEASON_STATEMENTS = INSERT_BUDGET - ENTRY_STATEMENTS; // 15

/** Max rows in one POST /api/import (180). */
export const IMPORT_CHUNK_ROWS = ENTRY_STATEMENTS * ENTRIES_PER_STATEMENT;
/** Max seasons, summed over all rows in one POST /api/import (240). */
export const IMPORT_CHUNK_SEASONS = SEASON_STATEMENTS * SEASONS_PER_STATEMENT;

/** Statements one chunk runs in its batch (imports upsert + inserts). */
export const importStatementCount = (rows: number, seasons: number) =>
  IMPORT_UPSERT_STATEMENTS + Math.ceil(rows / ENTRIES_PER_STATEMENT) + Math.ceil(seasons / SEASONS_PER_STATEMENT);

// ---- Compare save sizing ----------------------------------------------------
// POST /api/compare/save writes every change in one UPDATE whose changes travel as a single
// JSON parameter (json_each), so the statement always has 3 bound parameters. A request
// carries at most this many changes; the web client splits beyond that.
export const COMPARE_SAVE_MAX_CHANGES = 2000;
