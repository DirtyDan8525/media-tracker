import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { resetPacing } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import {
  BOOK_GENRES, OL_HEADERS, descriptionOf, details, formatDetails, genresOf, pagesLabel, pickDocs, scoreDocs, search, toInfo, workId,
  type OlDoc, type Scored,
} from '../src/lookup/sources/openlibrary';
import { fakeFetch, hasFixtures, replayFetch, type FakeFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string, hint = '', typedTitle = term): LookupQuery => ({ term, typedTitle, hint, category: 'books' });

beforeEach(() => resetPacing());

// Wraps a fetch and records each request's URL and headers.
function spy(inner: FakeFetch): FakeFetch & { seen: { url: string; headers: Headers }[] } {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, headers: new Headers(init?.headers) });
    return inner(input, init);
  }) as FakeFetch & { seen: typeof seen };
  f.calls = inner.calls;
  f.unmatched = inner.unmatched;
  f.seen = seen;
  return f;
}

// ---- logic tests: small synthetic inputs, not claims about Open Library's real payloads ----

describe('headers and genre list', () => {
  it('names the app and asks for JSON', () => {
    expect(OL_HEADERS).toEqual({
      'User-Agent': 'MediaTrackerApp/1.0 (private app; contact via GitHub DirtyDan8525/media-tracker)',
      Accept: 'application/json',
    });
  });
  it('has the script\'s 26 genres', () => {
    expect(BOOK_GENRES).toHaveLength(26);
    expect(BOOK_GENRES[0]).toBe('science fiction');
    expect(BOOK_GENRES[25]).toBe('classics');
  });
});

describe('genresOf', () => {
  it('title-cases matches against the genre list', () => {
    expect(genresOf(['Science fiction', 'Fantasy fiction'])).toBe('Science Fiction, Fantasy');
  });
  it('"science fiction" wins over "science"', () => {
    expect(genresOf(['Science fiction', 'Science'])).toBe('Science Fiction');
    expect(genresOf(['Science', 'Fantasy'])).toBe('Fantasy, Science');
    expect(genresOf(['hard science fiction'])).toBe('Science Fiction');
  });
  it('matches substrings of a subject, in the order of the genre list, at most 3', () => {
    expect(genresOf(['Humor', 'Thrillers', 'Historical fiction', 'Fantasy', 'Horror tales'])).toBe('Fantasy, Horror, Thriller');
  });
  it('title-cases multi-word genres', () => {
    expect(genresOf(['true crime'])).toBe('True Crime');
    expect(genresOf(['Space opera'])).toBe('Space Opera');
  });
  it('empty and missing subject lists give an empty string', () => {
    expect(genresOf([])).toBe('');
    expect(genresOf(undefined)).toBe('');
    expect(genresOf(null)).toBe('');
    expect(genresOf(['Cooking'])).toBe('');
  });
});

describe('workId', () => {
  it('strips the /works/ prefix', () => {
    expect(workId('/works/OL17618W')).toBe('OL17618W');
    expect(workId('OL1W')).toBe('OL1W');
    expect(workId(undefined)).toBe('');
  });
});

