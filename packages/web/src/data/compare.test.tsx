import type { Entry } from '@media-tracker/shared';
import { COMPARE_SAVE_MAX_CHANGES } from '@media-tracker/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockFetch } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { COMPARE_QUEUE_KEY, dropFromQueue, saveCompareChanges, useCompareQueue } from './compare';
import { entriesKey } from './entryCache';
import { saveEntryChange } from './entryMutations';
import { setCompareEnabled } from '../test/flags';

beforeEach(() => setCompareEnabled(true)); // these exercise Compare, which is hidden in the real build

function entry(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id, userId: 'u1', category: 'anime', title: id, typedTitle: id, status: null, rating: 9, genres: '', creator: '',
    album: '', coverUrl: '', notes: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none',
    isPrivate: false, notesPrivate: false, source: null, sourceId: null, lookupState: 'ok', importId: null, seasonAvg: null,
    createdAt: '', updatedAt: '', ...over,
  };
}

describe('saveCompareChanges', () => {
  it('sends the changes and doneEntryId, then the cached list shows the new rating', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [entry('e1'), entry('e2')]);
    const calls = mockFetch({
      'POST /api/compare/save': { body: { updated: 1, entries: [entry('e1', { rating: 8.8 })] } },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveCompareChanges(qc, [{ id: 'e1', rating: 8.8 }], 'e2')).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/api/compare/save');
    expect(post.body).toEqual({ changes: [{ id: 'e1', rating: 8.8 }], doneEntryId: 'e2' });
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))!.find((e) => e.id === 'e1')!.rating).toBe(8.8);
  });

  it('omits doneEntryId when there is none', async () => {
    const qc = makeQueryClient();
    const calls = mockFetch({ 'POST /api/compare/save': { body: { updated: 0, entries: [] } } });
    await saveCompareChanges(qc, [{ id: 'e1', rating: 5 }]);
    expect(calls[0]!.body).toEqual({ changes: [{ id: 'e1', rating: 5 }] });
    expect('doneEntryId' in (calls[0]!.body as object)).toBe(false);
  });

  it('splits 2,500 changes into 1000 + 1000 + 500, doneEntryId only on the last', async () => {
    const qc = makeQueryClient();
    const calls = mockFetch({ 'POST /api/compare/save': { body: { updated: 0, entries: [] } } });
    const changes = Array.from({ length: 2500 }, (_, i) => ({ id: `id${i}`, rating: 5 }));
    expect(COMPARE_SAVE_MAX_CHANGES).toBe(1000);
    expect(await saveCompareChanges(qc, changes, 'done')).toBe(true);
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.body as { changes: unknown[]; doneEntryId?: string });
    expect(posts.map((p) => p.changes.length)).toEqual([1000, 1000, 500]);
    expect(posts.map((p) => p.doneEntryId)).toEqual([undefined, undefined, 'done']);
    expect(posts.slice(0, 2).every((p) => !('doneEntryId' in p))).toBe(true);
  });

  it('still sends doneEntryId when there are no changes', async () => {
    const qc = makeQueryClient();
    const calls = mockFetch({ 'POST /api/compare/save': { body: { updated: 0, entries: [] } } });
    expect(await saveCompareChanges(qc, [], 'done')).toBe(true);
    expect(calls[0]!.body).toEqual({ changes: [], doneEntryId: 'done' });
  });

  it('returns false on a 500 and leaves the cache unchanged', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [entry('e1')]);
    mockFetch({ 'POST /api/compare/save': { status: 500, body: { error: 'boom' } } });
    expect(await saveCompareChanges(qc, [{ id: 'e1', rating: 1 }], 'e1')).toBe(false);
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.rating).toBe(9);
  });
});

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
