import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category, ImportPreview, ImportRow } from '@media-tracker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWorkbook } from '../import/parseWorkbook';
import { DETAILS, fakeBackend, makeEntry, makeInfo } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { toArrayBuffer } from '../../test/helpers/buildWorkbook';

vi.mock('../import/parseWorkbook', async (importOriginal) => {
  const m = await importOriginal<typeof import('../import/parseWorkbook')>();
  return { ...m, parseWorkbook: vi.fn(m.parseWorkbook) };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const row = (i: number, over: Partial<ImportRow> = {}): ImportRow => ({
  category: 'anime', title: `Title ${i}`, status: null, rating: null, genres: '', creator: '', album: '', coverUrl: '', notes: '', ...over,
});
function preview(rows: ImportRow[], over: Partial<ImportPreview> = {}): ImportPreview {
  const counts: Partial<Record<Category, number>> = {};
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
  return { rows, counts, skipped: [], warnings: [], settings: null, ...over };
}
const sheet = (name = 'My Tracker.xlsx') => new File([new Uint8Array([1, 2, 3])], name);

async function choose(file: File) {
  await userEvent.upload(await screen.findByLabelText(/choose.*file/i), file);
}
async function chooseMock(p: ImportPreview) {
  vi.mocked(parseWorkbook).mockResolvedValueOnce(p);
  await choose(sheet());
}
const importPosts = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/import').map((c) => c.body as { importId: string; rows: ImportRow[] });
const idx = (calls: { method: string; path: string }[], method: string, path: string) =>
  calls.findIndex((c) => c.method === method && c.path === path);

/** A backend that stores the posted rows' count per importId, like the Worker. */
function importBackend(opts: { failPost?: (n: number) => boolean; entries?: ReturnType<typeof makeEntry>[] } = {}) {
  let n = 0;
  return fakeBackend({
    entries: opts.entries,
    extra: {
      'POST /api/import': (b) => {
        n++;
        if (opts.failPost?.(n)) return { status: 500, body: { error: 'boom' } };
        return { body: { inserted: (b as { rows: unknown[] }).rows.length } };
      },
      'DELETE /api/import/:id': { body: { deleted: 1 } },
    },
  });
}

describe('ImportScreen', () => {
  beforeEach(() => { vi.mocked(parseWorkbook).mockClear(); });

  it('previews the sample workbook: counts per category, the Settings line, warnings and skipped rows', async () => {
    importBackend();
    const buf = await readFile(join(process.cwd(), 'test/fixtures/sample-tracker.xlsx'));
    const expected = await vi.mocked(parseWorkbook).getMockImplementation()!(toArrayBuffer(new Uint8Array(buf)));
    renderApp('/import');
    await choose(new File([new Uint8Array(buf)], 'Dan Tracker.xlsx'));

    const region = await screen.findByRole('region', { name: 'What will be imported' });
    expect(within(region).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      ['Anime6', 'Movies2', 'TV Shows2', 'Albums1', 'Songs2', 'Games2', 'Books1'],
    );
    expect(screen.getByText('Dan Tracker.xlsx')).toBeInTheDocument();
    expect(within(region).getByText(/Ocean theme/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 16 titles' })).toBeInTheDocument();

    expect(expected.warnings.length).toBeGreaterThan(0);
    const warnings = screen.getByText(`${expected.warnings.length} warnings`);
    const w = expected.warnings[0]!;
    await userEvent.click(warnings);
    expect(warnings.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(`${w.tab}, row ${w.row}: ${w.message}`)).toBeInTheDocument();
    if (expected.skipped.length) {
      const s = expected.skipped[0]!;
      expect(screen.getByText(`${s.tab}, row ${s.row}: ${s.reason}`)).toBeInTheDocument();
    }
  });

  it('lists skipped rows with their tab, row and reason, and uses singular wording for one', async () => {
    importBackend();
    renderApp('/import');
    await chooseMock(preview([row(1)], {
      skipped: [{ tab: 'Anime Seasons', row: 4, reason: 'no matching show' }],
      warnings: [{ tab: 'Movies', row: 14, message: 'rating "11" isn\'t 0–10, imported as unrated' }],
    }));
    expect(await screen.findByText('1 row skipped')).toBeInTheDocument();
    expect(screen.getByText('Anime Seasons, row 4: no matching show')).toBeInTheDocument();
    expect(screen.getByText('1 warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 title' })).toBeInTheDocument();
  });

  it('shows a friendly message with the error detail when the file cannot be read, and lets you pick another', async () => {
    importBackend();
    renderApp('/import');
    vi.mocked(parseWorkbook).mockRejectedValueOnce(new Error('Invalid cell value: constructor'));
    await choose(sheet());
    expect(await screen.findByText("Couldn't read this file")).toBeInTheDocument();
    expect(screen.getByText(/Invalid cell value: constructor/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(await screen.findByLabelText(/choose.*file/i)).toBeInTheDocument();
    await chooseMock(preview([row(1), row(2)]));
    expect(await screen.findByRole('button', { name: 'Import 2 titles' })).toBeInTheDocument();
  });

  it('only accepts .xlsx files', async () => {
    importBackend();
    renderApp('/import');
    const input = await screen.findByLabelText(/choose.*file/i);
    expect(input).toHaveAttribute('accept', expect.stringContaining('.xlsx'));
    await userEvent.upload(input, new File(['a,b'], 'tracker.csv'), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent(/\.xlsx/);
    expect(parseWorkbook).not.toHaveBeenCalled();
  });

  it('sends 400 rows in chunks of at most 180 under one importId, then saves only the settings that were present', async () => {
    const { calls } = importBackend();
    renderApp('/import');
    await chooseMock(preview(Array.from({ length: 400 }, (_, i) => row(i)), { settings: { theme: 'Ocean', compareAsk: 'Off' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 400 titles' }));
    expect(await screen.findByText('Imported 400 titles')).toBeInTheDocument();

    const posts = importPosts(calls);
    expect(posts.map((p) => p.rows.length)).toEqual([180, 180, 40]);
    expect(new Set(posts.map((p) => p.importId)).size).toBe(1);
    expect(posts[0]!.importId).toMatch(UUID);
    const puts = calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings');
    expect(puts.map((c) => c.body)).toEqual([{ settings: { theme: 'Ocean', compareAsk: 'Off' } }]);
    expect(idx(calls, 'PUT', '/api/me/settings')).toBeGreaterThan(calls.map((c) => c.path).lastIndexOf('/api/import'));
  });

  it('does not touch settings when the file has none', async () => {
    const { calls } = importBackend();
    renderApp('/import');
    await chooseMock(preview([row(1)]));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 title' }));
    await screen.findByText('Imported 1 title');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('respects the seasons limit in every request', async () => {
    const { calls } = importBackend();
    renderApp('/import');
    const seasons = Array.from({ length: 10 }, (_, k) => ({ label: `S${k}`, rating: null, notes: '' }));
    await chooseMock(preview(Array.from({ length: 60 }, (_, i) => row(i, { seasons }))));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 60 titles' }));
    await screen.findByText('Imported 60 titles');
    const posts = importPosts(calls);
    expect(posts.length).toBeGreaterThan(2);
    for (const p of posts) expect(p.rows.reduce((n, r) => n + (r.seasons?.length ?? 0), 0)).toBeLessThanOrEqual(240);
    expect(posts.flatMap((p) => p.rows)).toHaveLength(60);
  });

  it('shows a progress bar while chunks are sent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fakeBackend({ extra: { 'POST /api/import': async (b) => { await gate; return { body: { inserted: (b as { rows: unknown[] }).rows.length } }; } } });
    renderApp('/import');
    await chooseMock(preview(Array.from({ length: 200 }, (_, i) => row(i))));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 200 titles' }));
    const bar = await screen.findByRole('progressbar', { name: 'Import progress' });
    expect(bar).toHaveAttribute('aria-valuemax', '200');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    release();
    expect(await screen.findByText('Imported 200 titles')).toBeInTheDocument();
  });

  it('stops on a failed chunk, shows what was imported, and Undo deletes everything under the importId', async () => {
    const { calls } = importBackend({ failPost: (n) => n === 2 });
    renderApp('/import');
    await chooseMock(preview(Array.from({ length: 400 }, (_, i) => row(i)), { settings: { theme: 'Ocean' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 400 titles' }));

    expect(await screen.findByText('Import stopped')).toBeInTheDocument();
    expect(screen.getByText(/180 of 400/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the rest again' })).toBeInTheDocument();
    expect(importPosts(calls)).toHaveLength(2); // stopped: no third chunk
    expect(calls.some((c) => c.method === 'PUT')).toBe(false); // settings only after the rows succeeded

    const importId = importPosts(calls)[0]!.importId;
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([`/api/import/${importId}`]);
  });

  it('"Try the rest again" resumes at the failed chunk under the same importId', async () => {
    const { calls } = importBackend({ failPost: (n) => n === 2 });
    renderApp('/import');
    await chooseMock(preview(Array.from({ length: 400 }, (_, i) => row(i)), { settings: { theme: 'Ocean' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 400 titles' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try the rest again' }));
    expect(await screen.findByText('Imported 400 titles')).toBeInTheDocument();
    const posts = importPosts(calls);
    expect(posts.map((p) => p.rows.length)).toEqual([180, 180, 180, 40]);
    expect(posts[2]!.rows[0]!.title).toBe(posts[1]!.rows[0]!.title);
    expect(new Set(posts.map((p) => p.importId)).size).toBe(1);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('Undo when the first chunk failed (nothing on the server, 404) still ends cleanly', async () => {
    const { calls } = fakeBackend({ extra: {
      'POST /api/import': { status: 500, body: { error: 'boom' } },
      'DELETE /api/import/:id': { status: 404, body: { error: 'not_found' } },
    } });
    renderApp('/import');
    await chooseMock(preview([row(1), row(2)]));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 titles' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('Undo on the done screen deletes the import and refreshes the lists', async () => {
    const { calls } = importBackend();
    renderApp('/import');
    await chooseMock(preview([row(1), row(2, { category: 'movies' })]));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 titles' }));
    await screen.findByText('Imported 2 titles');
    const before = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    const after = calls.slice(before);
    expect(after[0]).toMatchObject({ method: 'DELETE' });
    await waitFor(() => {
      const gets = calls.slice(before).filter((c) => c.method === 'GET').map((c) => c.path);
      expect(gets).toContain('/api/entries?category=anime');
      expect(gets).toContain('/api/entries?category=movies');
    });
  });

  it('refreshes the lists of the imported categories after a successful import', async () => {
    const { calls } = importBackend();
    renderApp('/import');
    await chooseMock(preview([row(1, { category: 'games' })]));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 title' }));
    await screen.findByText('Imported 1 title');
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/entries?category=games'));
  });

  it('the done screen offers to fill in details; Start runs the backfill, Not now dismisses', async () => {
    const entries = [makeEntry({ id: 'a1', title: 'Frieren', category: 'anime', creator: '' })];
    const { calls } = fakeBackend({
      entries,
      lookup: () => ({ body: { info: makeInfo({ title: 'Frieren' }) } }),
      details: () => ({ body: { details: DETAILS } }),
      extra: { 'POST /api/import': { body: { inserted: 1 } } },
    });
    renderApp('/import');
    await chooseMock(preview([row(1, { title: 'Frieren' })]));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 title' }));
    expect(await screen.findByText('Fill in details for 1 imported title?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/lookup')).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === '/api/entries/a1')).toBe(true));
  });

  it('Not now dismisses the prompt without starting', async () => {
    const { calls } = importBackend();
    renderApp('/import');
    await chooseMock(preview(Array.from({ length: 3 }, (_, i) => row(i))));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 titles' }));
    expect(await screen.findByText('Fill in details for 3 imported titles?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Fill in details for/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/lookup')).toBe(false);
  });
});
