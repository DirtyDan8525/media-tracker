import type { Entry } from '@media-tracker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { mockFetch, type Call } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { fillDetails } from './details';

const ANILIST = 'POST https://graphql.anilist.co/';
const FRIEREN = {
  id: 154587, description: 'An elf outlives her party.', startDate: { year: 2023, month: 9, day: 29 },
  episodes: 28, duration: 24, format: 'TV', season: 'FALL', seasonYear: 2023,
};

const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH');
const serverDetails = (calls: Call[]) => calls.filter((c) => c.path === '/api/lookup/details');
const echoPatch = (entry: Entry) => ({ 'PATCH /api/entries/:id': (b: unknown) => ({ body: { ...entry, ...(b as object) } }) });

afterEach(() => vi.unstubAllGlobals());

describe('fillDetails', () => {
  it('anilist: gets the details from AniList on the device, not the server, and saves them as filled', async () => {
    const entry = makeEntry();
    const calls = mockFetch({
      ...echoPatch(entry),
      [ANILIST]: { body: { data: { Media: FRIEREN } } },
      'POST /api/lookup/details': { body: { details: null } },
    });
    await fillDetails(makeQueryClient(), entry, { source: 'anilist', sourceId: '154587' });
    expect(serverDetails(calls)).toHaveLength(0);
    expect(patches(calls).map((c) => c.body)).toEqual([{
      releaseDate: '2023-09-29', synopsis: 'An elf outlives her party.', lengthLabel: '28 ep · 24 min', origin: 'TV · Fall 2023', detailsState: 'filled',
    }]);
  });

  it('anilist: when AniList fails the entry is left as it is (nothing saved, no server call)', async () => {
    const entry = makeEntry();
    for (const reply of [{ status: 500, body: {} }, { status: 503, body: {} }]) {
      const calls = mockFetch({ ...echoPatch(entry), [ANILIST]: reply });
      await fillDetails(makeQueryClient(), entry, { source: 'anilist', sourceId: '154587' });
      expect(patches(calls)).toHaveLength(0);
      expect(serverDetails(calls)).toHaveLength(0);
    }
    const calls = mockFetch(echoPatch(entry)); // AniList unreachable: the mock throws a TypeError
    await fillDetails(makeQueryClient(), entry, { source: 'anilist', sourceId: '154587' });
    expect(patches(calls)).toHaveLength(0);
  });

  it('anilist: an id AniList does not have (404) saves nothing', async () => {
    const entry = makeEntry();
    const calls = mockFetch({ ...echoPatch(entry), [ANILIST]: { status: 404, body: { errors: [] } } });
    await fillDetails(makeQueryClient(), entry, { source: 'anilist', sourceId: '154587' });
    expect(patches(calls)).toHaveLength(0);
  });

  it('other sources still use the server', async () => {
    const entry = makeEntry();
    const calls = mockFetch({
      ...echoPatch(entry),
      'POST /api/lookup/details': { body: { details: { releaseDate: '2023', synopsis: 'S', lengthLabel: 'L', origin: 'O' } } },
    });
    await fillDetails(makeQueryClient(), entry, { source: 'kitsu', sourceId: '42' });
    expect(serverDetails(calls)[0]!.body).toEqual({ source: 'kitsu', sourceId: '42' });
    expect(patches(calls)[0]!.body).toMatchObject({ synopsis: 'S', detailsState: 'filled' });
  });

  it('does nothing without a sourceId', async () => {
    const calls = mockFetch({});
    await fillDetails(makeQueryClient(), makeEntry(), { source: 'anilist', sourceId: undefined });
    expect(calls).toHaveLength(0);
  });
});
