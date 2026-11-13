import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  WIKI_HEADERS, WIKI_KINDS, details, earliestDate, formatDetails, keepPage, kindFor, parseWikidataDate, parseWikidataMinutes,
  pickPages, rankPages, search, wikidataFacts, type Claim, type ScoredPage, type WikiPage,
} from '../src/lookup/sources/wiki';
import { chainCacheKey, lookupChain } from '../src/lookup/chain';
import { SourceFailure, isDegraded } from '../src/lookup/http';
import { getCached } from '../src/lookup/cache';
import { fakeFetch, hasFixtures, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string, category: LookupQuery['category'] = 'movies', typedTitle = term): LookupQuery =>
  ({ term, typedTitle, hint: '', category });

// ---- logic tests: small synthetic inputs, not claims about Wikipedia's real payloads ----

describe('constants', () => {
  it('user agent names the app, not the old sheet', () => {
    expect(WIKI_HEADERS).toEqual({ 'Api-User-Agent': 'MediaTrackerApp/1.0 (private app; contact via GitHub DirtyDan8525/media-tracker)' });
  });

  it('kinds as in the script', () => {
    expect(WIKI_KINDS.film.suffix).toBe('film');
    expect(WIKI_KINDS.game.suffix).toBe('video game');
    expect(WIKI_KINDS.tv.suffix).toBe('TV series');
  });

  it('category -> kind: movies film, tv tv, games game, others none', () => {
    expect(kindFor('movies')).toBe('film');
    expect(kindFor('tv')).toBe('tv');
    expect(kindFor('games')).toBe('game');
    expect(kindFor('anime')).toBeNull();
    expect(kindFor('books')).toBeNull();
  });
});

describe('keepPage', () => {
  const p = (description: string): WikiPage => ({ title: 'T', description });

  it('keeps pages whose description matches the kind', () => {
    expect(keepPage('film', p('2008 American film'))).toBe(true);
    expect(keepPage('film', p('American novel'))).toBe(false);
    expect(keepPage('game', p('2011 video game'))).toBe(true);
    expect(keepPage('tv', p('American television series'))).toBe(true);
    expect(keepPage('tv', p('British sitcom'))).toBe(true);
    expect(keepPage('tv', p('2013 web series'))).toBe(true);
    expect(keepPage('tv', p('1990 miniseries'))).toBe(true);
    expect(keepPage('film', { title: 'T' })).toBe(false);
  });

  it('drops characters, franchises, soundtracks, episodes, developers, publishers and companies', () => {
    for (const d of ['fictional character in the film', 'film franchise', 'film soundtrack', 'film episode', 'film developer', 'film publisher', 'film company']) {
      expect(keepPage('film', p(d))).toBe(false);
    }
  });
});

describe('rankPages and pickPages (wiki_ scoring)', () => {
  const pg = (title: string, index: number, description = '2008 film'): WikiPage => ({ title, index, description });

  it('score = similarity of the title without "(…)" + small rank bonus; sorted by search index first', () => {
    const r = rankPages([pg('Abcd (film)', 2), pg('Zzzz', 1)], 'abcd');
    // sorted by index: Zzzz is rank 0, "Abcd" rank 1
    const abcd = r.find((s) => s.pg.title === 'Abcd (film)')!;
    expect(abcd.name).toBe('Abcd');
    expect(abcd.score).toBeCloseTo(1 + 0.02 * (1 - 1 / 2), 5);
    expect(r[0]).toBe(abcd);
  });

  it('adds 0.2 when the typed year appears in the title or description', () => {
    const r = rankPages([pg('Abcd', 1, '1993 film'), pg('Abcd (2008 film)', 2, 'film')], 'Abcd 2008');
    expect(r[0]!.pg.title).toBe('Abcd (2008 film)');
    expect(r[0]!.score - r[1]!.score).toBeCloseTo(0.2 - 0.02 * 0.5, 5);
  });

  const sc = (...scores: number[]): ScoredPage[] => scores.map((score, i) => ({ pg: { title: `P${i}` }, name: `P${i}`, score }));

  it('accepts a best score of 0.45 or more, rejects under it', () => {
    expect(pickPages(sc(0.44))).toBeNull();
    expect(pickPages(sc(0.45))).toHaveLength(1);
    expect(pickPages([])).toBeNull();
  });

  it('choices window: top plus anything within 0.1 of it, at most 10', () => {
    expect(pickPages(sc(1.0, 0.91, 0.9, 0.89))?.map((s) => s.name)).toEqual(['P0', 'P1', 'P2']);
    expect(pickPages(sc(...Array<number>(15).fill(1)))).toHaveLength(10);
  });
});

