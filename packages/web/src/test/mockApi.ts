import { DEFAULT_USER_SETTINGS, type UserSettings } from '@media-tracker/shared';
import { vi } from 'vitest';
import type { Me } from '../api/types';

export interface MockResponse { status?: number; body?: unknown }
export type Handler = (body: unknown, url: URL, params: Record<string, string>) => MockResponse | Promise<MockResponse>;

export interface Call { method: string; path: string; body: unknown; init: RequestInit | undefined }

function matchHandler(handlers: Record<string, Handler | MockResponse>, method: string, path: string): { h?: Handler | MockResponse; params: Record<string, string> } {
  const exact = handlers[`${method} ${path}`];
  if (exact !== undefined) return { h: exact, params: {} };
  // "PATCH /api/entries/:id" style keys
  for (const [key, h] of Object.entries(handlers)) {
    if (!key.includes(':')) continue;
    const [m, pattern] = key.split(' ') as [string, string];
    if (m !== method) continue;
    const names: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n: string) => { names.push(n); return '([^/]+)'; }) + '$');
    const hit = re.exec(path);
    if (hit) return { h, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1]!)])) };
  }
  return { params: {} };
}

/**
 * Stubs global fetch. `handlers` is keyed "METHOD /path" (no query string; ":name" segments match any value).
 * Unknown routes answer 404 {error:'not_found'}. Returns the list of calls made.
 */
export function mockFetch(handlers: Record<string, Handler | MockResponse>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    // Other hosts (AniList, called from the device) are unreachable unless a handler is keyed "METHOD https://host/path".
    if (url.origin !== 'http://localhost' && handlers[`${method} ${url.origin}${url.pathname}`] === undefined) throw new TypeError('Failed to fetch');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body, init });
    const { h, params } = matchHandler(handlers, method, url.origin === 'http://localhost' ? url.pathname : `${url.origin}${url.pathname}`);
    const res = h === undefined ? { status: 404, body: { error: 'not_found' } } : typeof h === 'function' ? await h(body, url, params) : h;
    const status = res.status ?? 200;
    return new Response(res.body === undefined || status === 204 ? null : JSON.stringify(res.body), {
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

/** A standard API: /api/me answers `me`, entries are empty, settings PUTs merge like the Worker (tabs, colors per key) and echo back. */
export function mockApi(me: Me, extra: Record<string, Handler | MockResponse> = {}): Call[] {
  let current = me;
  return mockFetch({
    'GET /api/me': () => ({ body: current }),
    'GET /api/entries': { body: [] },
    'PUT /api/me/settings': (b) => {
      const partial = (b as { settings: Partial<UserSettings> }).settings;
      current = { ...current, settings: { ...current.settings, ...partial, tabs: { ...current.settings.tabs, ...partial.tabs }, colors: { ...current.settings.colors, ...partial.colors } } };
      return { body: { settings: current.settings } };
    },
    ...extra,
  });
}
