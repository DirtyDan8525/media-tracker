import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';

const call = (vars: Partial<Env>, path: string, body: unknown) =>
  app.fetch(
    new Request(`https://app.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { ...env, DEV_EMAIL: 'fake@example.com', ...vars } as Env,
  );

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec('DELETE FROM users');
});

describe('LOOKUP_FAKE', () => {
  it('in dev with LOOKUP_FAKE=1 returns a canned trusted match without calling any source', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await call({ ENVIRONMENT: 'dev', LOOKUP_FAKE: '1' }, '/api/lookup', { category: 'anime', term: 'sousou no frieren' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      info: {
        title: 'Sousou No Frieren',
        trusted: true,
        cover: 'https://app.test/icon-192.png',
        genres: 'Test',
        creator: 'Test Studio',
        source: 'anilist',
        sourceId: '1',
      },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('in dev with LOOKUP_FAKE=1 returns canned details', async () => {
    const res = await call({ ENVIRONMENT: 'dev', LOOKUP_FAKE: '1' }, '/api/lookup/details', { source: 'anilist', sourceId: '1' });
    expect(await res.json()).toEqual({
      details: { releaseDate: '2023-09-29', synopsis: 'Test synopsis.', lengthLabel: '24 min', origin: 'TV' },
    });
  });

  it('in prod the fake is NOT used even with LOOKUP_FAKE=1', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    // prod needs Access auth; an unauthenticated call is rejected before any lookup happens.
    const res = await call({ ENVIRONMENT: 'prod', LOOKUP_FAKE: '1' }, '/api/lookup', { category: 'anime', term: 'frieren' });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is off unless LOOKUP_FAKE is exactly "1"', async () => {
    const res = await call({ ENVIRONMENT: 'dev', LOOKUP_FAKE: 'true' }, '/api/lookup/details', { source: 'anilist', sourceId: '1' });
    expect(((await res.json()) as { details: unknown }).details).not.toMatchObject({ synopsis: 'Test synopsis.' });
  });
});
