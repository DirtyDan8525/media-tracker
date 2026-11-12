import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/mockApi';
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

  it('on a 401 reloads to / so Access can sign in', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mockFetch({ 'GET /api/me': { status: 401, body: { error: 'unauthorized' } } });
    await expect(api.get('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(assign).toHaveBeenCalledWith('/');
  });
});
