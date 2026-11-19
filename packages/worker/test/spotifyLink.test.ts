import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256Hex } from '../src/auth/session';
import { normalize, pickItem } from '../src/lookup/spotifyLink';

const TOKEN = 'tokentokentokentokentokentokentokentokentok';
const vars = { SPOTIFY_ID: 'sp-id', SPOTIFY_SECRET: 'sp-secret' };

const get = (qs: string, extra: Partial<Env> = vars) =>
  app.fetch(
    new Request(`https://app.test/api/spotify/link?${qs}`, { headers: { cookie: `mt_session=${TOKEN}` } }),
    { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined, ...extra } as Env,
  );

const track = (name: string, artists: string[], id: string) => ({ id, name, artists: artists.map((a) => ({ name: a })), external_urls: { spotify: `https://open.spotify.com/track/${id}` } });

/** Mocks Spotify: the token endpoint and the search endpoint (answering `items`). Returns the request log. */
function mockSpotify(items: unknown[], kind = 'track') {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (url === 'https://accounts.spotify.com/api/token') return Response.json({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 });
    if (url.startsWith('https://api.spotify.com/v1/search')) return Response.json({ [`${kind}s`]: { items } });
    return new Response('{}', { status: 500 });
  });
  return calls;
}

beforeEach(async () => {
  const now = new Date().toISOString();
  await env.DB.exec('DELETE FROM lookup_cache');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM users');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, username, settings_json, is_admin, created_at) VALUES ('u1', 'dan@example.com', 'dan', '{}', 0, ?)").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, 'u1', ?, ?, ?)")
      .bind(await sha256Hex(TOKEN), now, new Date(Date.now() + 86_400_000).toISOString(), now),
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe('normalize and pickItem', () => {
  it('drops remaster and feat parts, case, punctuation and diacritics', () => {
    expect(normalize('Beyoncé - Halo (feat. Someone) - Remastered 2011')).toBe('beyonce halo');
    expect(normalize("Don't Stop Believin'")).toBe('dont stop believin');
  });
  it('title starts-with counts; artist must be among the artists', () => {
    const items = [track('Halo - Remastered', ['Beyoncé'], 'a'), track('Halo', ['Other'], 'b')];
    expect(pickItem(items, 'halo', 'Beyonce')?.id).toBe('a');
    expect(pickItem(items, 'Halo', 'Nobody')).toBeNull();
    expect(pickItem(items, 'Other song', 'Beyonce')).toBeNull();
  });
});

describe('GET /api/spotify/link', () => {
  it('returns the matching track url', async () => {
    const calls = mockSpotify([track('Halo (Live)', ['Someone'], 'x1'), track('Halo', ['Beyoncé'], 'hit1')]);
    const res = await get('kind=track&title=Halo&artist=Beyonce');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://open.spotify.com/track/hit1' });
    const token = calls.find((c) => c.url.includes('/api/token'))!;
    expect(new Headers(token.init?.headers).get('authorization')).toBe(`Basic ${btoa('sp-id:sp-secret')}`);
    const search = new URL(calls.find((c) => c.url.includes('/v1/search'))!.url);
    expect(search.searchParams.get('type')).toBe('track');
    expect(search.searchParams.get('limit')).toBe('5');
    expect(search.searchParams.get('q')).toBe('track:"Halo" artist:"Beyonce"');
  });

  it('uses album: for albums and builds the url from the id when external_urls is missing', async () => {
    const calls = mockSpotify([{ id: 'alb9', name: 'Lemonade', artists: [{ name: 'Beyoncé' }] }], 'album');
    const res = await get('kind=album&title=Lemonade&artist=Beyonc%C3%A9');
    expect(await res.json()).toEqual({ url: 'https://open.spotify.com/album/alb9' });
    expect(new URL(calls[1]!.url).searchParams.get('q')).toBe('album:"Lemonade" artist:"Beyoncé"');
  });

  it('artist mismatch gives null', async () => {
    mockSpotify([track('Halo', ['Somebody Else'], 'z')]);
    expect(await (await get('kind=track&title=Halo&artist=Beyonce')).json()).toEqual({ url: null });
  });

  it('without the secrets it answers null and never calls Spotify', async () => {
    const spy = mockSpotify([track('Halo', ['Beyoncé'], 'h')]);
    const res = await get('kind=track&title=Halo&artist=Beyonce', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
    expect(spy).toHaveLength(0);
  });

  it('a Spotify error answers null with 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/api/token') ? Response.json({ access_token: 't', expires_in: 3600 }) : new Response('{}', { status: 500 }));
    const res = await get('kind=track&title=Halo&artist=Beyonce');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
  });

  it('caches the token across two different lookups and the answer for a repeat', async () => {
    const calls = mockSpotify([track('Halo', ['Beyoncé'], 'hit1')]);
    await get('kind=track&title=Halo&artist=Beyonce');
    await get('kind=track&title=Halo&artist=Beyonce&x=1'.replace('Halo', 'Halo+'));
    const tokenCalls = () => calls.filter((c) => c.url.includes('/api/token')).length;
    expect(tokenCalls()).toBe(1);
    const searches = calls.filter((c) => c.url.includes('/v1/search')).length;
    await get('kind=track&title=Halo&artist=Beyonce'); // the first one again: answered from the cache
    expect(calls.filter((c) => c.url.includes('/v1/search')).length).toBe(searches);
  });

  it('bad input gives 400', async () => {
    mockSpotify([]);
    for (const qs of ['kind=playlist&title=x', 'title=x', 'kind=track', 'kind=track&title=', `kind=track&title=${'a'.repeat(301)}`, `kind=track&title=x&artist=${'a'.repeat(301)}`]) {
      expect((await get(qs)).status, qs).toBe(400);
    }
  });

  it('needs a signed-in user', async () => {
    const res = await app.fetch(new Request('https://app.test/api/spotify/link?kind=track&title=x'), { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined, ...vars } as Env);
    expect(res.status).toBe(401);
  });
});
