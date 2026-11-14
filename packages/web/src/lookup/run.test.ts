import type { LookupInfo } from '@media-tracker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, type Call } from '../test/mockApi';
import { buildLookupQuery } from './query';
import { runLookup } from './run';

const ANILIST = 'POST https://graphql.anilist.co/';
const media = (id: number, english: string) => ({ id, title: { romaji: english, english }, popularity: 1 });
const reply = (list: unknown[]) => ({ body: { data: { Page: { media: list } } } });
const serverInfo: LookupInfo = { title: 'From Server', trusted: true, cover: '', genres: '', creator: '', source: 'kitsu', sourceId: '9' };

const anime = (term: string) => buildLookupQuery('anime', term, '');
const serverCalls = (calls: Call[]) => calls.filter((c) => c.path === '/api/lookup');
const requested = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u));

afterEach(() => vi.unstubAllGlobals());

describe('runLookup (anime tries AniList on the device first)', () => {
  it('a device hit is returned without calling the server', async () => {
    const calls = mockFetch({ [ANILIST]: reply([media(7, 'Frieren')]), 'POST /api/lookup': { body: { info: serverInfo } } });
    const info = await runLookup(anime('frieren'));
    expect(info).toMatchObject({ title: 'Frieren', source: 'anilist', sourceId: '7' });
    expect(serverCalls(calls)).toHaveLength(0);
  });

  it('nothing found on the device falls back to the server', async () => {
    // One query variant, scores 0, and Kitsu (unreachable in this mock) gives no spelling hint.
    const calls = mockFetch({ [ANILIST]: reply([media(7, 'Frieren')]), 'POST /api/lookup': { body: { info: serverInfo } } });
    expect(await runLookup(anime('zzzzzz'))).toEqual(serverInfo);
    expect(serverCalls(calls)).toHaveLength(1);
    expect(serverCalls(calls)[0]!.body).toEqual({ category: 'anime', term: 'zzzzzz', typedTitle: 'zzzzzz', hint: '' });
  });

  it('a failing AniList (500) falls back to the server', async () => {
    const calls = mockFetch({ [ANILIST]: { status: 500, body: {} }, 'POST /api/lookup': { body: { info: serverInfo } } });
    expect(await runLookup(anime('frieren'))).toEqual(serverInfo);
    expect(serverCalls(calls)).toHaveLength(1);
  });

  it('a blocked or offline AniList (fetch throws) falls back to the server', async () => {
    const calls = mockFetch({ 'POST /api/lookup': { body: { info: serverInfo } } }); // AniList unhandled: the mock throws a TypeError
    expect(await runLookup(anime('frieren'))).toEqual(serverInfo);
    expect(serverCalls(calls)).toHaveLength(1);
  });

  it('never throws: a failing device and a failing server give null', async () => {
    mockFetch({ [ANILIST]: { status: 503, body: {} }, 'POST /api/lookup': { status: 500, body: { error: 'boom' } } });
    expect(await runLookup(anime('frieren'))).toBeNull();
  });

  it('other categories go to the server only', async () => {
    const calls = mockFetch({ [ANILIST]: reply([media(7, 'Frieren')]), 'POST /api/lookup': { body: { info: serverInfo } } });
    expect(await runLookup(buildLookupQuery('movies', 'frieren', ''))).toEqual(serverInfo);
    expect(serverCalls(calls)).toHaveLength(1);
    expect(requested().some((u) => u.includes('anilist'))).toBe(false);
  });

  it('a Spotify link in the anime tab goes to the server only', async () => {
    const calls = mockFetch({ [ANILIST]: reply([media(7, 'Frieren')]), 'POST /api/lookup': { body: { info: serverInfo } } });
    await runLookup(anime('https://open.spotify.com/album/abc123'));
    expect(serverCalls(calls)).toHaveLength(1);
    expect(requested().some((u) => u.includes('anilist'))).toBe(false);
  });
});
