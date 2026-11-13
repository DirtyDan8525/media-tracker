import { IMPORT_CHUNK_ROWS, IMPORT_CHUNK_SEASONS, type ImportRow } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { chunkRows } from './chunk';

const row = (i: number, seasons = 0): ImportRow => ({
  category: 'anime', title: `T${i}`, status: null, rating: null, genres: '', creator: '', album: '', coverUrl: '', notes: '',
  seasons: seasons ? Array.from({ length: seasons }, (_, k) => ({ label: `S${k}`, rating: null, notes: '' })) : undefined,
});
const seasonsOf = (c: ImportRow[]) => c.reduce((n, r) => n + (r.seasons?.length ?? 0), 0);

describe('chunkRows', () => {
  it('splits 400 rows into requests of at most 180 rows, in order', () => {
    const rows = Array.from({ length: 400 }, (_, i) => row(i));
    const chunks = chunkRows(rows);
    expect(chunks.map((c) => c.length)).toEqual([180, 180, 40]);
    expect(chunks.flat()).toEqual(rows);
  });

  it('keeps each chunk within the seasons limit too', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i, 10)); // 600 seasons
    const chunks = chunkRows(rows);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(IMPORT_CHUNK_ROWS);
      expect(seasonsOf(c)).toBeLessThanOrEqual(IMPORT_CHUNK_SEASONS);
    }
    expect(chunks.flat()).toEqual(rows);
  });

  it('gives an empty import no chunks', () => {
    expect(chunkRows([])).toEqual([]);
  });
});
