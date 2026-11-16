import { DEFAULT_TIERS, type Entry, type SavePayload, type TierSet } from '@media-tracker/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as entryCache from './entryCache';

vi.mock('./entryCache', async (importOriginal) => {
  const m = await importOriginal<typeof import('./entryCache')>();
  return { ...m, writeEntry: vi.fn(m.writeEntry) };
});
import { localDb } from '../db/local';
import { makeEntry } from '../test/fakeBackend';
import { makeMe, mockFetch } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { COMPARE_QUEUE_KEY } from './compare';
import { entriesKey, entryKey } from './entryCache';
import { ratingSetKey, refetchAfterDelete, retryOnConflict, saveRatings, saveRatingsResult, saveTiers, useRatingSet } from './ratings';
import { ApiError } from '../api/client';
import { ME_KEY } from './useMe';

const payload: SavePayload = { picks: [{ winnerId: 'a', loserId: 'b', isTie: false, undone: false }], moves: [], done: ['a'] };
const setBody = { items: [], comparisons: [] };

describe('useRatingSet', () => {
  it('loads GET /api/ratings/:set under ratingSetKey, and not when disabled', async () => {
    const calls = mockFetch({ 'GET /api/ratings/anime': { body: setBody } });
    const qc = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    expect(ratingSetKey('anime')).toEqual(['rating-set', 'anime']);
    const { result } = renderHook(() => useRatingSet('anime'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(setBody));
    expect(calls[0]!.path).toBe('/api/ratings/anime');
    const off = renderHook(() => useRatingSet('movies', false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current.fetchStatus).toBe('idle');
    expect(calls).toHaveLength(1);
  });
});

describe('saveRatings', () => {
  it('writes returned entries and invalidates the set, queue and seasons', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'a', category: 'anime', rating: 9 })]);
    qc.setQueryData(ratingSetKey('anime'), setBody);
    qc.setQueryData(COMPARE_QUEUE_KEY, []);
    qc.setQueryData(['seasons', 'x'], []);
    const calls = mockFetch({
      'POST /api/ratings/anime/save': { body: { items: [], entries: [makeEntry({ id: 'a', category: 'anime', rating: 9.2, tier: 3 })] } },
      'GET /api/ratings/anime': { body: setBody },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveRatings(qc, 'anime', payload)).toBe(true);
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual(payload);
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.rating).toBe(9.2);
    expect(qc.getQueryState(ratingSetKey('anime'))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(COMPARE_QUEUE_KEY)!.isInvalidated).toBe(true);
    // a list set does not touch seasons
    expect(qc.getQueryState(['seasons', 'x'])!.isInvalidated).toBe(false);
  });

  it('a season save invalidates seasons and refreshes the parent entry (entries: [])', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'p', category: 'anime', seasonAvg: 5 })]);
    qc.setQueryData(entryKey('p'), makeEntry({ id: 'p', category: 'anime', seasonAvg: 5 }));
    qc.setQueryData(['seasons', 'p'], []);
    const calls = mockFetch({
      'POST /api/ratings/anime_seasons/save': { body: { items: [], entries: [] } },
      'GET /api/entries': { body: [makeEntry({ id: 'p', category: 'anime', seasonAvg: 8.1 })] },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveRatings(qc, 'anime_seasons', payload)).toBe(true);
    expect(qc.getQueryState(['seasons', 'p'])!.isInvalidated).toBe(true);
    expect(calls.some((c) => c.path === '/api/entries?category=anime')).toBe(true);
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.seasonAvg).toBe(8.1);
  });

  it('on 409 reloads the set and retries once, then succeeds', async () => {
    const qc = makeQueryClient();
    let posts = 0;
    const calls = mockFetch({
      'POST /api/ratings/anime/save': () => (++posts === 1 ? { status: 409, body: { error: 'conflict' } } : { body: { items: [], entries: [] } }),
      'GET /api/ratings/anime': { body: setBody },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveRatings(qc, 'anime', payload)).toBe(true);
    const order = calls.filter((c) => c.path.startsWith('/api/ratings/')).map((c) => `${c.method} ${c.path}`);
    expect(order.slice(0, 3)).toEqual(['POST /api/ratings/anime/save', 'GET /api/ratings/anime', 'POST /api/ratings/anime/save']);
    expect(posts).toBe(2);
  });

  it('on a second 409 gives up (false) after exactly two attempts', async () => {
    const qc = makeQueryClient();
    let posts = 0;
    mockFetch({
      'POST /api/ratings/anime/save': () => { posts++; return { status: 409, body: { error: 'conflict' } }; },
      'GET /api/ratings/anime': { body: setBody },
    });
    expect(await saveRatings(qc, 'anime', payload)).toBe(false);
    expect(posts).toBe(2);
  });

  it('other failures return false without retrying', async () => {
    const qc = makeQueryClient();
    let posts = 0;
    mockFetch({ 'POST /api/ratings/anime/save': () => { posts++; return { status: 500, body: { error: 'x' } }; } });
    expect(await saveRatings(qc, 'anime', payload)).toBe(false);
    expect(posts).toBe(1);
  });
});

