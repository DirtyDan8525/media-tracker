import type { Entry } from '@media-tracker/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockFetch } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { COMPARE_QUEUE_KEY, dropFromQueue, useCompareQueue } from './compare';
import { entriesKey } from './entryCache';
import { saveEntryChange } from './entryMutations';


function entry(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id, userId: 'u1', category: 'anime', title: id, typedTitle: id, status: null, rating: 9, genres: '', creator: '',
    album: '', coverUrl: '', notes: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none',
    isPrivate: false, notesPrivate: false, source: null, sourceId: null, lookupState: 'ok', importId: null, seasonAvg: null, tier: null, priorMean: null, strength: null, scoreLocked: false,
    createdAt: '', updatedAt: '', ...over,
  };
}

const wrapperFor = (qc: ReturnType<typeof makeQueryClient>) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe('useCompareQueue / dropFromQueue', () => {
  it('returns the queue items', async () => {
    const qc = makeQueryClient();
    mockFetch({ 'GET /api/compare/queue': { body: { items: [{ entryId: 'e1', category: 'anime' }] } } });
    const { result } = renderHook(() => useCompareQueue(), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.data).toEqual([{ entryId: 'e1', category: 'anime' }]));
  });

  it('dropFromQueue deletes the row and refreshes the queue', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(COMPARE_QUEUE_KEY, [{ entryId: 'e1', category: 'anime' }]);
    const calls = mockFetch({
      'DELETE /api/compare/queue/:id': { status: 204 },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    // an active observer so the invalidation refetches
    renderHook(() => useCompareQueue(), { wrapper: wrapperFor(qc) });
    await dropFromQueue(qc, 'e1');
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/compare/queue/e1')).toBe(true);
    await waitFor(() => expect(qc.getQueryData(COMPARE_QUEUE_KEY)).toEqual([]));
  });
});

describe('queue invalidation after a rating save', () => {
  async function setup() {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [entry('e1')]);
    const calls = mockFetch({
      'PATCH /api/entries/:id': (b) => ({ body: entry('e1', b as Partial<Entry>) }),
      'GET /api/compare/queue': { body: { items: [] } },
    });
    renderHook(() => useCompareQueue(), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/compare/queue').length).toBe(1));
    return { qc, calls };
  }

  it('refetches the queue after a rating PATCH', async () => {
    const { qc, calls } = await setup();
    await saveEntryChange(qc, { id: 'e1', category: 'anime' }, { rating: 7 });
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/compare/queue').length).toBe(2));
  });

  it('does not refetch it after a notes PATCH', async () => {
    const { qc, calls } = await setup();
    await saveEntryChange(qc, { id: 'e1', category: 'anime' }, { notes: 'hi' });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.path === '/api/compare/queue').length).toBe(1);
  });
});

describe('saveEntryChange: a direct rating edit', () => {
  it('reloads the list and the rating set: the Worker re-fitted the neighbours', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [entry('e1'), entry('n', { rating: 9 })]);
    qc.setQueryData(['rating-set', 'anime'], { items: [], comparisons: [] });
    const calls = mockFetch({
      'PATCH /api/entries/:id': (b) => ({ body: entry('e1', b as Partial<Entry>) }),
      'GET /api/entries': { body: [entry('e1', { rating: 9.5 }), entry('n', { rating: 9.1 })] },
    });
    await saveEntryChange(qc, { id: 'e1', category: 'anime' }, { rating: 9.5 });
    await waitFor(() => expect(qc.getQueryData<Entry[]>(entriesKey('anime'))!.find((e) => e.id === 'n')!.rating).toBe(9.1));
    expect(calls.some((c) => c.path === '/api/entries?category=anime')).toBe(true);
    expect(qc.getQueryState(['rating-set', 'anime'])!.isInvalidated).toBe(true);
  });

  it('tier and lock edits reload too; a notes edit does not', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [entry('e1')]);
    const calls = mockFetch({
      'PATCH /api/entries/:id': (b) => ({ body: entry('e1', b as Partial<Entry>) }),
      'GET /api/entries': { body: [entry('e1')] },
    });
    await saveEntryChange(qc, { id: 'e1', category: 'anime' }, { notes: 'hi' });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.some((c) => c.method === 'GET')).toBe(false);
    await saveEntryChange(qc, { id: 'e1', category: 'anime' }, { tier: 2 });
    await saveEntryChange(qc, { id: 'e1', category: 'anime' }, { scoreLocked: true });
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/entries?category=anime').length).toBe(2));
  });
});
