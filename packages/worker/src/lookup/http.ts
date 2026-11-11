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

/** Replaces each (non-empty) secret value in `text` with REDACTED. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('REDACTED');
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

export interface FetchOpts {
  /** Abort the request (including reading the body) after this long. Default 8000. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 8000;

type Outcome = { ok: true; status: number; text: string } | { ok: false };

// One request with a timeout; reads the whole body as text. Never throws.
async function fetchRaw(url: string, init: RequestInit, d: LookupDeps, opts: FetchOpts | undefined): Promise<Outcome> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  init.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const method = (init.method ?? 'GET').toUpperCase();
  const shown = `${method} ${stripUrl(url)}`;
  try {
    const res = await d.fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    logLine(d, `${shown} → ${res.status}`);
    return { ok: true, status: res.status, text };
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
  const r = await fetchRaw(url, init, d, opts);
  if (!r.ok) return { status: 0, body: null };
  try {
    return { status: r.status, body: JSON.parse(r.text) as T };
  } catch {
    if (r.status >= 200 && r.status < 300) {
      logLine(d, `${stripUrl(url)} → bad json`);
      return { status: 0, body: null };
    }
    return { status: r.status, body: null };
  }
}

/** Like fetchJson but returns the body text (for HTML pages such as Spotify's). */
export async function fetchText(
  url: string,
  init: RequestInit,
  d: LookupDeps,
  opts?: FetchOpts,
): Promise<{ status: number; body: string | null }> {
  const r = await fetchRaw(url, init, d, opts);
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
