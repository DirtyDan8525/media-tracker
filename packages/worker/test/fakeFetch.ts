/// <reference types="vite/client" />
// Test doubles for `fetch`. Adapter tests never touch the network: they serve
// either hand-picked fixture files (fakeFetch) or a recorded case (replayFetch).
import { stripUrl } from '../src/lookup/http';
import type { FixtureIndex, IndexEntry } from '../scripts/recordLib';

// Every file under test/fixtures, as raw text, keyed './fixtures/<path>'.
// Vite inlines these at transform time, so this works inside the Workers runtime.
const RAW = import.meta.glob(['./fixtures/**/*', '!./fixtures/**/*.md', '!./fixtures/cases.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Raw text of test/fixtures/<path>. Throws if there is no such fixture. */
export function fixture(path: string): string {
  const text = RAW[`./fixtures/${path}`];
  if (text === undefined) throw new Error(`no fixture file test/fixtures/${path}`);
  return text;
}

export interface FakeResponse {
  status?: number; // default 200
  file?: string; // fixture path relative to test/fixtures/
  body?: string; // literal body (when no file)
  contentType?: string; // default from the file extension, else application/json
  headers?: Record<string, string>; // extra response headers (e.g. Retry-After)
  hang?: boolean; // never answers; rejects with AbortError when the request's signal aborts
}

export type FakeFetch = typeof fetch & { calls: string[]; unmatched: string[] };

const NULL_BODY = new Set([101, 204, 205, 304]);

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function typeFor(path: string | undefined): string {
  if (path?.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path?.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/json';
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    if (!signal) return; // never settles
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function respond(status: number, body: string, contentType: string, headers: Record<string, string> = {}): Response {
  if (status === 0) throw new TypeError('Network connection lost.'); // recorded network failure
  return new Response(NULL_BODY.has(status) ? null : body, {
    status,
    headers: { 'content-type': contentType, ...headers },
  });
}

/**
 * A fetch that answers from `map`, matching the request URL by prefix (the
 * longest matching prefix wins). A string value is a fixture path relative to
 * test/fixtures/ (served with status 200), a number is a bare status with an
 * empty body. An unmatched URL throws (and is listed in `.unmatched`).
 */
export function fakeFetch(map: Record<string, string | number | FakeResponse>): FakeFetch {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const calls: string[] = [];
  const unmatched: string[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    calls.push(url);
    const key = keys.find((k) => url.startsWith(k));
    if (key === undefined) {
      unmatched.push(url);
      throw new Error(`fakeFetch: no response for ${url}`);
    }
    const v = map[key]!;
    if (typeof v === 'number') return respond(v, '', 'text/plain');
    if (typeof v === 'string') return respond(200, fixture(v), typeFor(v));
    if (v.hang) return hangUntilAborted(init?.signal ?? (input instanceof Request ? input.signal : undefined));
    const body = v.file !== undefined ? fixture(v.file) : (v.body ?? '');
    return respond(v.status ?? 200, body, v.contentType ?? typeFor(v.file), v.headers);
  };
  return Object.assign(f, { calls, unmatched }) as FakeFetch;
}

/**
 * A fetch serving a recorded index (URL -> entry, or entries in request order
 * when the same URL was requested more than once; the last one repeats).
 * Requests match by EXACT stripped URL, falling back to the longest recorded
 * URL that is a prefix. An unrecorded request throws with its URL and is listed
 * in `.unmatched`, so a test can assert that nothing went unanswered.
 */
export function replayFromIndex(index: FixtureIndex, read: (file: string) => string, label: string): FakeFetch {
  const queues = new Map<string, IndexEntry[]>();
  for (const [url, v] of Object.entries(index)) queues.set(url, Array.isArray(v) ? v : [v]);
  const served = new Map<string, number>();
  const byLength = [...queues.keys()].sort((a, b) => b.length - a.length);
  const calls: string[] = [];
  const unmatched: string[] = [];
  const f = async (input: RequestInfo | URL): Promise<Response> => {
    const url = stripUrl(urlOf(input));
    calls.push(url);
    const key = queues.has(url) ? url : byLength.find((k) => url.startsWith(k));
    if (key === undefined) {
      unmatched.push(url);
      throw new Error(`replayFetch(${label}): unrecorded request ${url}`);
    }
    const list = queues.get(key)!;
    const n = served.get(key) ?? 0;
    served.set(key, n + 1);
    const e = list[Math.min(n, list.length - 1)]!;
    return respond(e.status, e.file ? read(e.file) : '', e.contentType);
  };
  return Object.assign(f, { calls, unmatched }) as FakeFetch;
}

/** Whether test/fixtures/<source>/<caseName>/ has been recorded (lets a fixture test skip until then). */
export function hasFixtures(source: string, caseName: string): boolean {
  return RAW[`./fixtures/${source}/${caseName}/index.json`] !== undefined;
}

/** The request URLs recorded in test/fixtures/<source>/<caseName>/index.json ([] when the case isn't recorded). */
export function recordedUrls(source: string, caseName: string): string[] {
  const raw = RAW[`./fixtures/${source}/${caseName}/index.json`];
  return raw === undefined ? [] : Object.keys(JSON.parse(raw) as FixtureIndex);
}

/** Serves test/fixtures/<source>/<caseName>/ as recorded by scripts/record-fixtures.ts. */
export function replayFetch(source: string, caseName: string): FakeFetch {
  const dir = `${source}/${caseName}`;
  const index = JSON.parse(fixture(`${dir}/index.json`)) as FixtureIndex;
  return replayFromIndex(index, (file) => fixture(`${dir}/${file}`), dir);
}