describe('parseWikidataDate (P577 value)', () => {
  it('precision 11 (day) -> YYYY-MM-DD', () => {
    expect(parseWikidataDate({ time: '+2008-05-09T00:00:00Z', precision: 11 })).toBe('2008-05-09');
    expect(parseWikidataDate({ time: '+2008-05-09T00:00:00Z', precision: 14 })).toBe('2008-05-09');
  });

  it('precision 9 (year) or 10 (month) -> YYYY', () => {
    expect(parseWikidataDate({ time: '+2008-00-00T00:00:00Z', precision: 9 })).toBe('2008');
    expect(parseWikidataDate({ time: '+2008-05-00T00:00:00Z', precision: 10 })).toBe('2008');
  });

  it('coarser than a year, BCE, or junk -> empty', () => {
    expect(parseWikidataDate({ time: '+2000-00-00T00:00:00Z', precision: 8 })).toBe('');
    expect(parseWikidataDate({ time: '-0100-00-00T00:00:00Z', precision: 9 })).toBe('');
    expect(parseWikidataDate({ time: 'nonsense', precision: 11 })).toBe('');
    expect(parseWikidataDate(undefined)).toBe('');
    expect(parseWikidataDate({ precision: 11 })).toBe('');
  });

  it('a day-precision value with a zero month or day falls back to the year', () => {
    expect(parseWikidataDate({ time: '+2008-00-00T00:00:00Z', precision: 11 })).toBe('2008');
  });
});

describe('earliestDate', () => {
  const c = (time: string, precision: number): Claim => ({ mainsnak: { datavalue: { value: { time, precision } } } });

  it('the earliest of several publication dates', () => {
    expect(earliestDate([c('+2008-06-01T00:00:00Z', 11), c('+2008-05-09T00:00:00Z', 11), c('+2009-01-01T00:00:00Z', 11)])).toBe('2008-05-09');
  });

  it('a year-only date sorts by its year; unusable claims are skipped', () => {
    expect(earliestDate([c('+2007-00-00T00:00:00Z', 9), c('+2008-05-09T00:00:00Z', 11)])).toBe('2007');
    expect(earliestDate([c('+1900-00-00T00:00:00Z', 7), c('+2008-05-09T00:00:00Z', 11)])).toBe('2008-05-09');
  });

  it('empty with no claims', () => {
    expect(earliestDate(undefined)).toBe('');
    expect(earliestDate([])).toBe('');
  });
});

describe('parseWikidataMinutes (P2047)', () => {
  const c = (amount: string, unit: string): Claim => ({ mainsnak: { datavalue: { value: { amount, unit } } } });
  const U = 'http://www.wikidata.org/entity/';

  it('minutes as is, hours times 60, rounded', () => {
    expect(parseWikidataMinutes([c('+135', `${U}Q7727`)])).toBe(135);
    expect(parseWikidataMinutes([c('+2.5', `${U}Q25235`)])).toBe(150);
    expect(parseWikidataMinutes([c('+135.4', `${U}Q7727`)])).toBe(135);
  });

  it('other units (seconds, unknown, "1") are not converted', () => {
    expect(parseWikidataMinutes([c('+8100', `${U}Q11574`)])).toBeNull();
    expect(parseWikidataMinutes([c('+135', '1')])).toBeNull();
    expect(parseWikidataMinutes([])).toBeNull();
    expect(parseWikidataMinutes(undefined)).toBeNull();
  });

  it('takes the first usable claim and ignores zero or non-numeric amounts', () => {
    expect(parseWikidataMinutes([c('+8100', `${U}Q11574`), c('+90', `${U}Q7727`)])).toBe(90);
    expect(parseWikidataMinutes([c('+0', `${U}Q7727`)])).toBeNull();
    expect(parseWikidataMinutes([c('abc', `${U}Q7727`)])).toBeNull();
  });
});

