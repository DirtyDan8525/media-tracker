import type { Entry } from '@media-tracker/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { localDb } from '../db/local';
import { mockFetch } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { writeEntry } from './entryCache';
import { refreshCategories, useAllEntries, useEntries } from './useEntries';

function entry(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id, userId: 'u1', category: 'anime', title: id, typedTitle: id, status: null, rating: 9, genres: '', creator: '',
    album: '', coverUrl: '', notes: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none',
    isPrivate: false, notesPrivate: false, source: null, sourceId: null, lookupState: 'ok', importId: null, seasonAvg: null, tier: null, priorMean: null, strength: null, scoreLocked: false,
    createdAt: '', updatedAt: '', ...over,
  };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
);

describe('useEntries', () => {
  it('fetches the category and writes the rows back to localDb, replacing stale ones', async () => {
    await localDb.entries.bulkPut([entry('old'), entry('m1', { category: 'movies' })]);
    const calls = mockFetch({ 'GET /api/entries': { body: [entry('a1'), entry('a2')] } });
    const { result } = renderHook(() => useEntries('anime'), { wrapper });
    await waitFor(() => expect(result.current.data?.map((e) => e.id)).toEqual(['a1', 'a2']));
    expect(result.current.isPlaceholderData).toBe(false);
    expect(calls[0]!.path).toBe('/api/entries?category=anime');
    await waitFor(async () => expect((await localDb.entries.toArray()).map((e) => e.id).sort()).toEqual(['a1', 'a2', 'm1']));
  });

  it('shows the cached rows while the network is pending', async () => {
    await localDb.entries.bulkPut([entry('c1'), entry('c2')]);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { result } = renderHook(() => useEntries('anime'), { wrapper });
    await waitFor(() => expect(result.current.data?.map((e) => e.id).sort()).toEqual(['c1', 'c2']));
  });

  it('falls back to the cache when offline', async () => {
    await localDb.entries.bulkPut([entry('c1')]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { result } = renderHook(() => useEntries('anime'), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.data?.map((e) => e.id)).toEqual(['c1']);
  });

  it('useAllEntries returns every requested list from the cache before the network answers', async () => {
    await localDb.entries.bulkPut([entry('a1'), entry('m1', { category: 'movies' })]);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { result } = renderHook(() => useAllEntries(['anime', 'movies']), { wrapper });
    await waitFor(() => {
      expect(result.current.data.anime?.map((e) => e.id)).toEqual(['a1']);
      expect(result.current.data.movies?.map((e) => e.id)).toEqual(['m1']);
    });
    expect(result.current.isPending).toBe(false);
  });

  it('normalizes pre-3c rows (cached and fetched): missing tier/priorMean/strength become null, scoreLocked false', async () => {
    const old = { ...entry('o1') } as Record<string, unknown>;
    delete old.tier; delete old.priorMean; delete old.strength; delete old.scoreLocked;
    await localDb.entries.bulkPut([old as unknown as Entry]);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const first = renderHook(() => useEntries('anime'), { wrapper });
    await waitFor(() => expect(first.result.current.data?.[0]?.id).toBe('o1'));
    expect(first.result.current.data![0]).toMatchObject({ tier: null, priorMean: null, strength: null, scoreLocked: false });
    mockFetch({ 'GET /api/entries': { body: [old] } });
    const second = renderHook(() => useEntries('anime'), { wrapper });
    await waitFor(() => expect(second.result.current.data && !second.result.current.isPlaceholderData).toBeTruthy());
    expect(second.result.current.data![0]).toMatchObject({ tier: null, priorMean: null, strength: null, scoreLocked: false });
  });
});

describe('refreshCategories', () => {
  it('normalizes the rows it stores (pre-3c rows read as unrated-tier)', async () => {
    const { tier: _t, priorMean: _p, strength: _s, scoreLocked: _l, ...old } = entry('old', { rating: 8 });
    mockFetch({ 'GET /api/entries': { body: [old] } });
    const qc = makeQueryClient();
    await refreshCategories(qc, ['anime']);
    expect(qc.getQueryData<Entry[]>(['entries', 'anime'])![0]).toMatchObject({ tier: null, priorMean: null, strength: null, scoreLocked: false });
    expect((await localDb.entries.get('old'))).toMatchObject({ tier: null, scoreLocked: false });
  });
});

describe('writeEntry → useAllEntries', () => {
  const setup = async () => {
    mockFetch({ 'GET /api/entries': { body: [entry('a1', { rating: 7 }), entry('a2')] } });
    const qc = makeQueryClient();
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useAllEntries(['anime', 'movies']), { wrapper: wrap });
    await waitFor(() => expect(hook.result.current.data.anime?.map((e) => e.id)).toEqual(['a1', 'a2']));
    return { qc, hook };
  };

  it('an edited entry replaces its row, and a new one is added, in the combined data and on the device', async () => {
    const { qc, hook } = await setup();
    act(() => writeEntry(qc, entry('a1', { rating: 9.5 })));
    await waitFor(() => expect(hook.result.current.data.anime!.find((e) => e.id === 'a1')!.rating).toBe(9.5));
    expect(hook.result.current.data.anime).toHaveLength(2);
    act(() => writeEntry(qc, entry('a3')));
    await waitFor(() => expect(hook.result.current.data.anime!.map((e) => e.id).sort()).toEqual(['a1', 'a2', 'a3']));
    await waitFor(async () => expect((await localDb.entries.get('a1'))?.rating).toBe(9.5));
  });

  it('replaceId swaps a temporary row for the saved one; persist:false stays out of the device DB', async () => {
    const { qc, hook } = await setup();
    act(() => writeEntry(qc, entry('tmp-1'), { persist: false }));
    await waitFor(() => expect(hook.result.current.data.anime!.map((e) => e.id)).toContain('tmp-1'));
    expect(await localDb.entries.get('tmp-1')).toBeUndefined();
    act(() => writeEntry(qc, entry('real-1'), { replaceId: 'tmp-1' }));
    await waitFor(() => expect(hook.result.current.data.anime!.map((e) => e.id).sort()).toEqual(['a1', 'a2', 'real-1']));
  });

  it('a write into another list reaches that list only', async () => {
    const { qc, hook } = await setup();
    await waitFor(() => expect(hook.result.current.data.movies).toBeDefined());
    act(() => writeEntry(qc, entry('m9', { category: 'movies' })));
    await waitFor(() => expect(hook.result.current.data.movies!.map((e) => e.id)).toContain('m9'));
    expect(hook.result.current.data.anime!.map((e) => e.id)).toEqual(['a1', 'a2']); // the mock serves the same rows to every list
  });
});
