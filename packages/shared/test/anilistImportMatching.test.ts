import { describe, expect, it, vi } from 'vitest';
import { aniListNames, findExisting, lookupAniList, tokenSimilarity, type AniListEntry, type AniListExisting as Existing, type FetchDeps } from '../src';

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const entry = (id: number, title: { english?: string | null; romaji?: string | null; native?: string | null }, extra: { synonyms?: string[]; year?: number | null } = {}): AniListEntry => ({
  status: 'COMPLETED', score: 8, progress: 12,
  media: { id, title, synonyms: extra.synonyms ?? [], episodes: 12, startDate: { year: extra.year ?? null } },
});
const gql = (entries: AniListEntry[]) => ({ data: { MediaListCollection: { lists: [{ entries }] } } });
function deps(anime: AniListEntry[], manga: AniListEntry[] = []): FetchDeps {
  return {
    fetch: (async (_i: RequestInfo | URL, init?: RequestInit) =>
      json(gql(JSON.parse(String(init?.body)).variables.type === 'ANIME' ? anime : manga))) as unknown as typeof fetch,
  };
}
const mine = (title: string, over: Partial<Existing> = {}): Existing => ({ category: 'anime', title, source: null, sourceId: null, ...over });

describe('AniList matching', () => {
  it('query asks for native titles and synonyms', async () => {
    const fetch = vi.fn(async () => json(gql([])));
    await lookupAniList('dan8525', [], { fetch: fetch as unknown as typeof globalThis.fetch });
    const q = JSON.parse(String((fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1].body)).query as string;
    expect(q).toContain('native');
    expect(q).toContain('synonyms');
  });

  it('same anilist id is a same-title match even with a different name', async () => {
    const b = await lookupAniList('dan8525', [mine('Totally Different', { source: 'anilist', sourceId: '5' })], deps([entry(5, { english: 'Frieren' })]));
    expect(b.rows).toEqual([]);
    expect(b.matches).toMatchObject([{ kind: 'same', reason: 'id' }]);
    expect(b.skipped.anime).toBe(1);
  });

  it('equal normalized title: english, romaji, native or a synonym', async () => {
    const e = entry(1, { english: 'Attack on Titan', romaji: 'Shingeki no Kyojin', native: '進撃の巨人' }, { synonyms: ['AoT'] });
    for (const t of ['attack on titan!', 'Shingeki no Kyojin', '進撃の巨人', 'the AoT']) {
      const b = await lookupAniList('dan8525', [mine(t)], deps([e]));
      expect(b.matches, t).toMatchObject([{ kind: 'same', reason: 'title' }]);
      expect(b.rows).toEqual([]);
    }
  });

  it('one name containing the other (4+ chars, whole words) is a possible match', async () => {
    const b = await lookupAniList('dan8525', [mine('Attack on Titan')], deps([entry(1, { english: 'Attack on Titan Final Season' })]));
    expect(b.matches).toMatchObject([{ kind: 'possible', reason: 'close' }]);
    expect(b.skipped.anime).toBe(0);
    expect(b.rows).toEqual([]);
  });

  it('too-short or partial-word containment is not a match', async () => {
    expect((await lookupAniList('dan8525', [mine('Ore')], deps([entry(1, { english: 'Ore Monogatari' })]))).matches).toEqual([]);
    expect((await lookupAniList('dan8525', [mine('Monogatari')], deps([entry(1, { english: 'Monogatarix' })]))).matches).toEqual([]);
  });

  it('same words in another order (token similarity >= 0.8) is possible', () => {
    expect(tokenSimilarity('one two three four five', 'five four three two one')).toBe(1);
    const hit = findExisting({ category: 'anime', sourceId: '1' } as never, ['love of the sea blue'], null, [mine('blue sea of the love')]);
    expect(hit).toMatchObject({ kind: 'possible' });
    expect(tokenSimilarity('a b c d e', 'a b c d f')).toBeLessThan(0.8);
  });

  it('year guard: close names with different years do not match; equal-title still does', async () => {
    const e = entry(1, { english: 'Fate Zero Remake' }, { year: 2024 });
    expect((await lookupAniList('dan8525', [mine('Fate Zero', { releaseDate: '2011-10-01' })], deps([e]))).matches).toEqual([]);
    expect((await lookupAniList('dan8525', [mine('Fate Zero', { releaseDate: '2024' })], deps([e]))).matches).toHaveLength(1);
    expect((await lookupAniList('dan8525', [mine('Fate Zero')], deps([e]))).matches).toHaveLength(1);
    const same = entry(2, { english: 'Fate Zero' }, { year: 2024 });
    expect((await lookupAniList('dan8525', [mine('Fate Zero', { releaseDate: '2011' })], deps([same]))).matches).toMatchObject([{ kind: 'same' }]);
  });

  it('never matches across categories', async () => {
    const b = await lookupAniList('dan8525', [mine('Berserk', { category: 'movies' }), mine('Berserk', { category: 'manga' })], deps([entry(1, { english: 'Berserk' })]));
    expect(b.matches).toEqual([]);
    expect(b.rows).toHaveLength(1);
    const m = await lookupAniList('dan8525', [mine('Berserk', { category: 'manga' })], deps([], [entry(9, { english: 'Berserk' })]));
    expect(m.matches).toMatchObject([{ kind: 'same', row: { category: 'manga' } }]);
  });

  it('prefers an equal title over a closer-looking candidate, and aniListNames dedupes', () => {
    const hit = findExisting({ category: 'anime' } as never, ['naruto'], null, [mine('Naruto Shippuden'), mine('Naruto')]);
    expect(hit).toMatchObject({ kind: 'same', reason: 'title', existing: { title: 'Naruto' } });
    expect(aniListNames(entry(1, { english: 'X Y', romaji: 'x y', native: null }, { synonyms: ['X  Y', ''] }))).toEqual(['x y']);
  });
});
