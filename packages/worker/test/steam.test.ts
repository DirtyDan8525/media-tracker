import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { chainCacheKey, lookupChain } from '../src/lookup/chain';
import { getCached } from '../src/lookup/cache';
import { SourceFailure, isDegraded, resetPacing } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  EXCLUDED, applyYear, artUrl, details, formatDetails, parseSteamDate, pickItems, platformsLabel, rankItems, search, type Candidate, type Scored,
} from '../src/lookup/sources/steam';
import { fakeFetch, hasFixtures, recordedUrls, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch, e: Env = env as Env): LookupDeps & { log: string[] } => ({ fetch: f, env: e, log: [] });
const q = (term: string, typedTitle = term): LookupQuery => ({ term, typedTitle, hint: '', category: 'games' });

beforeEach(async () => {
  resetPacing();
  await env.DB.exec('DELETE FROM lookup_cache');
});

// ---- logic tests: small synthetic inputs, not claims about Steam's real payloads ----

describe('EXCLUDED (the script\'s filter regex)', () => {
  it('matches soundtracks, OSTs, DLC, demos, season passes and artbooks, any case', () => {
    for (const n of ['Portal Soundtrack', 'Hades OST', 'Game DLC', 'Foo (DLC)', 'Game Demo', 'Game Season Pass', 'The Art Book Artbook', 'GAME ost']) {
      expect(EXCLUDED.test(n), n).toBe(true);
    }
  });
  it('leaves ordinary names alone (OST only as a whole word)', () => {
    for (const n of ['Portal 2', 'Lost Planet', 'Ostriches', 'Cost of Living', 'Dlcfree']) expect(EXCLUDED.test(n), n).toBe(false);
  });
});

describe('parseSteamDate', () => {
  it('a full unambiguous date becomes YYYY-MM-DD', () => {
    expect(parseSteamDate('19 Apr, 2011')).toBe('2011-04-19');
    expect(parseSteamDate('5 Sep, 2019')).toBe('2019-09-05');
    expect(parseSteamDate('Apr 19, 2011')).toBe('2011-04-19');
    expect(parseSteamDate('  1 Jan, 2000 ')).toBe('2000-01-01');
    expect(parseSteamDate('29 Feb, 2020')).toBe('2020-02-29');
  });
  it('a date that does not parse unambiguously falls back to the 4-digit year', () => {
    expect(parseSteamDate('Apr 2011')).toBe('2011');
    expect(parseSteamDate('2011')).toBe('2011');
    expect(parseSteamDate('Q4 2024')).toBe('2024');
    expect(parseSteamDate('31 Feb, 2011')).toBe('2011');
    expect(parseSteamDate('29 Feb, 2019')).toBe('2019');
    expect(parseSteamDate('3 Foo, 2011')).toBe('2011');
  });
  it('no year at all gives an empty string', () => {
    for (const v of ['Coming soon', 'To be announced', '', null, undefined]) expect(parseSteamDate(v)).toBe('');
  });
});

describe('platformsLabel', () => {
  it('Windows, Mac, Linux in that order for the true ones', () => {
    expect(platformsLabel({ windows: true, mac: true, linux: true })).toBe('Windows, Mac, Linux');
    expect(platformsLabel({ windows: true, mac: false, linux: true })).toBe('Windows, Linux');
    expect(platformsLabel({ mac: true })).toBe('Mac');
  });
  it('empty without platforms', () => {
    expect(platformsLabel(null)).toBe('');
    expect(platformsLabel(undefined)).toBe('');
    expect(platformsLabel({ windows: false, mac: false, linux: false })).toBe('');
  });
});

describe('artUrl', () => {
  it('the akamai store_item_assets path for the app', () => {
    expect(artUrl(620, 'library_600x900.jpg')).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg');
    expect(artUrl('620', 'header.jpg')).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg');
  });
});

