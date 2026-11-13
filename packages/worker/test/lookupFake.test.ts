import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
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

  it('in prod the fake is NOT used even with LOOKUP_FAKE=1 (authenticated request reaches the real chain)', async () => {
    const TEAM = 'team.example.cloudflareaccess.com';
    const AUD = 'test-aud-tag';
    const key = (await generateKeyPair('RS256', { extractable: true })) as CryptoKeyPair;
    const jwk: JWK = { ...(await exportJWK(key.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    const jwt = await new SignJWT({ email: 'dan@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' })
      .setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt().setExpirationTime('5m')
      .sign(key.privateKey);
    const sourceCalls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input as RequestInfo).url;
      if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
      sourceCalls.push(url);
      return new Response('{}', { status: 500 });
    });
    const res = await app.fetch(
      new Request('https://app.test/api/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt },
        body: JSON.stringify({ category: 'anime', term: 'frieren' }),
      }),
      { ...env, ENVIRONMENT: 'prod', DEV_EMAIL: undefined, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, LOOKUP_FAKE: '1' } as Env,
    );
    expect(res.status).toBe(200);
    // The real chain ran against the failing stub, so it found nothing; the canned match must not appear.
    const body = (await res.json()) as { info: { creator?: string } | null };
    expect(body.info?.creator).not.toBe('Test Studio');
    expect(sourceCalls.length).toBeGreaterThan(0);
  });

  it('is off unless LOOKUP_FAKE is exactly "1"', async () => {
    const res = await call({ ENVIRONMENT: 'dev', LOOKUP_FAKE: 'true' }, '/api/lookup/details', { source: 'anilist', sourceId: '1' });
    expect(((await res.json()) as { details: unknown }).details).not.toMatchObject({ synopsis: 'Test synopsis.' });
  });
});
