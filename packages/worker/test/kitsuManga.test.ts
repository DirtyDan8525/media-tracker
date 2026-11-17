import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { SourceFailure } from '../src/lookup/http';
import { SOURCES, type LookupDeps, type LookupQuery } from '../src/lookup/sources/index';
import { details, formatMangaDetails, mangaToInfo, pickMangaBest, search, type KitsuManga } from '../src/lookup/sources/kitsu';
import { fakeFetch, replayFetch } from './fakeFetch';

const deps = (f: typeof fetch): LookupDeps & { log: string[] } => ({ fetch: f, env: env as Env, log: [] });
const q = (term: string): LookupQuery => ({ term, typedTitle: term, hint: '', category: 'manga' });

const manga = (id: string, attributes: KitsuManga['attributes']): KitsuManga => ({ id, attributes });
const SEARCH = 'https://kitsu.io/api/edge/manga?filter[text]=';

// test/fixtures/kitsu/manga-berserk is hand-written in Kitsu's JSON:API shape (the recording host had no
// network access); `npm run record -w packages/worker` replaces it with a real recording.
describe('kitsu manga search (fixture)', () => {
  it('skips the novel and the one-shot, and maps title, cover, genres, author and the manga: id', async () => {
    const f = replayFetch('kitsu', 'manga-berserk');
    const r = await search(q('berserk'), deps(f));
    expect(r).toEqual({
      title: 'Berserk', trusted: true, cover: 'https://media.kitsu.app/manga/poster_images/38/large.jpg',
      genres: 'Action, Dark Fantasy, Horror', creator: 'Kentarou Miura', source: 'kitsu', sourceId: 'manga:38',
    });
    expect(f.unmatched).toEqual([]);
  });

  it('the registered kitsu source routes the manga category here, and anime still goes to /anime', async () => {
    const f = replayFetch('kitsu', 'manga-berserk');
    expect((await SOURCES.kitsu!.search(q('berserk'), deps(f)))?.sourceId).toBe('manga:38');
    const g = fakeFetch({ 'https://kitsu.io/api/edge/anime?filter[text]=': { body: '{"data":[]}' } });
    await SOURCES.kitsu!.search({ ...q('berserk'), category: 'anime' }, deps(g));
    expect(g.calls[0]).toContain('/api/edge/anime?');
  });

  it('retries without the staff include when Kitsu rejects it, and then has no author', async () => {
    const hit = { data: [{ id: '38', attributes: { canonicalTitle: 'Berserk', subtype: 'manga' } }] };
    const f = fakeFetch({
      [`${SEARCH}berserk&page[limit]=10&include=categories,staff.person`]: 400,
      [`${SEARCH}berserk&page[limit]=10&include=categories`]: { body: JSON.stringify(hit) },
    });
    expect(await search(q('berserk'), deps(f))).toMatchObject({ title: 'Berserk', creator: '', sourceId: 'manga:38' });
    expect(f.calls).toHaveLength(2);
  });

  it('null on a non-200 and when nothing scores well', async () => {
    expect(await search(q('berserk'), deps(fakeFetch({ [SEARCH]: 503 })))).toBeNull();
    const poor = fakeFetch({ [SEARCH]: { body: JSON.stringify({ data: [manga('2', { canonicalTitle: 'Totally Unrelated' })] }) } });
    expect(await search(q('zzzzzz'), deps(poor))).toBeNull();
  });
});

describe('pickMangaBest', () => {
  const novel = manga('1', { canonicalTitle: 'Same Name', subtype: 'novel' });
  const oneshot = manga('2', { canonicalTitle: 'Same Name', subtype: 'oneshot' });
  const series = manga('3', { canonicalTitle: 'Same Name', subtype: 'manga' });
  const manhwa = manga('4', { canonicalTitle: 'Same Name', subtype: 'manhwa' });

  it('prefers a real series over novels and one-shots, whatever the order', () => {
    expect(pickMangaBest([novel, oneshot, series], 'same name')?.id).toBe('3');
    expect(pickMangaBest([novel, manhwa], 'same name')?.id).toBe('4');
  });
  it('falls back to a one-shot or novel when nothing else matches', () => {
    expect(pickMangaBest([novel, oneshot], 'same name')?.id).toBe('1');
    expect(pickMangaBest([novel, manga('9', { canonicalTitle: 'Other Thing', subtype: 'manga' })], 'same name')?.id).toBe('1');
    expect(pickMangaBest([], 'same name')).toBeNull();
  });
});

describe('mangaToInfo', () => {
  it('title falls back en -> canonical, cover falls back to original, no staff means no author, source id is prefixed', () => {
    expect(mangaToInfo(manga('7', { titles: { en: 'English' }, canonicalTitle: 'Canon', posterImage: { original: 'https://x/o.jpg' } }))).toEqual({
      title: 'English', trusted: true, cover: 'https://x/o.jpg', genres: '', creator: '', source: 'kitsu', sourceId: 'manga:7',
    });
  });
});

describe('formatMangaDetails', () => {
  it('year, trimmed synopsis, volumes else chapters, and the format', () => {
    expect(formatMangaDetails({ startDate: '1989-08-25', synopsis: 'Guts &amp; Griffith.', volumeCount: 41, chapterCount: 364, subtype: 'manga' })).toEqual({
      releaseDate: '1989-08-25', synopsis: 'Guts & Griffith.', lengthLabel: '41 volumes', origin: 'Manga', progressTotal: 364,
    });
    expect(formatMangaDetails({ volumeCount: 1 }).lengthLabel).toBe('1 volume');
    expect(formatMangaDetails({ volumeCount: 0, chapterCount: 12 }).lengthLabel).toBe('12 chapters');
    expect(formatMangaDetails({ chapterCount: 1 }).lengthLabel).toBe('1 chapter');
    expect(formatMangaDetails({ subtype: 'manhwa', startDate: '2020' })).toMatchObject({ releaseDate: '2020', origin: 'Manhwa' });
    expect(formatMangaDetails({})).toEqual({ releaseDate: '', synopsis: '', lengthLabel: '', origin: '' });
  });
});

describe('kitsu details for a manga: id', () => {
  const URL = 'https://kitsu.io/api/edge/manga/38';
  it('fetches /manga/<id>, not /anime/<id>', async () => {
    const f = fakeFetch({ [URL]: { body: JSON.stringify({ data: { id: '38', attributes: { startDate: '1989-08-25', volumeCount: 41, subtype: 'manga' } } }) } });
    expect(await details('manga:38', deps(f))).toMatchObject({ releaseDate: '1989-08-25', lengthLabel: '41 volumes', origin: 'Manga' });
    expect(f.calls).toEqual([URL]);
  });
  it('a 404 is null, a 5xx fails, a bad id is null without a request', async () => {
    expect(await details('manga:38', deps(fakeFetch({ [URL]: 404 })))).toBeNull();
    await expect(details('manga:38', deps(fakeFetch({ [URL]: 503 })))).rejects.toBeInstanceOf(SourceFailure);
    const f = fakeFetch({});
    expect(await details('manga:abc', deps(f))).toBeNull();
    expect(f.calls).toEqual([]);
  });
});
