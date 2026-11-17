import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PROGRESS_MAX, clampProgress, showsProgress } from '@media-tracker/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { DETAILS, fakeBackend, makeEntry } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const watching = (over = {}) => makeEntry({ id: 'p1', title: 'Frieren', status: 'Watching / In Progress', progress: 7, progressTotal: 24, ...over });
const progressPatches = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH' && c.path === '/api/entries/p1').map((c) => c.body as Record<string, unknown>);

describe('progress helpers', () => {
  it('clamps to 0..total, and 0..max with no total', () => {
    expect(clampProgress(-3, 24)).toBe(0);
    expect(clampProgress(30, 24)).toBe(24);
    expect(clampProgress(5, null)).toBe(5);
    expect(clampProgress(PROGRESS_MAX + 9, undefined)).toBe(PROGRESS_MAX);
  });
  it('shows only for anime, TV and manga while in progress or repeating', () => {
    expect(showsProgress({ category: 'anime', status: 'Watching / In Progress' })).toBe(true);
    expect(showsProgress({ category: 'manga', status: 'Rewatching' })).toBe(true);
    expect(showsProgress({ category: 'tv', status: 'Completed' })).toBe(false);
    expect(showsProgress({ category: 'games', status: 'Watching / In Progress' })).toBe(false);
    expect(showsProgress({ category: 'anime', status: null })).toBe(false);
  });
});

describe('progress on the PC table', () => {
  beforeEach(() => setViewportWidth(1024));

  it('shows "7 / 24" with named − and + buttons; only in-progress rows have them', async () => {
    fakeBackend({ entries: [watching(), makeEntry({ id: 'p2', title: 'Done', status: 'Completed', progress: 24, progressTotal: 24 })] });
    renderApp('/list/anime');
    expect(await screen.findByRole('columnheader', { name: 'Progress' })).toBeInTheDocument();
    expect(await screen.findByText('7 / 24')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease progress for Frieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase progress for Frieren' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Increase progress for Done' })).not.toBeInTheDocument();
  });

  it('shows just the count when the total is unknown', async () => {
    fakeBackend({ entries: [watching({ progress: 3, progressTotal: null })] });
    renderApp('/list/anime');
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('rapid taps show at once and are saved as one PATCH with the final count', async () => {
    const { calls } = fakeBackend({ entries: [watching()] });
    renderApp('/list/anime');
    const inc = await screen.findByRole('button', { name: 'Increase progress for Frieren' });
    await userEvent.click(inc); await userEvent.click(inc); await userEvent.click(inc);
    expect(screen.getByText('10 / 24')).toBeInTheDocument();
    await waitFor(() => expect(progressPatches(calls)).toEqual([{ progress: 10 }]));
  });

  it('clamps at 0 and at the total', async () => {
    fakeBackend({ entries: [watching({ progress: 0 }), watching({ id: 'p3', title: 'Full', progress: 24 })] });
    renderApp('/list/anime');
    expect(await screen.findByRole('button', { name: 'Decrease progress for Frieren' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase progress for Full' })).toBeDisabled();
  });

  it('rolls back and toasts when the save fails', async () => {
    fakeBackend({ entries: [watching()], patchFail: () => ({ status: 400, body: { error: 'invalid' } }) });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Increase progress for Frieren' }));
    expect(screen.getByText('8 / 24')).toBeInTheDocument();
    expect(await screen.findByText("Couldn't save that change")).toBeInTheDocument();
    expect(screen.getByText('7 / 24')).toBeInTheDocument();
  });

  it('offers "Mark as Completed" at the total; one tap sets Completed and the control goes away', async () => {
    const { calls } = fakeBackend({ entries: [watching({ progress: 23 })] });
    renderApp('/list/anime');
    expect(screen.queryByRole('button', { name: /Mark as Completed/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Increase progress for Frieren' }));
    const mark = await screen.findByRole('button', { name: 'Mark Frieren as Completed' });
    expect(screen.getByText('Finished?')).toBeInTheDocument();
    await userEvent.click(mark);
    await waitFor(() => expect(progressPatches(calls)).toContainEqual({ status: 'Completed' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Increase progress for Frieren' })).not.toBeInTheDocument());
  });
});

describe('progress on the title page (phone)', () => {
  beforeEach(() => setViewportWidth(390));

  it('has the same control and saves', async () => {
    const { calls } = fakeBackend({ entries: [watching()] });
    renderApp('/entry/p1');
    const tile = await screen.findByRole('group', { name: 'Progress' });
    await userEvent.click(within(tile).getByRole('button', { name: 'Increase progress for Frieren' }));
    await waitFor(() => expect(progressPatches(calls)).toEqual([{ progress: 8 }]));
  });

  it('is absent for a completed title or a movie-like list', async () => {
    fakeBackend({ entries: [watching({ status: 'Completed' })] });
    renderApp('/entry/p1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('group', { name: 'Progress' })).not.toBeInTheDocument();
  });

  it('lets the person type the total, clamping the count to it', async () => {
    const { calls } = fakeBackend({ entries: [watching({ progressTotal: null, progress: 9 })] });
    renderApp('/entry/p1');
    const f = await screen.findByLabelText('Total episodes');
    await userEvent.type(f, '5');
    await userEvent.tab();
    await waitFor(() => expect(progressPatches(calls)).toContainEqual({ progressTotal: 5, progress: 5 }));
  });
});

describe('lookup fills the total, never overwriting a typed one', () => {
  const withTotal = { ...DETAILS, progressTotal: 28 };
  const run = async (entry: ReturnType<typeof watching>) => {
    const { fillDetails } = await import('../lookup/details');
    const { makeQueryClient } = await import('../test/queryClient');
    const { calls } = fakeBackend({ entries: [entry], details: () => ({ body: { details: withTotal } }) });
    await fillDetails(makeQueryClient(), entry, { source: 'kitsu', sourceId: '1' });
    return progressPatches(calls)[0]!;
  };
  it('sends the looked-up total when the entry has none', async () => {
    expect(await run(watching({ progressTotal: null }))).toMatchObject({ progressTotal: 28 });
  });
  it('leaves a total that is already set (typed) alone', async () => {
    expect(await run(watching({ progressTotal: 12 }))).not.toHaveProperty('progressTotal');
  });
});
