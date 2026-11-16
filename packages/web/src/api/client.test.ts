import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/mockApi';
import { getAuthState } from './auth';
import { api, ApiError } from './client';

describe('api client', () => {
  it('sends credentials and JSON', async () => {
    const calls = mockFetch({ 'POST /api/things': (b) => ({ status: 201, body: { got: b } }) });
    await expect(api.post('/api/things', { a: 1 })).resolves.toEqual({ got: { a: 1 } });
    expect(calls[0]!.init?.credentials).toBe('same-origin');
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
    expect(calls.every((c) => c.init?.credentials === 'same-origin')).toBe(true);
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

});

describe('signed out (session ended)', () => {
  it('a 401 flags signed-out and throws', async () => {
    mockFetch({ 'GET /api/entries': { status: 401, body: { error: 'unauthorized' } } });
    await expect(api.get('/api/entries')).rejects.toMatchObject({ status: 401, error: 'unauthorized' });
    expect(getAuthState()).toBe('signedOut');
  });

  it('a 401 "removed" flags removed', async () => {
    mockFetch({ 'GET /api/me': { status: 401, body: { error: 'removed' } } });
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401, error: 'removed' });
    expect(getAuthState()).toBe('removed');
  });

  it('a 401 from /api/auth/* (wrong password) is just an error, not a signed-out signal', async () => {
    mockFetch({ 'POST /api/auth/login': { status: 401, body: { error: 'bad_credentials' } } });
    await expect(api.post('/api/auth/login', {})).rejects.toMatchObject({ status: 401, error: 'bad_credentials' });
    expect(getAuthState()).toBe('ok');
  });

  it('a 403 pending is an ordinary error', async () => {
    mockFetch({ 'GET /api/entries': { status: 403, body: { error: 'pending' } } });
    await expect(api.get('/api/entries')).rejects.toMatchObject({ status: 403, error: 'pending' });
    expect(getAuthState()).toBe('ok');
  });

  it('a network TypeError stays offline: rethrown, state unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.get('/api/me')).rejects.toBeInstanceOf(TypeError);
    expect(getAuthState()).toBe('ok');
  });
});
