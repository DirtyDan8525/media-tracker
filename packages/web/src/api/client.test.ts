import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/mockApi';
import { isSignedOut, REAUTH_FLAG, REAUTH_PATH } from './auth';
import { api, ApiError } from './client';

describe('api client', () => {
  it('sends credentials and JSON', async () => {
    const calls = mockFetch({ 'POST /api/things': (b) => ({ status: 201, body: { got: b } }) });
    await expect(api.post('/api/things', { a: 1 })).resolves.toEqual({ got: { a: 1 } });
    expect(calls[0]!.init?.credentials).toBe('include');
    expect(new Headers(calls[0]!.init?.headers).get('content-type')).toBe('application/json');
  });

  it('get, put, patch and del use the right methods', async () => {
    const calls = mockFetch({
      'GET /api/x': { body: [1] }, 'PUT /api/x': { body: {} }, 'PATCH /api/x': { body: {} }, 'DELETE /api/x': { status: 204 },
    });
    await api.get('/api/x');
    await api.put('/api/x', {});
    await api.patch('/api/x', {});
    await expect(api.del('/api/x')).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'PATCH', 'DELETE']);
    expect(calls.every((c) => c.init?.credentials === 'include')).toBe(true);
  });

  it('every mutation (including a bodyless DELETE) sends content-type: application/json; GET does not need to', async () => {
    const calls = mockFetch({
      'GET /api/x': { body: [1] }, 'POST /api/x': { body: {} }, 'PUT /api/x': { body: {} }, 'PATCH /api/x': { body: {} }, 'DELETE /api/x': { status: 204 },
    });
    await api.get('/api/x');
    await api.post('/api/x');
    await api.put('/api/x', {});
    await api.patch('/api/x', {});
    await api.del('/api/x');
    const type = (i: number) => new Headers(calls[i]!.init?.headers).get('content-type');
    expect([1, 2, 3, 4].map(type)).toEqual(Array(4).fill('application/json'));
    expect(calls[4]!.init?.body).toBeUndefined();
  });

  it('turns a JSON error into an ApiError', async () => {
    mockFetch({ 'PUT /api/me/username': { status: 409, body: { error: 'taken' } } });
    const err = await api.put('/api/me/username', { username: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, error: 'taken' });
  });

  it('a non-JSON error still becomes an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 502 })));
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 502, error: 'http_502' });
  });

  it('sends /api fetches with redirect: manual', async () => {
    const calls = mockFetch({ 'GET /api/x': { body: {} } });
    await api.get('/api/x');
    expect(calls[0]!.init?.redirect).toBe('manual');
  });
});

describe('signed out (Access session expired)', () => {
  const stubAssign = () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    return assign;
  };

  it('the first 401 navigates once to /api/auth/reauth and sets the session flag', async () => {
    const assign = stubAssign();
    mockFetch({ 'GET /api/me': { status: 401, body: { error: 'unauthorized' } } });
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401, error: 'unauthorized' });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(REAUTH_PATH);
    expect(sessionStorage.getItem(REAUTH_FLAG)).toBe('1');
    expect(isSignedOut()).toBe(false);
  });

  it('a second 401 in the same session does not navigate; it flags signed-out', async () => {
    const assign = stubAssign();
    sessionStorage.setItem(REAUTH_FLAG, '1');
    mockFetch({ 'GET /api/entries': { status: 401, body: { error: 'unauthorized' } } });
    await expect(api.get('/api/entries')).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
    expect(isSignedOut()).toBe(true);
  });

  it('an opaqueredirect (Access redirecting the fetch) is treated like a 401', async () => {
    const assign = stubAssign();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      type: 'opaqueredirect', status: 0, ok: false, text: async () => '',
    }) as unknown as Response));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith(REAUTH_PATH);
  });

  it('a network TypeError stays offline: rethrown, no navigation, no flag', async () => {
    const assign = stubAssign();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.get('/api/me')).rejects.toBeInstanceOf(TypeError);
    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(REAUTH_FLAG)).toBeNull();
    expect(isSignedOut()).toBe(false);
  });

  it('a successful /api/me clears the flag', async () => {
    sessionStorage.setItem(REAUTH_FLAG, '1');
    mockFetch({ 'GET /api/me': { body: { id: 'u1' } } });
    await api.get('/api/me');
    expect(sessionStorage.getItem(REAUTH_FLAG)).toBeNull();
  });

  it('other successful calls leave the flag alone', async () => {
    sessionStorage.setItem(REAUTH_FLAG, '1');
    mockFetch({ 'GET /api/entries': { body: [] } });
    await api.get('/api/entries');
    expect(sessionStorage.getItem(REAUTH_FLAG)).toBe('1');
  });
});
