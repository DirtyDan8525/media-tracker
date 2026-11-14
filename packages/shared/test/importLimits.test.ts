import { describe, expect, it } from 'vitest';
import { D1_MAX_QUERIES, IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS, importStatementCount } from '../src/importLimits';

describe('import chunk limits', () => {
  it('are 180 rows and 240 seasons', () => {
    expect(IMPORT_CHUNK_ROWS).toBe(180);
    expect(IMPORT_CHUNK_SEASONS).toBe(240);
  });
  it('keep a full chunk within the query budget (auth 3 + lookup 1 + batch)', () => {
    expect(importStatementCount(IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS) + 4).toBeLessThanOrEqual(D1_MAX_QUERIES);
  });
});