describe('saveTiers', () => {
  const mine: TierSet = { names: ['a', 'b', 'c', 'd'], bounds: [5, 7, 8.5] };
  it('writes returned entries and settings, and invalidates the list and season sets', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(ME_KEY, makeMe());
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'a', category: 'anime', rating: 9 })]);
    qc.setQueryData(ratingSetKey('anime'), setBody);
    qc.setQueryData(ratingSetKey('anime_seasons'), setBody);
    const me = makeMe();
    const calls = mockFetch({
      'PUT /api/ratings/tiers/anime': { body: { settings: { ...me.settings, tiers: { anime: mine } }, entries: [makeEntry({ id: 'a', category: 'anime', rating: 8.7 })] } },
      'GET /api/ratings/anime': { body: setBody },
      'GET /api/ratings/anime_seasons': { body: setBody },
    });
    expect(await saveTiers(qc, 'anime', mine)).toBe(true);
    expect(calls[0]!.body).toEqual({ tiers: mine });
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.rating).toBe(8.7);
    expect(qc.getQueryData<ReturnType<typeof makeMe>>(ME_KEY)!.settings.tiers).toEqual({ anime: mine });
    expect(qc.getQueryState(ratingSetKey('anime'))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(ratingSetKey('anime_seasons'))!.isInvalidated).toBe(true);
    expect((await localDb.me.get('me'))?.value.settings.tiers).toEqual({ anime: mine });
  });

  it('null resets to the defaults; failure returns false', async () => {
    const qc = makeQueryClient();
    const calls = mockFetch({ 'PUT /api/ratings/tiers/movies': { status: 400, body: { error: 'invalid' } } });
    expect(await saveTiers(qc, 'movies', null)).toBe(false);
    expect(calls[0]!.body).toEqual({ tiers: null });
    expect(DEFAULT_TIERS.bounds).toEqual([6, 7.5, 9]);
  });
});