describe('formatDetails (Wikidata + article intro)', () => {
  const U = 'http://www.wikidata.org/entity/';
  const entity = {
    claims: {
      P577: [{ mainsnak: { datavalue: { value: { time: '+2008-05-09T00:00:00Z', precision: 11 } } } }],
      P2047: [{ mainsnak: { datavalue: { value: { amount: '+135', unit: `${U}Q7727` } } } }],
    },
  };

  it('all four fields; origin is always empty (Wikidata has no studio field here)', () => {
    expect(formatDetails(entity, 'A racer wins.\nSecond line.')).toEqual({
      releaseDate: '2008-05-09', synopsis: 'A racer wins. Second line.', lengthLabel: '2 h 15 min', origin: '',
    });
  });

  it('missing pieces -> empty strings', () => {
    expect(formatDetails(null, '')).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
    expect(formatDetails({}, 'x')).toEqual({ releaseDate: '', synopsis: 'x', lengthLabel: '', origin: '' });
  });

  it('trims a long intro to 600 characters', () => {
    expect(formatDetails(null, 'word '.repeat(300)).synopsis.length).toBeLessThanOrEqual(601);
  });
});

describe('registration', () => {
  it('wiki is registered with search and details', () => {
    expect(typeof SOURCES.wiki?.search).toBe('function');
    expect(typeof SOURCES.wiki?.details).toBe('function');
  });
});

// ---- request tests: the minimum bodies our code reads ----

const API = 'https://en.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const ref = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });

describe('wikidataFacts (director P57, genres P136, developer P178)', () => {
  it('names via labels; genres tidied, deduped and capped at 4; developers capped at 3; unknown ids skipped', async () => {
    const f = fakeFetch({
      [`${WD}?format=json&action=wbgetentities&props=claims`]: { body: JSON.stringify({ entities: {
        Q1: { claims: {
          P57: [ref('Q10'), ref('Q11')],
          P136: [ref('Q20'), ref('Q21'), ref('Q22'), ref('Q23'), ref('Q24'), ref('Q25')],
          P178: [ref('Q30'), ref('Q31'), ref('Q32'), ref('Q33')],
        } },
      } }) },
      [`${WD}?format=json&action=wbgetentities&props=labels`]: { body: JSON.stringify({ entities: Object.fromEntries([
        ['Q10', 'Lana'], ['Q11', 'Lilly'], ['Q20', 'action film'], ['Q21', 'Action film'], ['Q22', 'comedy television series'],
        ['Q23', 'puzzle video game'], ['Q24', 'drama'], ['Q25', 'extra'], ['Q30', 'Dev A'], ['Q31', 'Dev B'], ['Q32', 'Dev C'], ['Q33', 'Dev D'],
      ].map(([id, v]) => [id, { labels: { en: { value: v } } }])) }) },
    });
    const out = await wikidataFacts(['Q1', 'Q999'], deps(f));
    expect(out.Q1).toEqual({
      directors: ['Lana', 'Lilly'], developers: ['Dev A', 'Dev B', 'Dev C'], genres: ['Action', 'Comedy', 'Puzzle', 'Drama'],
    });
    expect(out.Q999).toBeUndefined();
  });

  it('no ids -> no request; a failed request -> {}', async () => {
    const f = fakeFetch({});
    expect(await wikidataFacts([], deps(f))).toEqual({});
    expect(f.calls).toEqual([]);
    expect(await wikidataFacts(['Q1'], deps(fakeFetch({ [WD]: 500 })))).toEqual({});
  });
});

