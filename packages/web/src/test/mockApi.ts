import { DEFAULT_USER_SETTINGS, type UserSettings } from '@media-tracker/shared';
import { vi } from 'vitest';
import type { Me } from '../api/types';

export interface MockResponse { status?: number; body?: unknown }
type Handler = (body: unknown, url: URL) => MockResponse | Promise<MockResponse>;

export interface Call { method: string; path: string; body: unknown; init: RequestInit | undefined }

/**
 * Stubs global fetch. `handlers` is keyed "METHOD /path" (no query string).
 * Unknown routes answer 404 {error:'not_found'}. Returns the list of calls made.
 */
export function mockFetch(handlers: Record<string, Handler | MockResponse>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body, init });
    const h = handlers[`${method} ${url.pathname}`];
    const res = h === undefined ? { status: 404, body: { error: 'not_found' } } : typeof h === 'function' ? await h(body, url) : h;
    const status = res.status ?? 200;
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status, headers: { 'content-type': 'application/json' },
    });
  }));
  return calls;
}

export function makeMe(over: Partial<Me> = {}, tabs: Partial<Record<string, boolean>> = {}): Me {
  const settings: UserSettings = {
    ...DEFAULT_USER_SETTINGS,
    tabs: { ...DEFAULT_USER_SETTINGS.tabs, ...tabs } as Record<string, boolean>,
  };
  return { id: 'u1', email: 'dan@example.com', username: 'dan', isAdmin: true, settings, ...over };
}

/** A standard API: /api/me answers `me`, entries are empty, settings/username PUTs echo back. */
export function mockApi(me: Me, extra: Record<string, Handler | MockResponse> = {}): Call[] {
  let current = me;
  return mockFetch({
    'GET /api/me': () => ({ body: current }),
    'GET /api/entries': { body: [] },
    'PUT /api/me/settings': (b) => {
      const partial = (b as { settings: Partial<UserSettings> }).settings;
      current = { ...current, settings: { ...current.settings, ...partial, tabs: { ...current.settings.tabs, ...partial.tabs } } };
      return { body: { settings: current.settings } };
    },
    ...extra,
  });
}