describe('scoreDocs and pickDocs (openLibrary_ scoring)', () => {
  const doc = (title: string, authors: string[], extra: Partial<OlDoc> = {}): OlDoc => ({ title, author_name: authors, edition_count: 1, ...extra });

  it('no hint: score is title similarity plus 0.12 x edition rank', () => {
    const r = scoreDocs([doc('Abcd', ['Someone'])], 'abcd', '');
    expect(r[0]!.score).toBeCloseTo(1 + 0.12, 5);
    expect(r[0]!.who).toBe('Someone');
  });
  it('with a hint: 0.7 title + 0.3 author similarity', () => {
    const r = scoreDocs([doc('Abcd', ['Efgh Ijkl'])], 'abcd', 'efgh ijkl');
    expect(r[0]!.score).toBeCloseTo(0.7 + 0.3 + 0.12, 5);
    const wrong = scoreDocs([doc('Abcd', ['Zzzz Qqqq'])], 'abcd', 'efgh ijkl');
    expect(wrong[0]!.score).toBeLessThan(0.7 + 0.12 + 0.3);
    expect(wrong[0]!.score).toBeGreaterThanOrEqual(0.7 + 0.12 - 1e-9);
  });
  it('a typed (year) adds 0.2 when first_publish_year matches', () => {
    const docs = [doc('Abcd', ['A'], { first_publish_year: 1999, edition_count: 5 }), doc('Abcd', ['A'], { first_publish_year: 2007, edition_count: 5 })];
    const r = scoreDocs(docs, 'Abcd (2007)', '');
    expect(r[0]!.d.first_publish_year).toBe(2007);
    expect(r[0]!.score - r[1]!.score).toBeCloseTo(0.2, 5);
  });
  it('more editions rank higher: bonus 0.12 x (1 - rank / count)', () => {
    const r = scoreDocs([doc('Abcd', ['A'], { edition_count: 1 }), doc('Abcd', ['A'], { edition_count: 9 })], 'abcd', '');
    expect(r[0]!.d.edition_count).toBe(9);
    expect(r[0]!.score).toBeCloseTo(1 + 0.12, 5);
    expect(r[1]!.score).toBeCloseTo(1 + 0.12 * 0.5, 5);
  });
  it('the title in brackets is optional: "We Are Legion (We Are Bob)" matches "We Are Legion"', () => {
    const r = scoreDocs([doc('We Are Legion', ['Dennis E. Taylor'])], 'We Are Legion (We Are Bob)', '');
    expect(r[0]!.score).toBeCloseTo(1.12, 5);
  });
  it('title plus subtitle also counts', () => {
    const r = scoreDocs([doc('Abcd', ['A'], { subtitle: 'Efgh' })], 'abcd efgh', '');
    expect(r[0]!.score).toBeCloseTo(1.12, 5);
  });

  const sc = (...scores: number[]): Scored[] => scores.map((score, i) => ({ d: { title: `t${i}` }, who: '', score }));
  it('accepts 0.45 or more, rejects under it', () => {
    expect(pickDocs(sc(0.44))).toBeNull();
    expect(pickDocs(sc(0.45))).toHaveLength(1);
    expect(pickDocs([])).toBeNull();
  });
  it('choices window 0.1 around the top, at most 8', () => {
    expect(pickDocs(sc(1.0, 0.91, 0.9, 0.89))).toHaveLength(3);
    expect(pickDocs(sc(1, 1, 1, 1, 1, 1, 1, 1, 1, 1))).toHaveLength(8);
  });
});

describe('toInfo', () => {
  it('maps a doc: cover id to the -L jpg, sub is author · year, sourceId the bare work key', () => {
    const c: Scored = { d: { key: '/works/OL1W', title: 'T', cover_i: 42, first_publish_year: 2016, subject: ['Science fiction'] }, who: 'A, B', score: 1 };
    expect(toInfo(c)).toEqual({
      title: 'T', trusted: false, creator: 'A, B', genres: 'Science Fiction', cover: 'https://covers.openlibrary.org/b/id/42-L.jpg',
      sub: 'A, B · 2016', source: 'openlibrary', sourceId: 'OL1W',
    });
  });
  it('no cover, no year, no key', () => {
    expect(toInfo({ d: { title: 'T' }, who: '', score: 1 })).toMatchObject({ cover: '', sub: '', creator: '', genres: '' });
    expect(toInfo({ d: { title: 'T' }, who: '', score: 1 }).sourceId).toBeUndefined();
  });
  it('a sourceId that is not shaped like an id is dropped', () => {
    expect(toInfo({ d: { title: 'T', key: '/authors/../x' }, who: '', score: 1 }).sourceId).toBeUndefined();
  });
});

describe('details pieces', () => {
  it('pagesLabel', () => {
    expect(pagesLabel(432)).toBe('432 pages');
    expect(pagesLabel(1)).toBe('1 pages');
    expect(pagesLabel(0)).toBe('');
    expect(pagesLabel(undefined)).toBe('');
    expect(pagesLabel(null)).toBe('');
  });
  it('descriptionOf takes a string or an object\'s value', () => {
    expect(descriptionOf('Plain text.')).toBe('Plain text.');
    expect(descriptionOf({ type: '/type/text', value: 'Wrapped text.' })).toBe('Wrapped text.');
    expect(descriptionOf(undefined)).toBe('');
    expect(descriptionOf({ type: '/type/text' })).toBe('');
    expect(descriptionOf(42)).toBe('');
  });
  it('formatDetails: year, pages, first publisher, trimmed synopsis', () => {
    expect(formatDetails({ description: { value: 'A <b>Bob</b>.' } }, { first_publish_year: 2016, number_of_pages_median: 432, publisher: ['Audible', 'Ethan Ellenberg'] }))
      .toEqual({ releaseDate: '2016', synopsis: 'A Bob.', lengthLabel: '432 pages', origin: 'Audible' });
  });
  it('either half alone still gives a result; both missing gives null; no "undefined"', () => {
    expect(formatDetails({ description: 'Only text.' }, null)).toEqual({ releaseDate: '', synopsis: 'Only text.', lengthLabel: '', origin: '' });
    expect(formatDetails(null, { first_publish_year: 1999 })).toEqual({ releaseDate: '1999', synopsis: '', lengthLabel: '', origin: '' });
    expect(formatDetails(null, null)).toBeNull();
    expect(JSON.stringify(formatDetails({}, {}))).not.toMatch(/undefined|null/);
  });
  it('trims a long synopsis to 600 characters', () => {
    expect(formatDetails({ description: 'word '.repeat(300) }, null)!.synopsis.length).toBeLessThanOrEqual(601);
  });
});

