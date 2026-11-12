import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import {
  envSecrets, fetchJson, fetchJsonMeta, fetchText, paced, redactSecrets, resetPacing, setPacingClock, stripUrl,
} from '../src/lookup/http';
import { CACHE_TTL_MS, getCached, putCached } from '../src/lookup/cache';
import type { LookupDeps } from '../src/lookup/sources/index';
import { fakeFetch, fixture, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });

afterEach(async () => {
  setPacingClock(null);
  resetPacing();
  await env.DB.exec('DELETE FROM lookup_cache');
});

describe('stripUrl / redactSecrets', () => {
  it('drops api_key, client_id, client_secret and access_token, keeping the rest in order', () => {
    expect(stripUrl('https://a.test/x?api_key=K&query=speed%20racer&client_id=I&client_secret=S&access_token=T&page=2'))
      .toBe('https://a.test/x?query=speed%20racer&page=2');
    expect(stripUrl('https://a.test/x?api_key=K')).toBe('https://a.test/x');
    expect(stripUrl('https://a.test/x?q=1')).toBe('https://a.test/x?q=1');
    expect(stripUrl('https://a.test/x')).toBe('https://a.test/x');
  });

  it('leaves similar-looking params alone and handles case', () => {
    expect(stripUrl('https://a.test/?my_api_key=1&API_KEY=2')).toBe('https://a.test/?my_api_key=1');
  });

  it('does not throw on a non-URL', () => {
    expect(stripUrl('not a url api_key=1')).toBe('not a url api_key=1'.replace(/api_key=1/, 'api_key=REDACTED'));
  });

  it('replaces longer secrets first, so a substring secret leaves nothing behind', () => {
    const out = redactSecrets('xxabcyy abc', ['abc', 'xxabcyy']);
    expect(out).toBe('REDACTED REDACTED');
    for (const frag of ['xx', 'yy', 'abc']) expect(out).not.toContain(frag);
  });

  it('skips empty and whitespace-only secrets', () => {
    expect(redactSecrets('a b  c', ['', ' ', '  '])).toBe('a b  c');
  });

  it('replaces each secret value', () => {
    expect(redactSecrets('a KEY1 b KEY2 KEY1', ['KEY1', 'KEY2', ''])).toBe('a REDACTED b REDACTED REDACTED');
  });

  it('envSecrets lists the non-empty key values', () => {
    expect(envSecrets({ TMDB_KEY: 'a', IGDB_ID: 'b', IGDB_SECRET: '', DEV_EMAIL: 'x@y' } as unknown as Env).sort()).toEqual(['a', 'b']);
  });
});

