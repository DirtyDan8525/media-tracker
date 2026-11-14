import type { Entry } from '@media-tracker/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { localDb } from '../db/local';
import { mockFetch } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { useAllEntries, useEntries } from './useEntries';

function entry(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id, userId: 'u1', category: 'anime', title: id, typedTitle: id, status: null, rating: 9, genres: '', creator: '',
    album: '', coverUrl: '', notes: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none',
    isPrivate: false, notesPrivate: false, source: null, sourceId: null, lookupState: 'ok', importId: null, seasonAvg: null,
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
});