describe('rankItems and pickItems (steam_ scoring)', () => {
  const it_ = (id: number, name: string) => ({ id, name });

  it('score = similarity + 0.05 x rank weight, best first', () => {
    const r = rankItems([it_(1, 'Abcd'), it_(2, 'Abcd'), it_(3, 'Zzzz')], 'abcd');
    expect(r.map((s) => s.it.id)).toEqual([1, 2, 3]);
    expect(r[0]!.score).toBeCloseTo(1.05, 5); // 1 + 0.05 * (1 - 0/3)
    expect(r[1]!.score).toBeCloseTo(1 + 0.05 * (1 - 1 / 3), 5);
  });
  it('a later exact match can overtake an earlier weaker one', () => {
    const r = rankItems([it_(1, 'Abcd Remix Pack'), it_(2, 'Abcd')], 'abcd');
    expect(r[0]!.it.id).toBe(2);
  });
  it('filtered names are dropped before ranking (rank weight uses the kept count)', () => {
    const r = rankItems([it_(1, 'Abcd Soundtrack'), it_(2, 'Abcd'), it_(3, 'Abcd DLC')], 'abcd');
    expect(r.map((s) => s.it.id)).toEqual([2]);
    expect(r[0]!.score).toBeCloseTo(1.05, 5); // 1 item: 1 - 0/1
  });

  const sc = (...scores: number[]): Scored[] => scores.map((score, i) => ({ it: it_(i + 1, 'x'), score }));
  it('accepts 0.6 or more, rejects under it', () => {
    expect(pickItems(sc(0.59))).toBeNull();
    expect(pickItems(sc(0.6))?.map((s) => s.it.id)).toEqual([1]);
    expect(pickItems([])).toBeNull();
  });
  it('choices window 0.1 around the top, at most 5', () => {
    expect(pickItems(sc(1.0, 0.91, 0.9, 0.89))?.map((s) => s.it.id)).toEqual([1, 2, 3]);
    expect(pickItems(sc(1, 1, 1, 1, 1, 1, 1))).toHaveLength(5);
  });
});

describe('applyYear', () => {
  const info = (title: string) => ({ title, trusted: false, creator: '', genres: '', cover: '', sub: '', source: 'steam' as const });
  const c = (title: string, y: string, score: number): Candidate => ({ info: info(title), y, score });
  it('+0.2 for the typed year, then re-sorted', () => {
    const r = applyYear([c('a', '2000', 1.0), c('b', '2011', 0.9)], '2011');
    expect(r.map((x) => x.info.title)).toEqual(['b', 'a']);
    expect(r[0]!.score).toBeCloseTo(1.1, 5);
  });
  it('no typed year: order and scores unchanged', () => {
    const r = applyYear([c('a', '2000', 1.0), c('b', '2011', 0.9)], '');
    expect(r.map((x) => x.info.title)).toEqual(['a', 'b']);
    expect(r[1]!.score).toBe(0.9);
  });
});

describe('formatDetails (appdetails data)', () => {
  it('release date, short description (HTML stripped), platforms, empty length label', () => {
    expect(formatDetails({ release_date: { date: '19 Apr, 2011' }, short_description: 'A <b>test</b> chamber.', platforms: { windows: true, mac: true, linux: false } }))
      .toEqual({ releaseDate: '2011-04-19', synopsis: 'A test chamber.', lengthLabel: '', origin: 'Windows, Mac' });
  });
  it('missing pieces are empty strings', () => {
    expect(formatDetails({})).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
  });
  it('trims a long description to 600 characters', () => {
    expect(formatDetails({ short_description: 'word '.repeat(300) }).synopsis.length).toBeLessThanOrEqual(601);
  });
});

describe('registration', () => {
  it('steam is registered with search and details', () => {
    expect(typeof SOURCES.steam?.search).toBe('function');
    expect(typeof SOURCES.steam?.details).toBe('function');
  });
});

// ---- request tests ----