describe('wiki search flow', () => {
  const page = (over: Partial<WikiPage>): WikiPage => ({ title: 'Alpha Quest', description: '2008 film', index: 1, ...over });
  const pagesBody = (...pages: WikiPage[]) => JSON.stringify({ query: { pages } });

  /** Routes the wikipedia search (by the `gsrsearch` text) and the two Wikidata calls. */
  function routed(pages: WikiPage[], extra: Record<string, string | number> = {}) {
    const f = fakeFetch({
      [`${API}?action=query&format=json&formatversion=2&generator=search`]: { body: pagesBody(...pages) },
      [`${WD}?format=json&action=wbgetentities&props=claims`]: { body: JSON.stringify({ entities: { Q5: { claims: { P57: [ref('Q9')] } } } }) },
      [`${WD}?format=json&action=wbgetentities&props=labels`]: { body: JSON.stringify({ entities: { Q9: { labels: { en: { value: 'Dee' } } } } }) },
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? { body: v } : v])),
    });
    return f;
  }

  it('a failed Wikidata call degrades the result: not marked when healthy, and the chain does not cache it', async () => {
    const pg = page({ pageid: 77, pageprops: { wikibase_item: 'Q5' } });
    const healthy = await search(q('Alpha Quest'), deps(routed([pg])));
    expect(healthy?.creator).toBe('Dee');
    expect(isDegraded(healthy)).toBe(false);

    const bad = (map: Record<string, number>) => fakeFetch({
      [`${API}?action=query&format=json&formatversion=2&generator=search`]: { body: pagesBody(pg) }, ...map,
    });
    const claimsFail = await search(q('Alpha Quest'), deps(bad({ [`${WD}?format=json&action=wbgetentities&props=claims`]: 500 })));
    expect(claimsFail).toMatchObject({ title: 'Alpha Quest', creator: '' });
    expect(isDegraded(claimsFail)).toBe(true);

    const term = 'degraded wiki q';
    const query = { term, typedTitle: term, hint: '', category: 'movies' as const };
    const mk = (claims: number | string) => ({
      ...deps(fakeFetch({
        [`${API}?action=query&format=json&formatversion=2&generator=search`]: { body: pagesBody(page({ title: 'Degraded Wiki Q', pageid: 5, pageprops: { wikibase_item: 'Q5' } })) },
        [`${WD}?format=json&action=wbgetentities&props=claims`]: typeof claims === 'number' ? claims : { body: claims },
        [`${WD}?format=json&action=wbgetentities&props=labels`]: { body: '{"entities":{}}' },
      })),
      env: { ...(env as Env), TMDB_KEY: undefined } as Env,
    });
    expect((await lookupChain('movies', query, mk(500)))?.title).toBe('Degraded Wiki Q');
    expect(await getCached(env.DB, 'chain:movies', chainCacheKey(query))).toBeNull();
    // the same lookup, healthy this time, is cached
    expect((await lookupChain('movies', query, mk('{"entities":{}}')))?.title).toBe('Degraded Wiki Q');
    expect(await getCached(env.DB, 'chain:movies', chainCacheKey(query))).not.toBeNull();
  });

  it('sends the app user agent; sourceId is the Wikidata QID when the page has one', async () => {
    const seen: Headers[] = [];
    const inner = routed([page({ pageid: 77, pageprops: { wikibase_item: 'Q5' }, thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' } })]);
    const f = (async (i: RequestInfo | URL, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return inner(i, init); }) as typeof fetch;
    const r = await search(q('Alpha Quest'), deps(f));
    expect(r).toMatchObject({
      title: 'Alpha Quest', trusted: false, source: 'wiki', sourceId: 'Q5', creator: 'Dee', sub: '2008 film',
      cover: 'https://upload.wikimedia.org/x.jpg',
    });
    expect(seen.every((h) => h.get('api-user-agent')?.startsWith('MediaTrackerApp/1.0'))).toBe(true);
  });

  it('falls back to the numeric page id when there is no Wikidata item (never a title)', async () => {
    const r = await search(q('Alpha Quest'), deps(routed([page({ pageid: 77 })])));
    expect(r?.sourceId).toBe('77');
    expect(r?.sourceId).toMatch(/^[\w.:-]{1,200}$/);
  });

  it('the director shows only for films; the developer for games; tv has no creator', async () => {
    const body = (kind: string) => page({ description: `2008 ${kind}`, pageid: 1, pageprops: { wikibase_item: 'Q5' } });
    const claims = JSON.stringify({ entities: { Q5: { claims: { P57: [ref('Q9')], P178: [ref('Q8')] } } } });
    const labels = JSON.stringify({ entities: { Q9: { labels: { en: { value: 'Dee' } } }, Q8: { labels: { en: { value: 'Studio X' } } } } });
    const mk = (desc: string) => fakeFetch({
      [`${API}`]: { body: pagesBody(body(desc)) },
      [`${WD}?format=json&action=wbgetentities&props=claims`]: { body: claims },
      [`${WD}?format=json&action=wbgetentities&props=labels`]: { body: labels },
    });
    expect((await search(q('Alpha Quest', 'movies'), deps(mk('film'))))?.creator).toBe('Dee');
    expect((await search(q('Alpha Quest', 'games'), deps(mk('video game'))))?.creator).toBe('Studio X');
    expect((await search(q('Alpha Quest', 'tv'), deps(mk('television series'))))?.creator).toBe('');
  });

  it('searches "<term> <suffix>" per category; retries the bare title (year dropped) when nothing is kept', async () => {
    const f = fakeFetch({ [API]: { body: pagesBody(page({ description: 'novel' })) } });
    expect(await search(q('Alpha Quest 2008', 'games'), deps(f))).toBeNull();
    expect(f.calls).toHaveLength(2);
    expect(decodeURIComponent(f.calls[0]!)).toContain('gsrsearch=Alpha Quest 2008 video game');
    expect(decodeURIComponent(f.calls[1]!)).toContain('gsrsearch=Alpha Quest&');
  });

  it('other categories are a miss without a request', async () => {
    const f = fakeFetch({});
    expect(await search(q('x', 'books'), deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it('several near-tied pages give choices that each carry source and sourceId', async () => {
    const f = routed([page({ pageid: 1, index: 1 }), page({ title: 'Alpha Quest (2019 film)', description: '2019 film', pageid: 2, index: 2 })]);
    const r = await search(q('Alpha Quest'), deps(f));
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['1', '2']);
    expect(r?.choices?.every((c) => c.source === 'wiki' && c.choices === undefined)).toBe(true);
  });

  it('a Wikipedia error is a miss', async () => {
    expect(await search(q('Alpha Quest'), deps(fakeFetch({ [API]: 503 })))).toBeNull();
  });
});

describe('wiki details', () => {
  const U = 'http://www.wikidata.org/entity/';
  const entityBody = JSON.stringify({ entities: { Q5: {
    claims: {
      P577: [{ mainsnak: { datavalue: { value: { time: '+2008-05-09T00:00:00Z', precision: 11 } } } }],
      P2047: [{ mainsnak: { datavalue: { value: { amount: '+75', unit: `${U}Q7727` } } } }],
    },
    sitelinks: { enwiki: { title: 'Alpha Quest' } },
  } } });
  const extractBody = JSON.stringify({ query: { pages: [{ title: 'Alpha Quest', extract: 'Alpha Quest is a film.' }] } });

  it('rejects an id that is neither a QID nor a numeric page id, without a request', async () => {
    const f = fakeFetch({});
    for (const bad of ['Alpha Quest', 'Q', 'q5', '12a', '../x', '']) expect(await details(bad, deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it('QID: Wikidata claims for date and duration, intro text via the enwiki sitelink', async () => {
    const f = fakeFetch({
      [`${WD}?format=json&action=wbgetentities&props=claims`]: { body: entityBody },
      [API]: { body: extractBody },
    });
    expect(await details('Q5', deps(f))).toEqual({
      releaseDate: '2008-05-09', synopsis: 'Alpha Quest is a film.', lengthLabel: '1 h 15 min', origin: '',
    });
    const extractCall = decodeURIComponent(f.calls.find((c) => c.startsWith(API))!);
    expect(extractCall).toContain('prop=extracts');
    expect(extractCall).toContain('exintro');
    expect(extractCall).toContain('explaintext');
    expect(extractCall).toContain('exsentences=3');
    expect(extractCall).toContain('titles=Alpha Quest');
  });

  it('page id: extract and wikibase item from one call, then the Wikidata facts', async () => {
    const f = fakeFetch({
      [API]: { body: JSON.stringify({ query: { pages: [{ pageid: 77, title: 'Alpha Quest', extract: 'Intro.', pageprops: { wikibase_item: 'Q5' } }] } }) },
      [`${WD}?format=json&action=wbgetentities&props=claims`]: { body: entityBody },
    });
    expect(await details('77', deps(f))).toMatchObject({ releaseDate: '2008-05-09', synopsis: 'Intro.', lengthLabel: '1 h 15 min' });
    expect(decodeURIComponent(f.calls[0]!)).toContain('pageids=77');
  });

  it('page id without a Wikidata item: just the synopsis, other fields empty', async () => {
    const f = fakeFetch({ [API]: { body: JSON.stringify({ query: { pages: [{ pageid: 77, title: 'T', extract: 'Intro.' }] } }) } });
    expect(await details('77', deps(f))).toEqual({ releaseDate: '', synopsis: 'Intro.', lengthLabel: '', origin: '' });
  });

  it('failed requests are failures; a missing entity is a plain null', async () => {
    await expect(details('Q5', deps(fakeFetch({ [WD]: 500 })))).rejects.toBeInstanceOf(SourceFailure);
    await expect(details('77', deps(fakeFetch({ [API]: 500 })))).rejects.toBeInstanceOf(SourceFailure);
    expect(await details('Q5', deps(fakeFetch({ [WD]: 404 })))).toBeNull();
  });
});

// ---- fixture tests: real assertions, skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('wiki', 'speed-racer'))('wiki fixture: speed-racer (no TMDB key)', () => {
  it('finds the Speed Racer film page', async () => {
    const f = replayFetch('wiki', 'speed-racer');
    const r = await search(q('speed racer'), deps(f));
    expect(r?.title).toMatch(/speed racer/i);
    expect(r?.source).toBe('wiki');
    expect(r?.sourceId).toMatch(/^(Q\d+|\d+)$/);
    expect(r?.sub).toMatch(/film/i);
    expect(r?.cover === '' || r?.cover.startsWith('https://')).toBe(true);
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('wiki', 'details-speed-racer'))('wiki fixture: details-speed-racer', () => {
  it('gives a date, an intro and a length label, with origin empty', async () => {
    // The case holds the search and the details call that followed it.
    const f = replayFetch('wiki', 'details-speed-racer');
    const found = await search(q('speed racer'), deps(f));
    const r = await details(found!.sourceId!, deps(f));
    expect(r?.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$|^\d{4}$/);
    expect(r?.synopsis.length).toBeGreaterThan(20);
    expect(r?.lengthLabel).toMatch(/^\d+ h \d+ min$|^\d+ min$|^$/);
    expect(r?.origin).toBe('');
    expect(JSON.stringify(r)).not.toContain('undefined');
  });
});
