import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { getCached, putCached } from '../src/lookup/cache';
import { resetPacing, setPacingClock } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  TOKEN_KEY, TOKEN_SOURCE, details, formatDetails, igdbToken, pickGames, platformsOf, rankGames, search, searchBody, searchText, toInfo, unixDate,
  unixYear, type Game, type Scored,
} from '../src/lookup/sources/igdb';
import { buildFixtureFiles, createRecorder, memoryD1, secretsFromVars } from '../scripts/recordLib';
import { fakeFetch, hasFixtures, replayFetch, replayFromIndex, type FakeFetch } from './fakeFetch';

const TEST_ID = 'test-client-id-123';
const TEST_SECRET = 'test-client-secret-456';
const testEnv = { ...(env as Env), IGDB_ID: TEST_ID, IGDB_SECRET: TEST_SECRET } as Env;
const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: testEnv, log: [] });
const q = (term: string, typedTitle = term): LookupQuery => ({ term, typedTitle, hint: '', category: 'games' });

const TOKEN = 'https://id.twitch.tv/oauth2/token';
const API = 'https://api.igdb.com/v4/games';
const tokenBody = (tok: string, expiresIn = 5_000_000) => JSON.stringify({ access_token: tok, expires_in: expiresIn });
const unix = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

beforeEach(async () => {
  resetPacing();
  await env.DB.exec('DELETE FROM lookup_cache');
});
afterEach(() => setPacingClock(null));

// ---- logic tests: small synthetic inputs, not claims about IGDB's real payloads ----

describe('unixYear and unixDate (first_release_date, UTC)', () => {
  it('year and YYYY-MM-DD from Unix seconds', () => {
    expect(unixYear(unix(2017, 3, 3))).toBe('2017');
    expect(unixDate(unix(2017, 3, 3))).toBe('2017-03-03');
  });
  it('uses UTC at the year boundary', () => {
    expect(unixDate(unix(2017, 1, 1))).toBe('2017-01-01');
    expect(unixYear(unix(2017, 1, 1) - 1)).toBe('2016');
    expect(unixDate(unix(2017, 1, 1) - 1)).toBe('2016-12-31');
  });
  it('empty for missing, zero or unusable values', () => {
    for (const v of [undefined, null, 0, NaN, Infinity, 1e17]) {
      expect(unixYear(v as number)).toBe('');
      expect(unixDate(v as number)).toBe('');
    }
  });
});

describe('platformsOf', () => {
  const g = { platforms: [{ abbreviation: 'Wii U' }, { abbreviation: '' }, {}, { abbreviation: 'Switch' }, { abbreviation: 'PC' }, { abbreviation: 'PS5' }, { abbreviation: 'XSX' }] };
  it('up to 4 abbreviations, blanks skipped; the separator is the caller\'s', () => {
    expect(platformsOf(g, '/')).toBe('Wii U/Switch/PC/PS5');
    expect(platformsOf(g, ', ')).toBe('Wii U, Switch, PC, PS5');
  });
  it('empty without platforms', () => {
    expect(platformsOf({}, '/')).toBe('');
    expect(platformsOf({ platforms: null }, ', ')).toBe('');
  });
});