describe('refetchAfterDelete', () => {
  it('an entry delete (204) refetches the list and the set', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'a', category: 'anime' }), makeEntry({ id: 'b', category: 'anime', rating: 9.37 })]);
    qc.setQueryData(ratingSetKey('anime'), setBody);
    mockFetch({ 'GET /api/entries': { body: [makeEntry({ id: 'b', category: 'anime', rating: 9.4 })] } });
    await refetchAfterDelete(qc, { kind: 'entry', category: 'anime' });
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))!.map((e) => e.rating)).toEqual([9.4]);
    expect(qc.getQueryState(ratingSetKey('anime'))!.isInvalidated).toBe(true);
  });

  it('an entry delete also takes its seasons with it: the season set reloads', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(ratingSetKey('anime_seasons'), setBody);
    mockFetch({ 'GET /api/entries': { body: [] } });
    await refetchAfterDelete(qc, { kind: 'entry', category: 'anime' });
    expect(qc.getQueryState(ratingSetKey('anime_seasons'))!.isInvalidated).toBe(true);
  });

  it('a season delete refetches the season set, seasons and the parent entry average', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('tv'), [makeEntry({ id: 'p', category: 'tv', seasonAvg: 9 })]);
    qc.setQueryData(entryKey('p'), makeEntry({ id: 'p', category: 'tv', seasonAvg: 9 }));
    qc.setQueryData(ratingSetKey('tv_seasons'), setBody);
    qc.setQueryData(['seasons', 'p'], []);
    const calls = mockFetch({ 'GET /api/entries': { body: [makeEntry({ id: 'p', category: 'tv', seasonAvg: 7 })] } });
    await refetchAfterDelete(qc, { kind: 'season', category: 'tv', entryId: 'p' });
    expect(calls.some((c) => c.path === '/api/entries?category=tv')).toBe(true);
    expect(qc.getQueryData<Entry[]>(entriesKey('tv'))![0]!.seasonAvg).toBe(7);
    expect(qc.getQueryState(ratingSetKey('tv_seasons'))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(['seasons', 'p'])!.isInvalidated).toBe(true);
    expect(qc.getQueryState(entryKey('p'))!.isInvalidated).toBe(true);
  });
});

describe('saveRatingsResult', () => {
  it('tells a conflict that survived the retry apart from other failures', async () => {
    const qc = makeQueryClient();
    mockFetch({
      'POST /api/ratings/anime/save': { status: 409, body: { error: 'conflict' } },
      'GET /api/ratings/anime': { body: setBody },
    });
    expect(await saveRatingsResult(qc, 'anime', payload)).toBe('conflict');
    mockFetch({ 'POST /api/ratings/anime/save': { status: 500, body: { error: 'x' } } });
    expect(await saveRatingsResult(qc, 'anime', payload)).toBe('failed');
    mockFetch({ 'POST /api/ratings/anime/save': { body: { items: [], entries: [] } }, 'GET /api/compare/queue': { body: { items: [] } } });
    expect(await saveRatingsResult(qc, 'anime', payload)).toBe('ok');
  });
});

describe('retryOnConflict', () => {
  it('runs a write once more after a 409, and passes other errors through', async () => {
    let n = 0;
    expect(await retryOnConflict(async () => { if (++n === 1) throw new ApiError(409, 'conflict'); return 'done'; })).toBe('done');
    expect(n).toBe(2);
    n = 0;
    await expect(retryOnConflict(async () => { n++; throw new ApiError(500, 'x'); })).rejects.toThrow(ApiError);
    expect(n).toBe(1);
  });
});

