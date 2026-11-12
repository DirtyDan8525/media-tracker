import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ImportPreview, ImportRow } from '@media-tracker/shared';
import { parseWorkbook } from '../src/import/parseWorkbook';
import { buildWorkbook, toArrayBuffer, type Cell } from './helpers/buildWorkbook';

const parseRows = async (sheets: { name: string; rows: Cell[][]; hidden?: boolean }[]) =>
  parseWorkbook(toArrayBuffer(await buildWorkbook(sheets)));

describe('sample workbook', () => {
  let p: ImportPreview;
  beforeAll(async () => {
    const buf = await readFile(new URL('./fixtures/sample-tracker.xlsx', import.meta.url));
    p = await parseWorkbook(toArrayBuffer(new Uint8Array(buf)));
  });
  const row = (title: string) => p.rows.find((r) => r.title === title)!;

  it('counts per category, hidden tabs included, ignored tabs ignored', () => {
    expect(p.counts).toEqual({ anime: 6, movies: 2, tv: 2, albums: 1, songs: 2, games: 2, books: 1 });
    expect(p.rows).toHaveLength(16);
    expect(p.rows.filter((r) => r.category === 'songs').map((r) => r.title)).toEqual(['Karma Police', 'Creep']);
  });

  it('skips blank rows silently', () => {
    expect(p.skipped.filter((s) => s.tab === 'My Anime')).toEqual([]);
    expect(p.warnings.some((w) => w.tab === 'My Anime' && w.row === 3)).toBe(false);
  });

  it('converts "8,5" to 8.5, keeps numbers, normalises status case', () => {
    expect(row('Mushishi')).toMatchObject({ rating: 8.5, status: 'Completed', creator: 'Artland', genres: 'Slice of Life' });
    expect(row('Frieren')).toMatchObject({ category: 'anime', rating: 10, status: 'Completed', creator: 'Madhouse', notes: 'Loved it' });
    expect(row('Dark').rating).toBe(8.75);
  });

  it('out-of-range / non-numeric ratings import as null with a warning', () => {
    expect(row('Overrated')).toMatchObject({ rating: null, status: 'Dropped' });
    expect(row('Eight').rating).toBeNull();
    const msgs = p.warnings.filter((w) => w.tab === 'My Anime');
    expect(msgs.map((w) => w.row).sort()).toEqual([5, 6, 7, 8]);
    expect(msgs.find((w) => w.row === 5)!.message).toMatch(/rating/i);
    expect(msgs.find((w) => w.row === 6)!.message).toMatch(/rating/i);
    expect(msgs.find((w) => w.row === 7)!.message).toMatch(/status/i);
    expect(row('Odd Status').status).toBeNull();
  });

  it('detects a renamed tab by its headers', () => {
    expect(p.rows.filter((r) => r.category === 'anime')).toHaveLength(6);
  });

  it('reads the cover only from Cover URL', () => {
    expect(row('Frieren').coverUrl).toBe('https://img.test/frieren.jpg');
    expect(row('Mushishi').coverUrl).toBe(''); // Cover column held a URL, Cover URL empty
    expect(row('Bad Cover').coverUrl).toBe('');
    expect(p.warnings.find((w) => w.tab === 'My Anime' && w.row === 8)!.message).toMatch(/cover/i);
    expect(row('Spirited Away').coverUrl).toBe('https://img.test/spirited.jpg');
  });

  it('forces status null where the category has none; reads creator and album', () => {
    expect(row('Spirited Away')).toMatchObject({ status: null, creator: 'Hayao Miyazaki' });
    expect(row('In Rainbows')).toMatchObject({ category: 'albums', creator: 'Radiohead' });
    expect(row('Karma Police')).toMatchObject({ category: 'songs', creator: 'Radiohead', album: 'OK Computer' });
    expect(row('Hades')).toMatchObject({ creator: 'Supergiant Games', status: 'Completed' });
    expect(row('Dune')).toMatchObject({ category: 'books', creator: 'Frank Herbert' });
    expect(row('Severance')).toMatchObject({ category: 'tv', creator: '' });
  });

  it('attaches seasons by normalised title; unmatched go to skipped', () => {
    expect(row('Frieren').seasons).toEqual([
      { label: 'Season 1', rating: 9.5, notes: 'Strong start' },
      { label: '2', rating: 10, notes: '' },
      { label: 'OVA', rating: null, notes: '' },
    ]);
    expect(row('Severance').seasons).toEqual([
      { label: '1', rating: 9, notes: '' },
      { label: '2', rating: 9.5, notes: '' },
    ]);
    expect(row('Mushishi').seasons).toBeUndefined();
    expect(p.skipped).toEqual([
      { tab: 'Anime Seasons', row: 4, reason: 'no matching show' },
      { tab: 'TV Seasons', row: 4, reason: 'no matching show' },
    ]);
  });

  it('reads settings the way readSettings_ does', () => {
    expect(p.settings).toEqual({
      theme: 'Ocean',
      colors: { Background: '#0f1c2b' },
      tabs: { movies: true, tv: true, tvSeasons: true, animeSeasons: true, albums: true, songs: false, games: true, books: true },
      compareAsk: 'Only when I start it',
      compareStyle: 'Swap the numbers',
      compareRoom: 'Give the same score',
      compareWindow: 1.5,
    });
    expect(p.warnings.find((w) => w.tab === 'Settings')!).toMatchObject({ row: 15 });
    expect(p.warnings.find((w) => w.tab === 'Settings')!.message).toMatch(/Highlight/);
  });
});