describe('fetchJson', () => {
  it('parses a 200 and logs the scrubbed URL with the status', async () => {
    const d = deps(fakeFetch({ 'https://a.test/': { body: '{"x":1}' } }));
    expect(await fetchJson('https://a.test/q?api_key=SECRET1&q=a', {}, d)).toEqual({ status: 200, body: { x: 1 } });
    expect(d.log).toHaveLength(1);
    expect(d.log[0]).toContain('https://a.test/q?q=a');
    expect(d.log[0]).toContain('200');
    expect(d.log[0]).not.toContain('SECRET1');
  });

  it('non-2xx: status plus the parsed body, or null when it is not JSON', async () => {
    const d = deps(fakeFetch({ 'https://a.test/j': { status: 429, body: '{"e":"slow"}' }, 'https://a.test/t': { status: 500, body: '<html>' } }));
    expect(await fetchJson('https://a.test/j', {}, d)).toEqual({ status: 429, body: { e: 'slow' } });
    expect(await fetchJson('https://a.test/t', {}, d)).toEqual({ status: 500, body: null });
  });

  it('2xx with bad JSON: {0, null} and "bad json" in the log', async () => {
    const d = deps(fakeFetch({ 'https://a.test/': { body: '<html>nope' } }));
    expect(await fetchJson('https://a.test/', {}, d)).toEqual({ status: 0, body: null });
    expect(d.log.join()).toContain('bad json');
  });

  it('network error: {0, null} and "network" in the log', async () => {
    const d = deps(fakeFetch({}));
    expect(await fetchJson('https://nowhere.test/?api_key=SECRET2', {}, d)).toEqual({ status: 0, body: null });
    expect(d.log.join()).toContain('network');
    expect(d.log.join()).not.toContain('SECRET2');
  });

  it('timeout: aborts, {0, null}, "timeout" in the log', async () => {
    const f = fakeFetch({ 'https://slow.test/': { hang: true } });
    const d = deps(f);
    const t0 = Date.now();
    expect(await fetchJson('https://slow.test/', {}, d, { timeoutMs: 30 })).toEqual({ status: 0, body: null });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(d.log.join()).toContain('timeout');
  });

  it('passes method, headers and body through', async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen = init;
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    await fetchJson('https://a.test/', { method: 'POST', headers: { 'Client-ID': 'cid' }, body: 'fields *;' }, deps(f));
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('fields *;');
    expect(new Headers(seen?.headers).get('Client-ID')).toBe('cid');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it('works without a log array', async () => {
    const d: LookupDeps = { fetch: fakeFetch({}), env: env as Env };
    expect(await fetchJson('https://a.test/', {}, d)).toEqual({ status: 0, body: null });
  });
});

describe('fetchJsonMeta', () => {
  it('reports Retry-After as whole seconds, null when absent or a date', async () => {
    const d = deps(fakeFetch({
      'https://a.test/n': { status: 429, body: '{}', headers: { 'Retry-After': '7' } },
      'https://a.test/d': { status: 429, body: '{}', headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } },
      'https://a.test/x': { body: '{"x":1}' },
    }));
    expect(await fetchJsonMeta('https://a.test/n', {}, d)).toEqual({ status: 429, body: {}, retryAfterSec: 7 });
    expect((await fetchJsonMeta('https://a.test/d', {}, d)).retryAfterSec).toBeNull();
    expect(await fetchJsonMeta('https://a.test/x', {}, d)).toEqual({ status: 200, body: { x: 1 }, retryAfterSec: null });
  });
});

describe('fetchText', () => {
  it('returns the text, any status', async () => {
    const d = deps(fakeFetch({ 'https://p.test/ok': { body: '<html>hi</html>', contentType: 'text/html' }, 'https://p.test/gone': 404 }));
    expect(await fetchText('https://p.test/ok', {}, d)).toEqual({ status: 200, body: '<html>hi</html>' });
    expect(await fetchText('https://p.test/gone', {}, d)).toEqual({ status: 404, body: '' });
  });

  it('timeout and network errors come back as {0, null}', async () => {
    const d = deps(fakeFetch({ 'https://slow.test/': { hang: true } }));
    expect(await fetchText('https://slow.test/', {}, d, { timeoutMs: 20 })).toEqual({ status: 0, body: null });
    expect(await fetchText('https://none.test/', {}, d)).toEqual({ status: 0, body: null });
    expect(d.log.join('\n')).toMatch(/timeout[\s\S]*network/);
  });
});