const SEARCH = 'https://store.steampowered.com/api/storesearch/';
const APP = 'https://store.steampowered.com/api/appdetails?appids=';
const ASSET = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/';
const found = (...items: { id: number; name: string }[]) => ({ body: JSON.stringify({ total: items.length, items }) });
const app = (id: number, data: object) => ({ body: JSON.stringify({ [id]: { success: true, data } }) });

const portal = {
  [SEARCH]: found({ id: 620, name: 'Portal 2' }, { id: 621, name: 'Portal 2 Soundtrack' }),
  [`${APP}620&`]: app(620, { genres: [{ description: 'Action' }, { description: 'Adventure' }], developers: ['Valve'], release_date: { date: '19 Apr, 2011' } }),
};

describe('steam search requests', () => {
  it('searches storesearch with cc=us, l=en and the term (year removed); falls back to header.jpg when the 600x900 art is 404', async () => {
    const f = fakeFetch({ ...portal, [`${ASSET}620/library_600x900.jpg`]: 404 });
    const r = await search(q('portal 2'), deps(f));
    expect(f.calls[0]).toBe(`${SEARCH}?cc=us&l=en&term=portal%202`);
    expect(r).toEqual({
      title: 'Portal 2', trusted: false, creator: 'Valve', genres: 'Action, Adventure', cover: `${ASSET}620/header.jpg`, sub: '2011 · Valve',
      source: 'steam', sourceId: '620',
    });
    expect(f.unmatched).toEqual([]);
  });
  it('the per-candidate appdetails call asks for English and US (l=english&cc=us)', async () => {
    const f = fakeFetch({ ...portal, [`${ASSET}620/library_600x900.jpg`]: 404 });
    await search(q('portal 2'), deps(f));
    expect(f.calls).toContain(`${APP}620&filters=basic,genres,developers,release_date&l=english&cc=us`);
  });
  it('uses the 600x900 art when a HEAD on it answers 200 (status only: the art is requested with HEAD)', async () => {
    const methods: string[] = [];
    const inner = fakeFetch({ ...portal, [`${ASSET}620/library_600x900.jpg`]: 200 });
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(ASSET)) methods.push(init?.method ?? 'GET');
      return inner(input, init);
    }) as typeof fetch;
    const r = await search(q('portal 2'), deps(f));
    expect(r?.cover).toBe(`${ASSET}620/library_600x900.jpg`);
    expect(methods).toEqual(['HEAD']);
  });
  it('a network error on the art check also gives header.jpg', async () => {
    const inner = fakeFetch({ ...portal });
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(ASSET)) throw new Error('offline');
      return inner(input, init);
    }) as typeof fetch;
    expect((await search(q('portal 2'), deps(f)))?.cover).toBe(`${ASSET}620/header.jpg`);
  });
  it('a failed appdetails still gives a result (no genres, developer or year)', async () => {
    const f = fakeFetch({ [SEARCH]: found({ id: 620, name: 'Portal 2' }), [`${APP}620&`]: 500, [`${ASSET}620/library_600x900.jpg`]: 200 });
    expect(await search(q('portal 2'), deps(f))).toMatchObject({ title: 'Portal 2', creator: '', genres: '', sub: '' });
  });
  it('the typed year (+0.2 against the release year) reorders the choices', async () => {
    const f = fakeFetch({
      [SEARCH]: found({ id: 1, name: 'Game' }, { id: 2, name: 'Game' }),
      [`${APP}1&`]: app(1, { release_date: { date: 'Mar 2005' } }),
      [`${APP}2&`]: app(2, { release_date: { date: '3 Jan, 2011' } }),
      [ASSET]: 404,
    });
    const r = await search(q('Game (2011)'), deps(f));
    expect(r?.sourceId).toBe('2');
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['2', '1']);
    expect(r?.choices?.every((c) => c.source === 'steam' && c.choices === undefined)).toBe(true);
  });
  it('misses on an error status, nothing left after the filter, or a weak match', async () => {
    expect(await search(q('portal 2'), deps(fakeFetch({ [SEARCH]: 500 })))).toBeNull();
    expect(await search(q('portal 2'), deps(fakeFetch({ [SEARCH]: found({ id: 1, name: 'Portal 2 Soundtrack' }) })))).toBeNull();
    expect(await search(q('portal 2'), deps(fakeFetch({ [SEARCH]: found({ id: 1, name: 'Zzzzzz Qqqq' }) })))).toBeNull();
  });
  it('worst case is 11 requests: 1 search + 5 candidates x (appdetails + art check)', async () => {
    const six = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: 'Portal' }));
    const map: Record<string, ReturnType<typeof found> | number> = { [SEARCH]: found(...six), [ASSET]: 404 };
    for (const { id } of six) map[`${APP}${id}&`] = app(id, {});
    const f = fakeFetch(map);
    const r = await search(q('portal'), deps(f));
    expect(r?.choices).toHaveLength(5);
    expect(f.calls).toHaveLength(11);
  });
});