describe('registration', () => {
  it('openlibrary is registered with search and details', () => {
    expect(typeof SOURCES.openlibrary?.search).toBe('function');
    expect(typeof SOURCES.openlibrary?.details).toBe('function');
  });
});

// ---- request tests ----

const OL = 'https://openlibrary.org';
const docs = JSON.stringify({
  docs: [
    { key: '/works/OL17618W', title: 'We Are Legion (We Are Bob)', author_name: ['Dennis E. Taylor'], first_publish_year: 2016, cover_i: 77, subject: ['Science fiction', 'Clones'], edition_count: 30 },
    { key: '/works/OL1W', title: 'Zzzzz', author_name: ['Nobody'], edition_count: 1 },
  ],
});

describe('search requests', () => {
  it('one request: q with the year stripped, author hint, fields and limit; User-Agent and Accept sent', async () => {
    const f = spy(fakeFetch({ [`${OL}/search.json`]: { body: docs } }));
    const r = await search(q('We Are Legion (We Are Bob)', 'Dennis E. Taylor'), deps(f));
    expect(f.calls).toHaveLength(1);
    const u = new URL(f.calls[0]!);
    expect(u.origin + u.pathname).toBe(`${OL}/search.json`);
    expect(u.searchParams.get('q')).toBe('We Are Legion (We Are Bob)');
    expect(u.searchParams.get('author')).toBe('Dennis E. Taylor');
    expect(u.searchParams.get('limit')).toBe('20');
    expect(u.searchParams.get('fields')).toBe('key,title,subtitle,author_name,first_publish_year,cover_i,subject,edition_count');
    expect(f.seen[0]!.headers.get('user-agent')).toBe(OL_HEADERS['User-Agent']);
    expect(f.seen[0]!.headers.get('accept')).toBe('application/json');
    expect(r).toMatchObject({
      title: 'We Are Legion (We Are Bob)', creator: 'Dennis E. Taylor', genres: 'Science Fiction', sub: 'Dennis E. Taylor · 2016',
      cover: 'https://covers.openlibrary.org/b/id/77-L.jpg', source: 'openlibrary', sourceId: 'OL17618W',
    });
    expect(r?.choices).toBeUndefined();
  });
  it('no author param without a hint; the typed (year) is not sent', async () => {
    const f = fakeFetch({ [`${OL}/search.json`]: { body: docs } });
    await search(q('Abcd (2007)'), deps(f));
    const u = new URL(f.calls[0]!);
    expect(u.searchParams.get('q')).toBe('Abcd');
    expect(u.searchParams.has('author')).toBe(false);
  });
  it('close runners-up become choices (top first, no nesting)', async () => {
    const two = JSON.stringify({ docs: [
      { key: '/works/OL1W', title: 'Abcd', author_name: ['A'], edition_count: 5 },
      { key: '/works/OL2W', title: 'Abcd', author_name: ['B'], edition_count: 5 },
    ] });
    const r = await search(q('Abcd'), deps(fakeFetch({ [`${OL}/search.json`]: { body: two } })));
    expect(r?.choices?.map((c) => c.sourceId)).toEqual(['OL1W', 'OL2W']);
    expect(r?.choices?.every((c) => c.source === 'openlibrary' && c.choices === undefined)).toBe(true);
  });
  it('misses on error status, empty docs, or weak match', async () => {
    expect(await search(q('Abcd'), deps(fakeFetch({ [`${OL}/search.json`]: 503 })))).toBeNull();
    expect(await search(q('Abcd'), deps(fakeFetch({ [`${OL}/search.json`]: { body: '{"docs":[]}' } })))).toBeNull();
    expect(await search(q('Abcd'), deps(fakeFetch({ [`${OL}/search.json`]: { body: '{}' } })))).toBeNull();
    expect(await search(q('Abcd'), deps(fakeFetch({ [`${OL}/search.json`]: { body: JSON.stringify({ docs: [{ title: 'Qqqqqqqq', edition_count: 1 }] }) } })))).toBeNull();
  });
});

