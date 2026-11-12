// Unit tests for the fixture recorder's pure logic (scripts/recordLib.ts).
// The recorder's real network path can't run here (no lookup API is reachable);
// these cover everything it does to a response before writing it.
import { describe, expect, it } from 'vitest';
import {
  buildFixtureFiles, caseMode, createRecorder, detailsTarget, extFor, memoryD1, parseDevVars, redactBody, secretsFromVars, shouldReplaceFixtures, summarize, type Recorded,
} from '../scripts/recordLib';
import { getCached, putCached } from '../src/lookup/cache';
import { replayFromIndex } from './fakeFetch';

describe('parseDevVars', () => {
  it('reads KEY=value lines, quotes, export, comments and blanks', () => {
    const text = [
      '# comment',
      'DEV_EMAIL=dan@example.com',
      '',
      'TMDB_KEY="abc def"',
      "export IGDB_ID='id1'",
      'IGDB_SECRET = s3cr3t # trailing comment',
      '# TMDB_KEY=commented',
      'EMPTY=',
      'garbage line',
    ].join('\n');
    expect(parseDevVars(text)).toEqual({
      DEV_EMAIL: 'dan@example.com', TMDB_KEY: 'abc def', IGDB_ID: 'id1', IGDB_SECRET: 's3cr3t', EMPTY: '',
    });
  });

  it('handles CRLF', () => {
    expect(parseDevVars('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('secretsFromVars', () => {
  it('picks the key values (non-empty), not DEV_EMAIL', () => {
    expect(secretsFromVars({ DEV_EMAIL: 'd@e', TMDB_KEY: 't', IGDB_ID: 'i', IGDB_SECRET: 's', EMPTY_KEY: '' }).sort()).toEqual(['i', 's', 't']);
  });
});

describe('redactBody', () => {
  it('replaces secret values and token-ish JSON fields', () => {
    const body = '{"access_token":"tok123","expires_in":5000,"note":"key KEY9 here","client_secret": "cs"}';
    const out = redactBody(body, ['KEY9']);
    expect(out).toBe('{"access_token":"REDACTED","expires_in":5000,"note":"key REDACTED here","client_secret": "REDACTED"}');
  });
});

describe('extFor', () => {
  it.each([
    ['application/json', 'json'],
    ['application/json; charset=utf-8', 'json'],
    ['application/vnd.api+json', 'json'],
    ['text/html; charset=UTF-8', 'html'],
    ['text/plain', 'txt'],
    ['', 'txt'],
  ])('%s -> %s', (ct, ext) => expect(extFor(ct)).toBe(ext));
});

describe('createRecorder', () => {
  const SECRET = 'tmdb-secret-value';
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://id.twitch.tv/')) {
      return Response.json({ access_token: 'twitch-tok', expires_in: 1, token_type: 'bearer' });
    }
    if (url.includes('echo')) {
      return new Response(`auth was ${new Headers(init?.headers).get('Authorization')} and ${SECRET}`, {
        status: 403, headers: { 'content-type': 'text/plain' },
      });
    }
    return Response.json({ results: [{ title: 'Speed Racer' }], key: SECRET });
  }) as typeof fetch;

  it('records stripped URLs, statuses, content types and redacted bodies; never headers', async () => {
    const rec = createRecorder(base, [SECRET]);
    const res = await rec.fetch(`https://api.themoviedb.org/3/search/movie?api_key=${SECRET}&query=speed`);
    // The caller still gets the real, unredacted response.
    expect(await res.json()).toEqual({ results: [{ title: 'Speed Racer' }], key: SECRET });
    await rec.fetch('https://id.twitch.tv/oauth2/token?client_id=cid&client_secret=cs&grant_type=client_credentials', { method: 'POST' });
    await rec.fetch('https://x.test/echo', { headers: { Authorization: 'Bearer twitch-tok' } });

    expect(rec.records.map((r) => [r.method, r.url, r.status])).toEqual([
      ['GET', 'https://api.themoviedb.org/3/search/movie?query=speed', 200],
      ['POST', 'https://id.twitch.tv/oauth2/token?grant_type=client_credentials', 200],
      ['GET', 'https://x.test/echo', 403],
    ]);
    const all = JSON.stringify(rec.records);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('twitch-tok'); // a token seen in a response is redacted from later bodies too
    expect(all).not.toContain('cs');
    expect(rec.records[0]!.contentType).toContain('application/json');
    for (const r of rec.records) expect(Object.keys(r).sort()).toEqual(['body', 'contentType', 'method', 'status', 'url']);
  });

  it('a failing request is recorded as status 0 and rethrown', async () => {
    const boom = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    const rec = createRecorder(boom, []);
    await expect(rec.fetch('https://a.test/?api_key=1')).rejects.toThrow('offline');
    expect(rec.records).toEqual([{ method: 'GET', url: 'https://a.test/', status: 0, contentType: '', body: '' }]);
  });
});

describe('buildFixtureFiles', () => {
  const r = (url: string, status: number, body: string, contentType = 'application/json'): Recorded =>
    ({ url, method: 'GET', status, contentType, body });

  it('numbers files from 1 with an extension per type and builds the URL index', () => {
    const { files, index } = buildFixtureFiles([
      r('https://a.test/s?q=1', 200, '{"a":1}'),
      r('https://a.test/rate', 429, '{"e":1}'),
      r('https://a.test/rate', 200, '{"ok":1}'),
      r('https://p.test/album/x', 200, '<html>', 'text/html'),
      r('https://down.test/', 0, '', ''),
    ]);
    expect(files.map((f) => f.name)).toEqual(['1.json', '2.json', '3.json', '4.html', 'index.json']);
    expect(index).toEqual({
      'https://a.test/s?q=1': { file: '1.json', status: 200, contentType: 'application/json' },
      'https://a.test/rate': [
        { file: '2.json', status: 429, contentType: 'application/json' },
        { file: '3.json', status: 200, contentType: 'application/json' },
      ],
      'https://p.test/album/x': { file: '4.html', status: 200, contentType: 'text/html' },
      'https://down.test/': { file: '', status: 0, contentType: '' },
    });
    expect(JSON.parse(files.at(-1)!.content)).toEqual(index);
  });

  it('round-trips through replayFromIndex', async () => {
    const { files, index } = buildFixtureFiles([
      r('https://a.test/s?q=1', 200, '{"a":1}'),
      r('https://a.test/rate', 429, '{"e":1}'),
      r('https://a.test/rate', 200, '{"ok":1}'),
    ]);
    const byName = Object.fromEntries(files.map((f) => [f.name, f.content]));
    const f = replayFromIndex(index, (name) => byName[name]!, 'test');
    expect(await (await f('https://a.test/s?q=1&api_key=k')).json()).toEqual({ a: 1 });
    expect((await f('https://a.test/rate')).status).toBe(429);
    expect(await (await f('https://a.test/rate')).json()).toEqual({ ok: 1 });
  });
});

describe('summarize', () => {
  it('lists each case with its files and statuses; exit 0 when every case made requests', () => {
    const s = summarize([{ label: 'tmdb/speed-racer', records: [
      { url: 'u', method: 'GET', status: 200, contentType: 'application/json', body: '' },
      { url: 'v', method: 'GET', status: 404, contentType: 'text/plain', body: '' },
    ] }]);
    expect(s.exitCode).toBe(0);
    expect(s.lines.join('\n')).toContain('tmdb/speed-racer');
    expect(s.lines.join('\n')).toMatch(/1\.json.*200/);
    expect(s.lines.join('\n')).toMatch(/2\.txt.*404/);
  });

  it('non-zero exit when a case made zero requests or failed', () => {
    expect(summarize([{ label: 'a/b', records: [] }]).exitCode).toBe(1);
    expect(summarize([{ label: 'a/b', records: [], error: 'boom' }]).lines.join()).toContain('boom');
    const rec = { url: 'u', method: 'GET', status: 200, contentType: '', body: '' };
    expect(summarize([{ label: 'a/b', records: [rec], error: 'adapter threw' }]).exitCode).toBe(1);
  });
});

describe('memoryD1', () => {
  it('backs getCached/putCached like lookup_cache does', async () => {
    const db = memoryD1();
    expect(await getCached(db, 'igdb', '__token')).toBeNull();
    await putCached(db, 'igdb', '__token', { token: 't' });
    await putCached(db, 'igdb', '__token', { token: 'u' });
    expect(await getCached(db, 'igdb', '__token')).toEqual({ token: 'u' });
    expect(await getCached(db, 'igdb', 'other')).toBeNull();
  });

  it('throws on SQL it does not know', async () => {
    await expect(memoryD1().prepare('DELETE FROM users').bind().run()).rejects.toThrow('unsupported');
  });
});

describe('shouldReplaceFixtures', () => {
  const rec: Recorded = { url: 'u', method: 'GET', status: 200, contentType: '', body: '' };
  it('replaces only when the case finished without error and made at least one request', () => {
    expect(shouldReplaceFixtures({ label: 'a/b', records: [rec] })).toBe(true);
    expect(shouldReplaceFixtures({ label: 'a/b', records: [] })).toBe(false);
    expect(shouldReplaceFixtures({ label: 'a/b', records: [rec], error: 'adapter threw' })).toBe(false);
    expect(shouldReplaceFixtures({ label: 'a/b', records: [], error: 'not registered' })).toBe(false);
  });

  it('summary says when existing fixtures were kept', () => {
    expect(summarize([{ label: 'a/b', records: [rec], error: 'x' }]).lines.join('\n')).toContain('kept existing fixtures');
    expect(summarize([{ label: 'a/b', records: [rec] }]).lines.join('\n')).not.toContain('kept existing fixtures');
  });
});

describe('caseMode and detailsTarget (search-then-details cases)', () => {

  it('tells the case shapes apart', () => {
    expect(caseMode({ details: '154587' })).toBe('details');
    expect(caseMode({ detailsFromSearch: true })).toBe('search-then-details');
    expect(caseMode({ chain: true })).toBe('chain');
    expect(caseMode({})).toBe('search');
  });

  it('every shipped case has a valid shape and the details-from-search cases carry a query', async () => {
    const { CASES } = await import('./fixtures/cases');
    for (const c of CASES) {
      if (caseMode(c) === 'search-then-details') expect('query' in c && c.query.term).toBeTruthy();
      expect(`${c.source}/${c.case}`).toMatch(/^[a-z0-9]+\/[a-z0-9][a-z0-9_-]*$/i);
    }
    expect(CASES.filter((c) => caseMode(c) === 'search-then-details').map((c) => `${c.source}/${c.case}`).sort())
      .toEqual(['tmdb/details-speed-racer', 'wiki/details-speed-racer']);
  });

  it('detailsTarget returns the first result\'s sourceId, and throws when there is none', () => {
    expect(detailsTarget({ sourceId: 'Q5' })).toBe('Q5');
    expect(() => detailsTarget(null)).toThrow(/found nothing/);
    expect(() => detailsTarget({})).toThrow(/no sourceId/);
  });
});