describe('searchText and searchBody (R32: one quoted string, no stray statements)', () => {
  it('strips double quotes, backslashes and semicolons', () => {
    expect(searchText('a"b\\c;d')).toBe('abcd');
    expect(searchText('  zelda  ')).toBe('zelda');
  });
  it('a hostile term still yields exactly one quoted string and the three expected statements', () => {
    const body = searchBody('x"; where id = 1; delete \\"; fields *');
    expect(body.match(/"/g)).toHaveLength(2);
    expect(body.split(';')).toHaveLength(4); // search; fields; limit; + the empty tail
    expect(body.startsWith('search "x where id = 1 delete  fields *"; fields name,')).toBe(true);
    expect(body.endsWith('; limit 25;')).toBe(true);
  });
  it('asks for the fields the script uses plus summary', () => {
    const body = searchBody('zelda');
    for (const f of ['name', 'first_release_date', 'cover.image_id', 'genres.name', 'involved_companies.company.name', 'involved_companies.developer',
      'platforms.abbreviation', 'summary', 'total_rating_count', 'version_parent', 'parent_game']) expect(body).toContain(f);
  });
});

describe('rankGames and pickGames (igdb_ scoring)', () => {
  const game = (id: number, name: string, extra: Partial<Game> = {}): Game => ({ id, name, ...extra });

  it('score = similarity + 0.15 x popularity rank (best-known first)', () => {
    const r = rankGames([game(1, 'Abcd', { total_rating_count: 50 }), game(2, 'Abcd', { total_rating_count: 100 }), game(3, 'Abcd')], 'abcd');
    expect(r.map((s) => s.g.id)).toEqual([2, 1, 3]);
    expect(r[0]!.score).toBeCloseTo(1.15, 5); // 1 + 0.15 * (1 - 0/3)
    expect(r[1]!.score).toBeCloseTo(1 + 0.15 * (1 - 1 / 3), 5);
    expect(r[2]!.score).toBeCloseTo(1 + 0.15 * (1 - 2 / 3), 5);
  });
  it('drops version_parent copies before ranking (and before counting)', () => {
    const r = rankGames([game(1, 'Abcd'), game(2, 'Abcd GOTY', { version_parent: 1 })], 'abcd');
    expect(r.map((s) => s.g.id)).toEqual([1]);
    expect(r[0]!.score).toBeCloseTo(1.15, 5); // 1 game: 1 - 0/1
  });
  it('+0.2 for the typed year against the release year, which is also reported', () => {
    const r = rankGames([game(1, 'Abcd', { first_release_date: unix(1999, 5, 5) }), game(2, 'Abcd', { first_release_date: unix(2017, 3, 3) })], 'Abcd (2017)');
    expect(r.map((s) => s.g.id)).toEqual([2, 1]);
    expect(r[0]!.y).toBe('2017');
    expect(r[0]!.score).toBeCloseTo(1 + 0.2 + 0.15 * (1 - 0 / 2), 5);
    expect(r[1]!.y).toBe('1999');
  });
  it('DLC and expansions (parent_game) lose 0.1', () => {
    const r = rankGames([game(1, 'Abcd', { parent_game: 9 }), game(2, 'Abcd')], 'abcd');
    expect(r.map((s) => s.g.id)).toEqual([2, 1]);
    expect(r[1]!.score).toBeCloseTo(1 - 0.1 + 0.15 * (1 - 0 / 2), 5);
  });
  it('no release date gives an empty year', () => {
    expect(rankGames([game(1, 'Abcd')], 'abcd')[0]!.y).toBe('');
  });

  const sc = (...scores: number[]): Scored[] => scores.map((score, i) => ({ g: game(i + 1, 'x'), y: '', score }));
  it('accepts 0.45 or more, rejects under it', () => {
    expect(pickGames(sc(0.44))).toBeNull();
    expect(pickGames(sc(0.45))?.map((s) => s.g.id)).toEqual([1]);
    expect(pickGames([])).toBeNull();
  });
  it('choices window 0.12 around the top, at most 8', () => {
    expect(pickGames(sc(1.0, 0.89, 0.88, 0.87))?.map((s) => s.g.id)).toEqual([1, 2, 3]);
    expect(pickGames(sc(1, 1, 1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(8);
  });
});

describe('toInfo', () => {
  const g: Game = {
    id: 7346, name: 'Zelda', cover: { image_id: 'co3p2d' }, genres: [{ name: 'Adventure' }, { name: 'RPG' }],
    involved_companies: [{ developer: false, company: { name: 'Publisher' } }, { developer: true, company: { name: 'Dev A' } }, { developer: true, company: { name: 'Dev B' } }],
    platforms: [{ abbreviation: 'Wii U' }, { abbreviation: 'Switch' }],
  };
  it('maps a game: sub is year · platforms joined "/" · developer; cover t_cover_big; sourceId is the game id', () => {
    expect(toInfo(g, '2017')).toEqual({
      title: 'Zelda', trusted: false, creator: 'Dev A, Dev B', genres: 'Adventure, RPG',
      cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.jpg', sub: '2017 · Wii U/Switch · Dev A, Dev B',
      source: 'igdb', sourceId: '7346',
    });
  });
  it('missing pieces are empty', () => {
    expect(toInfo({ id: 1, name: 'B' }, '')).toEqual({ title: 'B', trusted: false, creator: '', genres: '', cover: '', sub: '', source: 'igdb', sourceId: '1' });
  });
  it('caps developers at 3 and genres at 4', () => {
    const many: Game = {
      id: 2, name: 'C', genres: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name })),
      involved_companies: ['1', '2', '3', '4'].map((name) => ({ developer: true, company: { name } })),
    };
    expect(toInfo(many, '')).toMatchObject({ creator: '1, 2, 3', genres: 'a, b, c, d' });
  });
});

describe('formatDetails', () => {
  it('releaseDate (UTC), trimmed synopsis, platforms joined ", " (4 max), empty lengthLabel', () => {
    expect(formatDetails({
      id: 1, name: 'x', first_release_date: unix(2017, 3, 3), summary: 'A <b>big</b> world.',
      platforms: ['Wii U', 'Switch', 'PC', 'PS5', 'XSX'].map((abbreviation) => ({ abbreviation })),
    })).toEqual({ releaseDate: '2017-03-03', synopsis: 'A big world.', lengthLabel: '', origin: 'Wii U, Switch, PC, PS5' });
  });
  it('missing pieces are empty strings, never undefined/null', () => {
    expect(formatDetails({ id: 1, name: 'x' })).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
  });
  it('trims a long summary to 600 characters', () => {
    expect(formatDetails({ id: 1, name: 'x', summary: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });
});

describe('registration', () => {
  it('igdb is registered with search and details', () => {
    expect(typeof SOURCES.igdb?.search).toBe('function');
    expect(typeof SOURCES.igdb?.details).toBe('function');
  });
});

// ---- request tests ----

const games = JSON.stringify([
  { id: 7346, name: 'The Legend of Zelda: Breath of the Wild', first_release_date: unix(2017, 3, 3), cover: { image_id: 'abc' }, platforms: [{ abbreviation: 'Switch' }], total_rating_count: 90 },
  { id: 5, name: 'Zzzz Unrelated', total_rating_count: 1 },
]);

interface Seen { url: string; method: string; auth: string | null; clientId: string | null; contentType: string | null; body: string }

/** The API answers 401 unless the bearer token is `good`; everything else goes to a fakeFetch. */
function gated(good: string, apiBody: string, tokenFor = 'fresh-token', inner: FakeFetch = fakeFetch({ [TOKEN]: { body: tokenBody(tokenFor) }, [API]: { body: apiBody } })) {
  const seen: Seen[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    seen.push({ url, method: init?.method ?? 'GET', auth: h.get('authorization'), clientId: h.get('client-id'), contentType: h.get('content-type'), body: String(init?.body ?? '') });
    if (url.startsWith(API) && h.get('authorization') !== `Bearer ${good}`) return new Response('', { status: 401 });
    return inner(input, init);
  }) as typeof fetch;
  return Object.assign(f, { seen, tokenCalls: () => seen.filter((s) => s.url.startsWith(TOKEN)).length, apiCalls: () => seen.filter((s) => s.url.startsWith(API)) });
}

const seedToken = (token: string, expMs: number) => putCached(env.DB, TOKEN_SOURCE, TOKEN_KEY, { token, exp: expMs });

describe('igdb token (igdbToken_)', () => {
  it('requests a client-credentials token once, stores {token, exp} under igdb/__token, and reuses it', async () => {
    const f = fakeFetch({ [TOKEN]: { body: tokenBody('tok-one', 5_000_000) } });
    const before = Date.now();
    expect(await igdbToken(deps(f), false)).toBe('tok-one');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('grant_type=client_credentials');
    expect(f.calls[0]).toContain(`client_id=${TEST_ID}`);
    expect(f.calls[0]).toContain(`client_secret=${TEST_SECRET}`);
    const row = await env.DB.prepare('SELECT source, query_key, result_json FROM lookup_cache').first<{ source: string; query_key: string; result_json: string }>();
    expect(row?.source).toBe('igdb');
    expect(row?.query_key).toBe('__token');
    const stored = JSON.parse(row!.result_json) as { token: string; exp: number };
    expect(stored.token).toBe('tok-one');
    expect(stored.exp).toBeGreaterThanOrEqual(before + (5_000_000 - 3600) * 1000);
    expect(stored.exp).toBeLessThanOrEqual(Date.now() + (5_000_000 - 3600) * 1000);
    expect(await igdbToken(deps(f), false)).toBe('tok-one'); // cached
    expect(f.calls).toHaveLength(1);
  });
  it('an expired stored token is not used', async () => {
    await seedToken('old', Date.now() - 1000);
    const f = fakeFetch({ [TOKEN]: { body: tokenBody('new') } });
    expect(await igdbToken(deps(f), false)).toBe('new');
    expect(f.calls).toHaveLength(1);
  });
  it('forceNew ignores a valid stored token and replaces it', async () => {
    await seedToken('old', Date.now() + 3_600_000);
    const f = fakeFetch({ [TOKEN]: { body: tokenBody('new') } });
    expect(await igdbToken(deps(f), true)).toBe('new');
    expect((await getCached<{ token: string }>(env.DB, 'igdb', '__token'))?.token).toBe('new');
  });
  it('without IGDB_ID or IGDB_SECRET no request is made', async () => {
    const f = fakeFetch({});
    for (const e of [{ IGDB_ID: undefined }, { IGDB_SECRET: undefined }, { IGDB_ID: '' }]) {
      expect(await igdbToken({ fetch: f, env: { ...testEnv, ...e } as Env }, false)).toBe('');
    }
    expect(f.calls).toEqual([]);
  });
  it('a failed token request gives an empty token and stores nothing', async () => {
    for (const r of [500, { body: '{}' }, { body: 'not json' }, { body: JSON.stringify({ access_token: 5 }) }] as const) {
      expect(await igdbToken(deps(fakeFetch({ [TOKEN]: r })), false)).toBe('');
    }
    expect(await getCached(env.DB, 'igdb', '__token')).toBeNull();
  });
});

describe('igdb search requests', () => {
  it('one POST with the cached token, Client-ID, Accept and a text/plain body; Zelda is accepted and mapped', async () => {
    await seedToken('cached-tok', Date.now() + 3_600_000);
    const f = gated('cached-tok', games);
    const r = await search(q('breath of the wild'), deps(f));
    expect(f.tokenCalls()).toBe(0);
    const [call, ...rest] = f.apiCalls();
    expect(rest).toEqual([]);
    expect(call).toMatchObject({ method: 'POST', auth: 'Bearer cached-tok', clientId: TEST_ID });
    expect(call!.contentType).toContain('text/plain');
    expect(call!.body.startsWith('search "breath of the wild"; fields ')).toBe(true);
    expect(r).toMatchObject({ title: 'The Legend of Zelda: Breath of the Wild', sub: '2017 · Switch', source: 'igdb', sourceId: '7346' });
    expect(r?.cover).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg');
    expect(r?.choices).toBeUndefined();
  });
  it('the typed year is not part of the search text', async () => {
    await seedToken('t', Date.now() + 3_600_000);
    const f = gated('t', games);
    await search(q('Zelda (2017)'), deps(f));
    expect(f.apiCalls()[0]!.body.startsWith('search "Zelda"; ')).toBe(true);
  });
  it('close runners-up become choices', async () => {
    await seedToken('t', Date.now() + 3_600_000);
    const two = JSON.stringify([{ id: 1, name: 'Abcd', total_rating_count: 5 }, { id: 2, name: 'Abcd', total_rating_count: 4 }]);
    const r = await search(q('abcd'), deps(gated('t', two)));
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['1', '2']);
    expect(r?.choices?.every((c) => c.source === 'igdb' && c.choices === undefined)).toBe(true);
  });
  it('misses on an error status, an empty list, a weak match, or an empty search text', async () => {
    await seedToken('t', Date.now() + 3_600_000);
    expect(await search(q('zelda'), deps(fakeFetch({ [API]: 500 })))).toBeNull();
    expect(await search(q('zelda'), deps(fakeFetch({ [API]: { body: '[]' } })))).toBeNull();
    expect(await search(q('zelda'), deps(fakeFetch({ [API]: { body: JSON.stringify([{ id: 1, name: 'Zzzzzz' }]) } })))).toBeNull();
    const f = fakeFetch({});
    expect(await search(q('";\\'), deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('no token (token request fails): no API call, a miss', async () => {
    const f = fakeFetch({ [TOKEN]: 500 });
    expect(await search(q('zelda'), deps(f))).toBeNull();
    expect(f.calls).toHaveLength(1);
  });
});

describe('igdb 401 handling (igdbFetch_)', () => {
  it('a 401 refreshes the token exactly once and retries once with the new token', async () => {
    await seedToken('stale-tok', Date.now() + 3_600_000);
    const f = gated('fresh-token', games);
    const r = await search(q('breath of the wild'), deps(f));
    expect(r?.sourceId).toBe('7346');
    expect(f.tokenCalls()).toBe(1);
    expect(f.apiCalls().map((c) => c.auth)).toEqual(['Bearer stale-tok', 'Bearer fresh-token']);
    expect((await getCached<{ token: string }>(env.DB, 'igdb', '__token'))?.token).toBe('fresh-token');
    // the next lookup reuses the stored token: no token request, one API call
    await search(q('breath of the wild'), deps(f));
    expect(f.tokenCalls()).toBe(1);
    expect(f.apiCalls()).toHaveLength(3);
  });
  it('a second 401 is final: one refresh, two API calls, a miss', async () => {
    await seedToken('stale-tok', Date.now() + 3_600_000);
    const f = gated('never-valid', games);
    expect(await search(q('breath of the wild'), deps(f))).toBeNull();
    expect(f.tokenCalls()).toBe(1);
    expect(f.apiCalls()).toHaveLength(2);
  });
  it('every api.igdb.com call is paced 250 ms apart; the token request is not', async () => {
    await seedToken('stale-tok', Date.now() + 3_600_000);
    const sleeps: number[] = [];
    setPacingClock({ now: () => 1_000_000, sleep: async (ms) => { sleeps.push(ms); } });
    await search(q('breath of the wild'), deps(gated('fresh-token', games)));
    expect(sleeps).toEqual([250]); // 2 API calls: the second waits; the token call never waits
  });
});

describe('igdb secrets never reach the log or the result', () => {
  it('the debug log has no client id, client secret, token or Authorization header', async () => {
    const f = gated('tok-SECRET-value', games, 'tok-SECRET-value');
    const d = deps(f);
    const r = await search(q('breath of the wild'), d);
    expect(r).not.toBeNull();
    expect(d.log.length).toBeGreaterThan(0);
    const all = `${d.log.join('\n')}\n${JSON.stringify(r)}`;
    for (const secret of [TEST_ID, TEST_SECRET, 'tok-SECRET-value', 'Bearer']) expect(all).not.toContain(secret);
    expect(d.log.some((l) => l.includes('id.twitch.tv/oauth2/token'))).toBe(true);
  });
  it('the same holds on the 401 retry path', async () => {
    await seedToken('stale-SECRET', Date.now() + 3_600_000);
    const d = deps(gated('fresh-SECRET', games, 'fresh-SECRET'));
    await search(q('breath of the wild'), d);
    const all = d.log.join('\n');
    for (const secret of [TEST_ID, TEST_SECRET, 'stale-SECRET', 'fresh-SECRET', 'Bearer']) expect(all).not.toContain(secret);
  });
});

describe('recording an igdb case (the recorder\'s real token flow)', () => {
  it('keeps the token in its in-memory cache, and no secret, token or Authorization value reaches the fixture files', async () => {
    const live = gated('rec-TOKEN-xyz', games, 'rec-TOKEN-xyz');
    const rec = createRecorder(live, secretsFromVars({ IGDB_ID: TEST_ID, IGDB_SECRET: TEST_SECRET }));
    const d: LookupDeps = { fetch: rec.fetch, env: { ...testEnv, DB: memoryD1() } as Env, log: [] };
    const first = await search(q('breath of the wild'), d);
    expect(first?.sourceId).toBe('7346');
    expect(await details('7346', d)).not.toBeNull();
    expect(live.tokenCalls()).toBe(1); // the second call reused the stand-in cache's token row
    const { files, index } = buildFixtureFiles(rec.records);
    const everything = files.map((f) => `${f.name}\n${f.content}`).join('\n');
    for (const secret of [TEST_ID, TEST_SECRET, 'rec-TOKEN-xyz', 'Bearer', 'client_secret', 'client_id']) expect(everything).not.toContain(secret);
    expect(Object.keys(index)).toContain(`${TOKEN}?grant_type=client_credentials`);
    // and the files replay into the same search result
    const byName = Object.fromEntries(files.map((f) => [f.name, f.content]));
    const replay = replayFromIndex(index, (n) => byName[n]!, 'igdb/rec');
    await env.DB.exec('DELETE FROM lookup_cache');
    expect(await search(q('breath of the wild'), deps(replay))).toEqual(first);
    expect(replay.unmatched).toEqual([]);
  });
});

describe('igdb details input and request', () => {
  const one = JSON.stringify([{ id: 7346, first_release_date: unix(2017, 3, 3), summary: 'Link wakes.', platforms: [{ abbreviation: 'Wii U' }, { abbreviation: 'Switch' }] }]);
  it('rejects a non-numeric id without any request', async () => {
    const f = fakeFetch({});
    for (const id of ['abc', '1; fields *', '1/../2', '', '-5']) expect(await details(id, deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('one POST by id and maps the four fields', async () => {
    await seedToken('t', Date.now() + 3_600_000);
    const f = gated('t', one);
    expect(await details('7346', deps(f))).toEqual({ releaseDate: '2017-03-03', synopsis: 'Link wakes.', lengthLabel: '', origin: 'Wii U, Switch' });
    expect(f.apiCalls()).toHaveLength(1);
    expect(f.apiCalls()[0]!.body).toBe('fields summary,first_release_date,platforms.abbreviation; where id = 7346;');
    expect(f.apiCalls()[0]!.method).toBe('POST');
  });
  it('null on an error status or an empty list', async () => {
    await seedToken('t', Date.now() + 3_600_000);
    expect(await details('1', deps(fakeFetch({ [API]: 404 })))).toBeNull();
    expect(await details('1', deps(fakeFetch({ [API]: { body: '[]' } })))).toBeNull();
  });
});

// ---- fixture tests: skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('igdb', 'breath-of-the-wild'))('igdb fixture: breath-of-the-wild', () => {
  it('finds Breath of the Wild with a Nintendo platform in sub and an IGDB cover', async () => {
    const f = replayFetch('igdb', 'breath-of-the-wild');
    const r = await search(q('breath of the wild'), deps(f));
    expect(r?.title).toMatch(/breath of the wild/i);
    expect(r?.sub).toMatch(/\b(Switch|Wii ?U)\b/i);
    expect(r?.cover.startsWith('https://images.igdb.com/')).toBe(true);
    expect(r?.source).toBe('igdb');
    expect(r?.sourceId).toMatch(/^\d+$/);
    if (r?.choices) {
      expect(r.choices.length).toBeGreaterThan(1);
      expect(r.choices.length).toBeLessThanOrEqual(8);
      expect(r.choices[0]!.sourceId).toBe(r.sourceId);
    }
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('igdb', 'details-breath-of-the-wild'))('igdb fixture: details-breath-of-the-wild', () => {
  it('gives release date, synopsis and platforms; no length label', async () => {
    const f = replayFetch('igdb', 'details-breath-of-the-wild');
    const found = await search(q('breath of the wild'), deps(f));
    const r = await details(found!.sourceId!, deps(f));
    expect(r?.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r?.synopsis.length).toBeGreaterThan(0);
    expect(r?.origin).not.toBe('');
    expect(r?.lengthLabel).toBe('');
    expect(f.unmatched).toEqual([]);
  });
});
