import { describe, expect, it } from 'vitest';
import {
  D1_MAX_QUERIES, ENTRIES_PER_STATEMENT, IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS, IMPORT_ENTRY_PARAMS, IMPORT_SEASON_PARAMS,
  SEASONS_PER_STATEMENT, importStatementCount,
} from '../src/importLimits';

describe('import chunk limits', () => {
  it('import limits: 19 entry params → 5 rows per statement, chunk 145; 9 season params → 11, chunk 165', () => {
    expect(IMPORT_ENTRY_PARAMS).toBe(19);
    expect(ENTRIES_PER_STATEMENT).toBe(5);
    expect(IMPORT_CHUNK_ROWS).toBe(145);
    expect(IMPORT_SEASON_PARAMS).toBe(9);
    expect(SEASONS_PER_STATEMENT).toBe(11);
    expect(IMPORT_CHUNK_SEASONS).toBe(165);
  });
  it('keep a full chunk within the query budget (auth 3 + lookup 1 + batch)', () => {
    expect(importStatementCount(IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS) + 4).toBeLessThanOrEqual(D1_MAX_QUERIES);
  });
});