describe('Task 10 review fixes', () => {
  it('saveTiers on a list with seasons also reloads the seasons and the parent list (season averages)', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(ME_KEY, makeMe());
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'p', category: 'anime', seasonAvg: 9 })]);
    qc.setQueryData(['seasons', 'p'], []);
    const me = makeMe();
    const calls = mockFetch({
      'PUT /api/ratings/tiers/anime': { body: { settings: me.settings, entries: [] } },
      'GET /api/entries': { body: [makeEntry({ id: 'p', category: 'anime', seasonAvg: 8.6 })] },
    });
    expect(await saveTiers(qc, 'anime', null)).toBe(true);
    expect(qc.getQueryState(['seasons', 'p'])!.isInvalidated).toBe(true);
    expect(calls.some((c) => c.path === '/api/entries?category=anime')).toBe(true);
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.seasonAvg).toBe(8.6);
  });

  it('saveTiers on a list without seasons leaves seasons alone', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(ME_KEY, makeMe());
    qc.setQueryData(['seasons', 'x'], []);
    const calls = mockFetch({ 'PUT /api/ratings/tiers/movies': { body: { settings: makeMe().settings, entries: [] } } });
    expect(await saveTiers(qc, 'movies', null)).toBe(true);
    expect(qc.getQueryState(['seasons', 'x'])!.isInvalidated).toBe(false);
    expect(calls.some((c) => c.path.startsWith('/api/entries'))).toBe(false);
  });

  it('a 409 refreshes the list too, so rows changed on another device are not stale', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'other', category: 'anime', rating: 8 })]);
    let posts = 0;
    mockFetch({
      'POST /api/ratings/anime/save': () => (++posts === 1 ? { status: 409, body: { error: 'conflict' } } : { body: { items: [], entries: [] } }),
      'GET /api/ratings/anime': { body: setBody },
      'GET /api/entries': { body: [makeEntry({ id: 'other', category: 'anime', rating: 8.4 })] },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveRatings(qc, 'anime', payload)).toBe(true);
    await waitFor(() => expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.rating).toBe(8.4));
  });

  it('a 409 reloads the list before the retry, so a late reload can not overwrite the retry\'s rows', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'other', category: 'anime', rating: 8 })]);
    let posts = 0;
    let stored = 8;
    mockFetch({
      'POST /api/ratings/anime/save': () => {
        if (++posts === 1) return { status: 409, body: { error: 'conflict' } };
        stored = 8.5; // the Worker's re-fit
        return { body: { items: [], entries: [makeEntry({ id: 'other', category: 'anime', rating: 8.5 })] } };
      },
      'GET /api/ratings/anime': { body: setBody },
      // the reload answers with what the Worker held when it was asked, and slowly
      'GET /api/entries': async () => {
        const rating = stored;
        await new Promise((r) => setTimeout(r, 40));
        return { body: [makeEntry({ id: 'other', category: 'anime', rating })] };
      },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveRatings(qc, 'anime', payload)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.rating).toBe(8.5);
  });

  it('a 409 that fails again still refreshes the list', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('anime'), [makeEntry({ id: 'other', category: 'anime', rating: 8 })]);
    mockFetch({
      'POST /api/ratings/anime/save': { status: 409, body: { error: 'conflict' } },
      'GET /api/ratings/anime': { body: setBody },
      'GET /api/entries': { body: [makeEntry({ id: 'other', category: 'anime', rating: 8.4 })] },
    });
    expect(await saveRatingsResult(qc, 'anime', payload)).toBe('conflict');
    await waitFor(() => expect(qc.getQueryData<Entry[]>(entriesKey('anime'))![0]!.rating).toBe(8.4));
  });

  it('a season-set 409 refreshes the parent list', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(entriesKey('tv'), [makeEntry({ id: 'p', category: 'tv', seasonAvg: 9 })]);
    mockFetch({
      'POST /api/ratings/tv_seasons/save': { status: 409, body: { error: 'conflict' } },
      'GET /api/ratings/tv_seasons': { body: setBody },
      'GET /api/entries': { body: [makeEntry({ id: 'p', category: 'tv', seasonAvg: 7 })] },
    });
    expect(await saveRatingsResult(qc, 'tv_seasons', payload)).toBe('conflict');
    await waitFor(() => expect(qc.getQueryData<Entry[]>(entriesKey('tv'))![0]!.seasonAvg).toBe(7));
  });

  it('a cache-write error after a successful save does not report failure', async () => {
    const qc = makeQueryClient();
    vi.mocked(entryCache.writeEntry).mockImplementationOnce(() => { throw new Error('cache'); });
    mockFetch({
      'POST /api/ratings/anime/save': { body: { items: [], entries: [makeEntry({ id: 'a', category: 'anime', rating: 9.2 })] } },
      'GET /api/compare/queue': { body: { items: [] } },
    });
    expect(await saveRatingsResult(qc, 'anime', payload)).toBe('ok');
  });
});
