// Runtime-neutral request helpers for the lookup code that runs in both the Worker and the
// browser (AniList is called from the device, because AniList blocks Cloudflare's IPs).
// Nothing here may import Worker-only types (Env, D1) or browser-only globals.

/** What the shared lookup code needs from its host. */
export interface FetchDeps {
  fetch: typeof fetch;
  /** When present, request and decision lines are appended here. */
  log?: string[];
}

/** Appends a line to the log (if one is being kept). */
export function logLine(d: { log?: string[] }, line: string): void {
  d.log?.push(line);
}

/**
 * Thrown when a source could not answer (network error, timeout, bad JSON, 429, 5xx, auth
 * failure). A source that answered "nothing here" returns null instead, so the details endpoint
 * can tell "failed, try again later" from "confirmed empty".
 */
export class SourceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFailure';
  }
}

/** True for a status that is a real answer: 2xx, or "no such item" (404/410). Anything else (0, 429, 5xx, 401...) is a failure. */
export const answeredStatus = (status: number): boolean => (status >= 200 && status < 300) || status === 404 || status === 410;

export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * GET/POST and parse JSON, plus the `Retry-After` header as whole seconds (null when absent or
 * not a plain number). Never throws: a timeout, network error, or a 2xx whose body isn't JSON
 * gives `{status: 0, body: null}` (and a log line). A non-2xx gives its status with the parsed
 * body, or null if that body isn't JSON; the caller decides what to do.
 */
export async function fetchJsonMeta<T>(
  url: string,
  init: RequestInit,
  d: FetchDeps,
  opts?: { timeoutMs?: number },
): Promise<{ status: number; body: T | null; retryAfterSec: number | null }> {
  const failed = { status: 0, body: null, retryAfterSec: null };
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const shown = `${(init.method ?? 'GET').toUpperCase()} ${url}`;
  let status: number;
  let text: string;
  let retryAfter: string | null;
  try {
    const res = await d.fetch(url, { ...init, headers, signal: ctrl.signal });
    text = await res.text();
    status = res.status;
    retryAfter = res.headers.get('retry-after');
    logLine(d, `${shown} → ${status}`);
  } catch (err) {
    if (ctrl.signal.aborted) logLine(d, `${shown} → timeout after ${timeoutMs} ms`);
    else logLine(d, `${shown} → network error: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return failed;
  } finally {
    clearTimeout(timer);
  }
  const ra = retryAfter?.trim() ?? '';
  const retryAfterSec = /^\d{1,6}$/.test(ra) ? Number(ra) : null;
  try {
    return { status, body: JSON.parse(text) as T, retryAfterSec };
  } catch {
    if (status >= 200 && status < 300) {
      logLine(d, `${shown} → bad json`);
      return failed;
    }
    return { status, body: null, retryAfterSec };
  }
}

// ---- pacing ---------------------------------------------------------------

export interface PacingClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: PacingClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
let clock: PacingClock = realClock;
// Next allowed start time per source, for this isolate (or this page).
const nextStart = new Map<string, number>();

/** Swap the clock (tests). `null` restores the real one. */
export function setPacingClock(c: PacingClock | null): void {
  clock = c ?? realClock;
}

/** Forget all pacing state (tests). */
export function resetPacing(): void {
  nextStart.clear();
}

/** Waits `ms` on the pacing clock (so tests can replace it). */
export function sleep(ms: number): Promise<void> {
  return clock.sleep(ms);
}

/**
 * Runs `fn` no sooner than `minGapMs` after the previous paced start for the
 * same source. Concurrent callers are spaced one gap apart: each reserves its
 * slot before waiting.
 */
export async function paced<T>(source: string, minGapMs: number, fn: () => Promise<T>): Promise<T> {
  const now = clock.now();
  const slot = Math.max(now, nextStart.get(source) ?? now);
  nextStart.set(source, slot + minGapMs);
  if (slot > now) await clock.sleep(slot - now);
  return fn();
}