describe('steam details input and request', () => {
  it('rejects a non-numeric id without a request', async () => {
    const f = fakeFetch({});
    for (const id of ['abc', '620,730', '620/../1', '', '-1']) expect(await details(id, deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('reads appdetails?appids=<id> and formats it', async () => {
    const f = fakeFetch({ [`${APP}620`]: app(620, { release_date: { date: '19 Apr, 2011' }, short_description: 'Hi.', platforms: { windows: true, mac: true, linux: true } }) });
    expect(await details('620', deps(f))).toEqual({ releaseDate: '2011-04-19', synopsis: 'Hi.', lengthLabel: '', origin: 'Windows, Mac, Linux' });
    expect(f.calls).toEqual([`${APP}620&l=english&cc=us`]);
  });
  it('a failed request is a failure; success:false or a missing entry is a plain null', async () => {
    await expect(details('620', deps(fakeFetch({ [`${APP}620`]: 500 })))).rejects.toBeInstanceOf(SourceFailure);
    await expect(details('620', deps(fakeFetch({ [`${APP}620`]: 429 })))).rejects.toBeInstanceOf(SourceFailure);
    expect(await details('620', deps(fakeFetch({ [`${APP}620`]: { body: JSON.stringify({ 620: { success: false } }) } })))).toBeNull();
    expect(await details('620', deps(fakeFetch({ [`${APP}620`]: { body: '{}' } })))).toBeNull();
  });
});

describe('degraded results (appdetails failed)', () => {
  const noIgdb = { ...(env as Env), IGDB_ID: undefined, IGDB_SECRET: undefined } as Env;
  const mk = (appdetails: number | object) => deps(fakeFetch({
    [SEARCH]: found({ id: 620, name: 'Portal 2' }),
    [`${APP}620&`]: appdetails,
    [`${ASSET}620/library_600x900.jpg`]: 404,
  }), noIgdb);
  const healthy = app(620, { developers: ['Valve'], release_date: { date: '19 Apr, 2011' } });

  it('is flagged on a failed appdetails call, not when healthy', async () => {
    expect(isDegraded(await search(q('portal 2'), mk(500)))).toBe(true);
    expect(isDegraded(await search(q('portal 2'), mk(healthy)))).toBe(false);
  });
  it('the chain does not cache a degraded result but caches a healthy one', async () => {
    const query = q('portal 2 degraded');
    const withTitle = (appd: number | object) => deps(fakeFetch({
      [SEARCH]: found({ id: 620, name: 'Portal 2 Degraded' }), [`${APP}620&`]: appd, [`${ASSET}620/library_600x900.jpg`]: 404,
    }), noIgdb);
    expect((await lookupChain('games', query, withTitle(500)))?.title).toBe('Portal 2 Degraded');
    expect(await getCached(env.DB, 'chain:games', chainCacheKey(query))).toBeNull();
    expect((await lookupChain('games', query, withTitle(healthy)))?.title).toBe('Portal 2 Degraded');
    expect(await getCached(env.DB, 'chain:games', chainCacheKey(query))).not.toBeNull();
  });
});

describe('games chain with IGDB off', () => {
  it('"portal 2" without IGDB keys goes to Steam; IGDB and Twitch are never contacted', async () => {
    const f = fakeFetch({ ...portal, [`${ASSET}620/library_600x900.jpg`]: 404 });
    const offEnv = { ...(env as Env), IGDB_ID: undefined, IGDB_SECRET: undefined } as Env;
    const d = deps(f, offEnv);
    const r = await lookupChain('games', q('portal 2'), d);
    expect(r).toMatchObject({ title: 'Portal 2', source: 'steam', cover: `${ASSET}620/header.jpg` });
    expect(f.calls.some((c) => c.includes('igdb.com') || c.includes('twitch.tv'))).toBe(false);
    expect(d.log.some((l) => l.includes('igdb: skipped (no key)'))).toBe(true);
  });
});

// ---- fixture tests: skipped until Dan records the cases ----

// appdetails now sends l=english&cc=us (it answered in Polish on the first recording); older recordings lack it.
const steamRecordedWithLocale = (c: string) => recordedUrls('steam', c).filter((u) => u.includes('/api/appdetails')).every((u) => u.includes('l=english') && u.includes('cc=us'));
for (const c of ['portal-2', 'details-portal-2'])
  if (hasFixtures('steam', c) && !steamRecordedWithLocale(c)) console.warn(`steam ${c} fixture tests skipped, re-record needed: appdetails URLs lack l=english&cc=us`);

describe.skipIf(!hasFixtures('steam', 'portal-2') || !steamRecordedWithLocale('portal-2'))('steam fixture: portal-2', () => {
  it('finds Portal 2 by Valve with Steam art (header.jpg when the 600x900 art is missing)', async () => {
    const f = replayFetch('steam', 'portal-2');
    const r = await search(q('portal 2'), deps(f));
    expect(r?.title).toBe('Portal 2');
    expect(r?.creator).toMatch(/valve/i);
    expect(r?.cover).toMatch(/^https:\/\/shared\.akamai\.steamstatic\.com\/store_item_assets\/steam\/apps\/620\/(library_600x900|header)\.jpg$/);
    expect(r?.source).toBe('steam');
    expect(r?.sourceId).toMatch(/^\d+$/);
    if (r?.choices) {
      expect(r.choices.length).toBeGreaterThan(1);
      expect(r.choices.length).toBeLessThanOrEqual(5);
      expect(r.choices[0]!.sourceId).toBe(r.sourceId);
    }
    expect(f.unmatched).toEqual([]);
  });
  it('through the games chain with IGDB off, the answer is the Steam result', async () => {
    const offEnv = { ...(env as Env), IGDB_ID: undefined, IGDB_SECRET: undefined } as Env;
    const r = await lookupChain('games', q('portal 2'), deps(replayFetch('steam', 'portal-2'), offEnv));
    expect(r?.source).toBe('steam');
    expect(r?.title).toBe('Portal 2');
  });
});

describe.skipIf(!hasFixtures('steam', 'details-portal-2') || !steamRecordedWithLocale('details-portal-2'))('steam fixture: details-portal-2', () => {
  it('gives release date, synopsis and platforms; no length label', async () => {
    const f = replayFetch('steam', 'details-portal-2');
    const foundInfo = await search(q('portal 2'), deps(f));
    const r = await details(foundInfo!.sourceId!, deps(f));
    expect(r?.releaseDate).toMatch(/^\d{4}(-\d{2}-\d{2})?$/);
    expect(r?.synopsis.length).toBeGreaterThan(0);
    expect(r?.origin).toMatch(/Windows/);
    expect(r?.lengthLabel).toBe('');
    expect(f.unmatched).toEqual([]);
  });
});