describe('paced', () => {
  const clock = () => {
    let now = 1000;
    const sleeps: number[] = [];
    setPacingClock({ now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    return { sleeps, advance: (ms: number) => { now += ms; }, get now() { return now; } };
  };

  it('the first call runs at once; a second within the gap waits the remainder', async () => {
    const c = clock();
    expect(await paced('anilist', 700, async () => 'a')).toBe('a');
    expect(c.sleeps).toEqual([]);
    c.advance(200);
    await paced('anilist', 700, async () => 'b');
    expect(c.sleeps).toEqual([500]);
  });

  it('no wait once the gap has passed; sources are independent', async () => {
    const c = clock();
    await paced('anilist', 700, async () => 1);
    await paced('tmdb', 700, async () => 1);
    c.advance(800);
    await paced('anilist', 700, async () => 1);
    expect(c.sleeps).toEqual([]);
  });

  it('concurrent callers are spaced out one gap apart', async () => {
    // All three arrive at t=1000; each reserves the next slot before sleeping.
    const sleeps: number[] = [];
    setPacingClock({ now: () => 1000, sleep: async (ms) => { sleeps.push(ms); } });
    const ran: number[] = [];
    await Promise.all([1, 2, 3].map((i) => paced('steam', 100, async () => { ran.push(i); })));
    expect(sleeps).toEqual([100, 200]);
    expect(ran.sort()).toEqual([1, 2, 3]);
  });

  it('a rejecting fn still counts as a start and the error propagates', async () => {
    const c = clock();
    await expect(paced('wiki', 50, async () => { throw new Error('x'); })).rejects.toThrow('x');
    await paced('wiki', 50, async () => 1);
    expect(c.sleeps).toEqual([50]);
  });
});

describe('lookup_cache helpers', () => {
  it('round-trips a value', async () => {
    await putCached(env.DB, 'chain:movies', 'k', { title: 'T' });
    expect(await getCached(env.DB, 'chain:movies', 'k')).toEqual({ title: 'T' });
    expect(await getCached(env.DB, 'chain:movies', 'other')).toBeNull();
    expect(await getCached(env.DB, 'chain:tv', 'k')).toBeNull();
  });

  it('overwrites an existing row', async () => {
    await putCached(env.DB, 's', 'k', { v: 1 });
    await putCached(env.DB, 's', 'k', { v: 2 });
    expect(await getCached(env.DB, 's', 'k')).toEqual({ v: 2 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM lookup_cache').first<{ n: number }>())!.n).toBe(1);
  });

  it('TTL is 30 days', async () => {
    expect(CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const ins = (key: string, ageMs: number) => env.DB.prepare('INSERT INTO lookup_cache VALUES (?, ?, ?, ?)')
      .bind('s', key, '{"v":1}', new Date(Date.now() - ageMs).toISOString()).run();
    await ins('old', CACHE_TTL_MS + 60_000);
    await ins('young', CACHE_TTL_MS - 60_000);
    expect(await getCached(env.DB, 's', 'old')).toBeNull();
    expect(await getCached(env.DB, 's', 'young')).toEqual({ v: 1 });
  });

  it('a corrupt row reads as a miss', async () => {
    await env.DB.prepare('INSERT INTO lookup_cache VALUES (?, ?, ?, ?)').bind('s', 'bad', '{nope', new Date().toISOString()).run();
    expect(await getCached(env.DB, 's', 'bad')).toBeNull();
  });
});

describe('test doubles', () => {
  it('fakeFetch: longest prefix wins; numbers are bare statuses; unmatched throws', async () => {
    const f = fakeFetch({ 'https://a.test/': 404, 'https://a.test/x': '_stub/tmdb-movie-123.json' });
    expect((await f('https://a.test/x/1')).status).toBe(200);
    expect(((await (await f('https://a.test/x/1')).json()) as { id: number }).id).toBe(123);
    expect((await f('https://a.test/y')).status).toBe(404);
    await expect(f('https://b.test/')).rejects.toThrow('https://b.test/');
    expect(f.unmatched).toEqual(['https://b.test/']);
    expect(f.calls).toHaveLength(4);
  });

  it('replayFetch: exact stripped URL, repeats in order, prefix fallback, loud on unrecorded', async () => {
    const f = replayFetch('_stub', 'replay-demo');
    expect(await (await f('https://api.example.test/search?q=frieren&api_key=zzz')).json()).toEqual({ hits: 1 });
    expect((await f('https://api.example.test/rate')).status).toBe(429);
    expect((await f('https://api.example.test/rate')).status).toBe(200);
    expect((await f('https://api.example.test/rate')).status).toBe(200);
    const page = await f('https://page.example.test/album/abc?si=1');
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>Album</title>');
    await expect(f('https://api.example.test/other')).rejects.toThrow(/unrecorded request https:\/\/api\.example\.test\/other/);
    expect(f.unmatched).toEqual(['https://api.example.test/other']);
  });

  it('fixture() reads raw files and fails on a missing one', () => {
    expect(JSON.parse(fixture('_stub/tmdb-movie-123.json')).runtime).toBe(135);
    expect(() => fixture('_stub/nope.json')).toThrow('nope.json');
  });
});
