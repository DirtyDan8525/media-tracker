import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { REAUTH_FLAG } from '../api/auth';
import { localDb } from '../db/local';
import { CURRENT_LIST_KEY } from '../shell/currentList';
import { LOGOUT_PATH, logOut, STEP_TIMEOUT_MS } from './logout';

function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

describe('logOut', () => {
  it('uses the Cloudflare Access logout URL', () => {
    expect(LOGOUT_PATH).toBe('/cdn-cgi/access/logout');
  });

  it('clears entries and me tables, the query cache, mt-reauth and mt-current-list, then assigns LOGOUT_PATH', async () => {
    const assign = stubLocation();
    await localDb.entries.put({ id: 'e1', category: 'anime', title: 'X', rating: 5 } as never);
    await localDb.me.put({ key: 'me', value: { id: 'u1' } as never });
    sessionStorage.setItem(REAUTH_FLAG, '1');
    localStorage.setItem(CURRENT_LIST_KEY, 'movies');
    const qc = new QueryClient();
    qc.setQueryData(['me'], { id: 'u1' });

    await logOut(qc);

    expect(await localDb.entries.count()).toBe(0);
    expect(await localDb.me.count()).toBe(0);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(sessionStorage.getItem(REAUTH_FLAG)).toBeNull();
    expect(localStorage.getItem(CURRENT_LIST_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/cdn-cgi/access/logout');
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
    expect(assign).toHaveBeenCalledExactlyOnceWith('/cdn-cgi/access/logout');
  });

  it('still assigns when storage itself throws', async () => {
    const assign = stubLocation();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    await logOut(new QueryClient());
    expect(assign).toHaveBeenCalledWith('/cdn-cgi/access/logout');
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
      expect(assign).toHaveBeenCalledExactlyOnceWith('/cdn-cgi/access/logout');
    } finally {
      vi.useRealTimers();
    }
  });
});