describe('parseWorkbook edge cases', () => {
  const H = ['Cover', 'Rating', 'Title', 'Genres', 'Director', 'Notes', 'Cover URL'];

  it('no recognised tabs: empty preview, null settings', async () => {
    const p = await parseRows([{ name: 'Whatever', rows: [['a', 'b'], [1, 2]] }]);
    expect(p).toEqual({ rows: [], counts: {}, skipped: [], warnings: [], settings: null });
  });

  it('finds a header row shifted down (rows 2-5) and reports 1-based sheet rows', async () => {
    const p = await parseRows([
      { name: 'Films', rows: [['My films'], [null], H, [null, 'x', 'Heat', '', '', '', '']] },
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.warnings).toEqual([{ tab: 'Films', row: 4, message: expect.stringMatching(/rating/i) }]);
  });

  it('two sheets of the same category import both and warn', async () => {
    const p = await parseRows([
      { name: 'Movies', rows: [H, [null, 8, 'Heat', '', '', '', '']] },
      { name: 'More Movies', rows: [H, [null, 7, 'Ronin', '', '', '', '']] },
    ]);
    expect(p.counts.movies).toBe(2);
    expect(p.warnings.some((w) => w.tab === 'More Movies' && /same|duplicate|already/i.test(w.message))).toBe(true);
  });

  it('is case/space insensitive on headers and tells TV from Anime', async () => {
    const p = await parseRows([
      { name: 'a', rows: [[' cover', 'RATING', ' title ', 'status', 'genres', 'season avg', 'notes', 'cover url'], [null, 5, 'Dark', 'dropped', '', null, '', '']] },
    ]);
    expect(p.rows[0]).toMatchObject({ category: 'tv', status: 'Dropped', rating: 5 });
  });

  it('rounds to 2 decimals with a warning; truncates over-long text with a warning', async () => {
    const p = await parseRows([
      { name: 'Movies', rows: [H, [null, 8.456, 'T'.repeat(400), 'g'.repeat(301), '', 'n'.repeat(5001), '']] },
    ]);
    const r = p.rows[0]!;
    expect(r.rating).toBe(8.46);
    expect(r.title).toHaveLength(300);
    expect(r.genres).toHaveLength(300);
    expect(r.notes).toHaveLength(5000);
    expect(p.warnings).toHaveLength(4);
  });

  it('does not warn when the rating is already at most 2 decimals; empty rating is silent', async () => {
    const p = await parseRows([
      { name: 'Movies', rows: [H, [null, 8.25, 'A', '', '', '', ''], [null, null, 'B', '', '', '', ''], [null, '  ', 'C', '', '', '', '']] },
    ]);
    expect(p.rows.map((r) => r.rating)).toEqual([8.25, null, null]);
    expect(p.warnings).toEqual([]);
  });

  it('settings: bad enum values and themes are dropped with a warning; compare window coerced', async () => {
    const p = await parseRows([
      {
        name: 'Settings',
        rows: [
          [null, 'Theme', 'Neon'],
          [null, 'Ask to compare', 'Sometimes'],
          [null, 'Re-rating style', 'Meet in the middle'],
          [null, 'Compare within', 'abc'],
          [null, 'Movies', 'TRUE'],
          [null, 'Books', 'no'],
        ],
      },
    ]);
    expect(p.settings).toEqual({ compareStyle: 'Meet in the middle', compareWindow: 1, tabs: { movies: true, books: false } });
    expect(p.warnings.map((w) => w.row).sort()).toEqual([1, 2]);
  });

  it('settings: compare window is capped at 10', async () => {
    const p = await parseRows([{ name: 'Settings', rows: [[null, 'Theme', 'Light'], [null, 'Compare within', 50]] }]);
    expect(p.settings).toEqual({ theme: 'Light', compareWindow: 10 });
  });

  it('season rows with no show are skipped; season rating parsed like entries', async () => {
    const p = await parseRows([
      { name: 'Anime', rows: [['Cover', 'Rating', 'Title', 'Status', 'Genres', 'Studio', 'Season Avg', 'Notes', 'Cover URL'], [null, 9, 'Naruto', '', '', '', null, '', '']] },
      { name: 'S', rows: [['Anime', 'Season / Part', 'Rating', 'Notes'], ['Naruto', 'S1', '9,5', ''], ['Naruto', 'S2', 12, ''], [null, 'S3', 5, '']] },
    ]);
    expect(p.rows[0]!.seasons).toEqual([
      { label: 'S1', rating: 9.5, notes: '' },
      { label: 'S2', rating: null, notes: '' },
    ]);
    expect(p.skipped).toEqual([{ tab: 'S', row: 4, reason: 'no matching show' }]);
    expect(p.warnings).toHaveLength(1);
  });

  it('type check: ImportRow shape', () => {
    const r: ImportRow = { category: 'movies', title: 'x', status: null, rating: null, genres: '', creator: '', album: '', coverUrl: '', notes: '' };
    expect(r.seasons).toBeUndefined();
  });
});
