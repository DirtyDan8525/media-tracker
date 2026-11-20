import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { localDb } from '../db/local';
import { CURRENT_LIST_KEY } from '../shell/currentList';
import { mockFetch } from '../test/mockApi';
import { AFTER_SETUP_KEY } from './social';
import { LOGOUT_DEADLINE_MS, LOGOUT_REDIRECT, logOut, STEP_TIMEOUT_MS } from './logout';

function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

describe('logOut', () => {
  it('posts /api/auth/logout, then reloads the app at /', async () => {
    const assign = stubLocation();
    const calls = mockFetch({ 'POST /api/auth/logout': { status: 204 } });
    await logOut(new QueryClient());
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/auth/logout']);
    expect(LOGOUT_REDIRECT).toBe('/');
    expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('still clears and reloads when the logout request fails', async () => {
    const assign = stubLocation();
    mockFetch({ 'POST /api/auth/logout': { status: 500, body: { error: 'x' } } });
    await localDb.me.put({ key: 'me', value: { id: 'u1' } as never });
    await logOut(new QueryClient());
    expect(await localDb.me.count()).toBe(0);
    expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('clears entries and me tables, the query cache, the remembered return path and mt-current-list, then reloads at /', async () => {
    const assign = stubLocation();
    await localDb.entries.put({ id: 'e1', category: 'anime', title: 'X', rating: 5 } as never);
    await localDb.me.put({ key: 'me', value: { id: 'u1' } as never });
    sessionStorage.setItem(AFTER_SETUP_KEY, '/add/x');
    localStorage.setItem(CURRENT_LIST_KEY, 'movies');
    const qc = new QueryClient();
    qc.setQueryData(['me'], { id: 'u1' });

    await logOut(qc);

    expect(await localDb.entries.count()).toBe(0);
    expect(await localDb.me.count()).toBe(0);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(sessionStorage.getItem(AFTER_SETUP_KEY)).toBeNull();
    expect(localStorage.getItem(CURRENT_LIST_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('still assigns when Dexie clear throws, and clears what it can', async () => {
    const assign = stubLocation();
    vi.spyOn(localDb.entries, 'clear').mockRejectedValue(new Error('IndexedDB is unavailable'));
    await localDb.me.put({ key: 'me', value: { id: 'u1' } as never });
    localStorage.setItem(CURRENT_LIST_KEY, 'movies');
    const qc = new QueryClient();
    qc.setQueryData(['me'], { id: 'u1' });

    await logOut(qc);

    expect(await localDb.me.count()).toBe(0);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(localStorage.getItem(CURRENT_LIST_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('still assigns when storage itself throws', async () => {
    const assign = stubLocation();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    await logOut(new QueryClient());
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('a Dexie clear() that never settles does not stall the logout: each step has a timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const assign = stubLocation();
      vi.spyOn(localDb.entries, 'clear').mockReturnValue(new Promise(() => {}) as never);
      vi.spyOn(localDb.me, 'clear').mockResolvedValue(undefined as never);
      localStorage.setItem(CURRENT_LIST_KEY, 'movies');
      const done = logOut(new QueryClient());
      await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS + 10);
      await done;
      expect(localStorage.getItem(CURRENT_LIST_KEY)).toBeNull();
      expect(assign).toHaveBeenCalledExactlyOnceWith('/');
    } finally {
      vi.useRealTimers();
    }
  });

  it('several hanging steps are cut by one overall deadline, not 2 s each; later sync clean-up still runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const assign = stubLocation();
      vi.spyOn(localDb.entries, 'clear').mockReturnValue(new Promise(() => {}) as never);
      vi.spyOn(localDb.me, 'clear').mockReturnValue(new Promise(() => {}) as never);
      mockFetch({ 'POST /api/auth/logout': { status: 204 } });
      vi.stubGlobal('fetch', () => new Promise(() => {}));
      localStorage.setItem(CURRENT_LIST_KEY, 'movies');
      const qc = new QueryClient();
      qc.cancelQueries = () => new Promise(() => {}) as never;
      const done = logOut(qc);
      await vi.advanceTimersByTimeAsync(LOGOUT_DEADLINE_MS + 50);
      await done; // four steps would take 8 s at 2 s each
      expect(localStorage.getItem(CURRENT_LIST_KEY)).toBeNull();
      expect(assign).toHaveBeenCalledExactlyOnceWith('/');
    } finally {
      vi.useRealTimers();
    }
  });
});
