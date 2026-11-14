// HTTP helpers for lookup sources: fetch with a timeout that never throws,
// per-source pacing, and the URL/secret scrubbing every log line goes through.
import type { SourceId } from '@media-tracker/shared';
import type { Env } from '../env';
import type { LookupDeps } from './sources/index';

/** Query params that carry credentials. Removed from every logged or recorded URL. */
export const SECRET_PARAMS: readonly string[] = ['api_key', 'client_id', 'client_secret', 'access_token'];

const SECRET_PARAM_RE = new RegExp(`\\b(${SECRET_PARAMS.join('|')})=[^&\\s#"']*`, 'gi');

/** Masks credential query params anywhere in free text (e.g. an error message quoting a URL). */
export function redactParams(text: string): string {
  return text.replace(SECRET_PARAM_RE, '$1=REDACTED');
}

/** `url` without credential query params (case-insensitive names). Never throws. */
export function stripUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return redactParams(url);
  }
  if (!u.search) return url;
  const kept = u.search
    .slice(1)
    .split('&')
    .filter((pair) => {
      const name = decodeURIComponentSafe(pair.split('=')[0] ?? '').toLowerCase();
      return pair !== '' && !SECRET_PARAMS.includes(name);
    });
  // Rebuild by hand so the kept params keep their original encoding.
  return `${u.origin}${u.pathname}${kept.length ? `?${kept.join('&')}` : ''}${u.hash}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Replaces each secret value in `text` with REDACTED, longest first (so a
 * secret that contains another is never half-replaced). Empty and
 * whitespace-only secrets are ignored.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  const ordered = [...new Set(secrets)].filter((s) => s.trim() !== '').sort((a, b) => b.length - a.length);
  let out = text;
  for (const s of ordered) out = out.split(s).join('REDACTED');
  return out;
}

/** The credential values in env (empty ones skipped). */
export function envSecrets(env: Env): string[] {
  return [env.TMDB_KEY, env.IGDB_ID, env.IGDB_SECRET].filter((v): v is string => typeof v === 'string' && v !== '');
}

/** Appends a line to the lookup log (if one is being kept), with credential params and env secrets scrubbed. */
export function logLine(d: LookupDeps, line: string): void {
  d.log?.push(redactSecrets(redactParams(line), envSecrets(d.env)));
}

/**
 * Thrown by a details adapter when its source could not answer (network error, timeout, bad JSON,
 * 429, 5xx, auth failure). A source that answered "nothing here" returns null instead, so the
 * endpoint can tell "failed, try again later" from "confirmed empty".
 */
export class SourceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFailure';
  }
}

// Results that came back incomplete because an optional extra call failed. The chain skips its cache
// write for them so a hiccup is not frozen in for 30 days. A WeakSet keeps the flag off the wire.
const degraded = new WeakSet<object>();

/** Marks a search result as degraded (never cached by the chain). Returns it. */
export function markDegraded<T extends object>(info: T): T {
  degraded.add(info);
  return info;
}

export const isDegraded = (info: object | null | undefined): boolean => !!info && degraded.has(info);

/** True for a status that is a real answer: 2xx, or "no such item" (404/410). Anything else (0, 429, 5xx, 401...) is a failure. */
export const answeredStatus = (status: number): boolean => (status >= 200 && status < 300) || status === 404 || status === 410;

/** Throws SourceFailure unless `status` is a real answer. */
export function assertAnswered(status: number, what: string): void {
  if (!answeredStatus(status)) throw new SourceFailure(`${what}: status ${status}`);
}

export interface FetchOpts {
  /** Abort the request (including reading the body) after this long. Default 8000. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 8000;

export const DEFAULT_USER_AGENT = 'MediaTrackerApp/1.0 (+https://github.com/DirtyDan8525/media-tracker)';

// Workers' fetch sends no User-Agent and some APIs (AniList) answer 403 without one. Fills in
// User-Agent and Accept only when the caller did not set them. Carries no secrets.
function withDefaultHeaders(init: RequestInit, accept: string): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', DEFAULT_USER_AGENT);
  if (!headers.has('Accept')) headers.set('Accept', accept);
  return { ...init, headers };
}

type Outcome = { ok: true; status: number; text: string; retryAfter: string | null } | { ok: false };

// One request with a timeout; reads the whole body as text. Never throws.
async function fetchRaw(url: string, init: RequestInit, d: LookupDeps, opts: FetchOpts | undefined, accept: string): Promise<Outcome> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  init.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const method = (init.method ?? 'GET').toUpperCase();
  const shown = `${method} ${stripUrl(url)}`;
  try {
    const res = await d.fetch(url, { ...withDefaultHeaders(init, accept), signal: ctrl.signal });
    const text = await res.text();
    logLine(d, `${shown} → ${res.status}`);
    return { ok: true, status: res.status, text, retryAfter: res.headers.get('retry-after') };
  } catch (err) {
    if (ctrl.signal.aborted) logLine(d, `${shown} → timeout after ${timeoutMs} ms`);
    else logLine(d, `${shown} → network error: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return { ok: false };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * GET/POST and parse JSON. Never throws: a timeout, network error, or a 2xx
 * whose body isn't JSON gives `{status: 0, body: null}` (and a log line saying
 * "timeout", "network" or "bad json"). A non-2xx gives its status with the
 * parsed body, or null if that body isn't JSON; the adapter decides what to do.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  d: LookupDeps,
  opts?: FetchOpts,
): Promise<{ status: number; body: T | null }> {
  const { status, body } = await fetchJsonMeta<T>(url, init, d, opts);
  return { status, body };
}

/** fetchJson plus the `Retry-After` header as whole seconds (null when absent or not a plain number). */
export async function fetchJsonMeta<T>(
  url: string,
  init: RequestInit,
  d: LookupDeps,
  opts?: FetchOpts,
): Promise<{ status: number; body: T | null; retryAfterSec: number | null }> {
  const r = await fetchRaw(url, init, d, opts, 'application/json');
  if (!r.ok) return { status: 0, body: null, retryAfterSec: null };
  const ra = r.retryAfter?.trim() ?? '';
  const retryAfterSec = /^\d{1,6}$/.test(ra) ? Number(ra) : null;
  try {
    return { status: r.status, body: JSON.parse(r.text) as T, retryAfterSec };
  } catch {
    if (r.status >= 200 && r.status < 300) {
      logLine(d, `${stripUrl(url)} → bad json`);
      return { status: 0, body: null, retryAfterSec: null };
    }
    return { status: r.status, body: null, retryAfterSec };
  }
}

/** Like fetchJson but returns the body text (for HTML pages such as Spotify's). */
export async function fetchText(
  url: string,
  init: RequestInit,
  d: LookupDeps,
  opts?: FetchOpts,
): Promise<{ status: number; body: string | null }> {
  const r = await fetchRaw(url, init, d, opts, 'text/html');
  return r.ok ? { status: r.status, body: r.text } : { status: 0, body: null };
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
// Next allowed start time per source, for this isolate.
const nextStart = new Map<SourceId, number>();

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
 * same source in this isolate. Concurrent callers are spaced one gap apart:
 * each reserves its slot before waiting.
 */
export async function paced<T>(source: SourceId, minGapMs: number, fn: () => Promise<T>): Promise<T> {
  const now = clock.now();
  const slot = Math.max(now, nextStart.get(source) ?? now);
  nextStart.set(source, slot + minGapMs);
  if (slot > now) await clock.sleep(slot - now);
  return fn();
}