describe('details input and requests', () => {
  const work = `${OL}/works/OL17618W.json`;
  const meta = `${OL}/search.json`;
  const workBody = { body: JSON.stringify({ description: { type: '/type/text', value: 'Bob wakes up.' } }) };
  const metaBody = { body: JSON.stringify({ docs: [{ first_publish_year: 2016, number_of_pages_median: 432, publisher: ['Audible Studios'] }] }) };

  it('rejects anything not shaped OL<digits>W without a request', async () => {
    const f = fakeFetch({});
    for (const bad of ['abc', '/works/OL1W', 'OL1W/../x', 'OL1A', 'OLW', '123', 'OL1W?x=1', '']) expect(await details(bad, deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it('two requests (work json, then a key: search for the facts), both with the User-Agent', async () => {
    const f = spy(fakeFetch({ [work]: workBody, [meta]: metaBody }));
    expect(await details('OL17618W', deps(f))).toEqual({ releaseDate: '2016', synopsis: 'Bob wakes up.', lengthLabel: '432 pages', origin: 'Audible Studios' });
    expect(f.calls).toHaveLength(2);
    expect(f.calls).toContain(work);
    const m = f.seen.find((s) => s.url.startsWith(meta))!;
    const u = new URL(m.url);
    expect(u.searchParams.get('q')).toBe('key:/works/OL17618W');
    expect(u.searchParams.get('fields')).toBe('first_publish_year,number_of_pages_median,publisher');
    expect(u.searchParams.get('limit')).toBe('1');
    for (const s of f.seen) expect(s.headers.get('user-agent')).toBe(OL_HEADERS['User-Agent']);
  });
  it('one request failing leaves its fields empty', async () => {
    expect(await details('OL17618W', deps(fakeFetch({ [work]: 500, [meta]: metaBody }))))
      .toEqual({ releaseDate: '2016', synopsis: '', lengthLabel: '432 pages', origin: 'Audible Studios' });
    expect(await details('OL17618W', deps(fakeFetch({ [work]: workBody, [meta]: 500 }))))
      .toEqual({ releaseDate: '', synopsis: 'Bob wakes up.', lengthLabel: '', origin: '' });
  });
  it('both failing gives null', async () => {
    expect(await details('OL17618W', deps(fakeFetch({ [work]: 404, [meta]: 500 })))).toBeNull();
  });
  it('an empty docs list counts as no facts', async () => {
    expect(await details('OL17618W', deps(fakeFetch({ [work]: workBody, [meta]: { body: '{"docs":[]}' } }))))
      .toEqual({ releaseDate: '', synopsis: 'Bob wakes up.', lengthLabel: '', origin: '' });
  });
});

// ---- fixture tests: skipped until Dan records the cases ----

describe.skipIf(!hasFixtures('openlibrary', 'we-are-legion'))('openlibrary fixture: we-are-legion', () => {
  it('finds the book by Dennis E. Taylor with Science Fiction among the genres', async () => {
    const f = replayFetch('openlibrary', 'we-are-legion');
    const r = await search(q('We Are Legion (We Are Bob)', 'Dennis E. Taylor'), deps(f));
    expect(r?.creator).toContain('Dennis E. Taylor');
    expect(r?.genres).toContain('Science Fiction');
    expect(r?.source).toBe('openlibrary');
    expect(r?.sourceId).toMatch(/^OL\d+W$/);
    expect(r?.cover).toMatch(/^https:\/\/covers\.openlibrary\.org\//);
    if (r?.choices) {
      expect(r.choices.length).toBeGreaterThan(1);
      expect(r.choices.length).toBeLessThanOrEqual(8);
      expect(r.choices[0]!.sourceId).toBe(r.sourceId);
    }
    expect(f.unmatched).toEqual([]);
  });
});

describe.skipIf(!hasFixtures('openlibrary', 'details-we-are-legion'))('openlibrary fixture: details-we-are-legion', () => {
  it('gives year, plain synopsis, pages label and publisher', async () => {
    const f = replayFetch('openlibrary', 'details-we-are-legion');
    const found = await search(q('We Are Legion (We Are Bob)', 'Dennis E. Taylor'), deps(f));
    const r = await details(found!.sourceId!, deps(f));
    expect(r?.releaseDate).toMatch(/^\d{4}$/);
    expect(r?.synopsis.length).toBeGreaterThan(0);
    expect(r?.lengthLabel).toMatch(/^\d+ pages$/);
    expect(r?.origin).not.toBe('');
    expect(f.unmatched).toEqual([]);
  });
});
