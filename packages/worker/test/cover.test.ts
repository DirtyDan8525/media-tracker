import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';

const A = 'a@example.com';
const B = 'b@example.com';
const COVER = 'https://img.example.com/covers/frieren.jpg?size=big&x=1';

const call = (email: string, path: string, method = 'GET') =>
  app.fetch(
    new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' } }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
const mk = async (email: string, coverUrl: string) => {
  const res = await app.fetch(
    new Request('https://app.test/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'anime', title: 'T', coverUrl }),
    }),
    { ...env, ENVIRONMENT: 'dev', DEV_EMAIL: email } as Env,
  );
  expect(res.status).toBe(201);
};
const proxy = (email: string, url: string) => call(email, `/api/cover?url=${encodeURIComponent(url)}`);

const IMG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4]);
let fetchSpy: ReturnType<typeof vi.spyOn>;
const upstream = (make: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(make(String(input), init))) as typeof fetch);
};

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await env.DB.exec('DELETE FROM users');
});

describe('GET /api/cover', () => {
  it('serves an own cover with its content type', async () => {
    await mk(A, COVER);
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }));
    const res = await proxy(A, COVER);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(IMG);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(COVER);
  });

  it("someone else's cover URL is 404 and fetch is never called", async () => {
    await mk(A, COVER);
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }));
    const res = await proxy(B, COVER);
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a URL that is on no entry (even a lookalike) is 404 and never fetched', async () => {
    await mk(A, COVER);
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }));
    for (const url of ['https://evil.example.net/x.jpg', COVER + '&y=2', 'https://img.example.com/covers/frieren.jpg']) {
      expect((await proxy(A, url)).status).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('missing, unparseable, javascript: and ftp: are 400', async () => {
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }));
    expect((await call(A, '/api/cover')).status).toBe(400);
    for (const url of ['not a url', 'javascript:alert(1)', 'ftp://x.example.com/a.jpg', 'file:///etc/passwd', 'data:image/png;base64,AAAA']) {
      expect((await proxy(A, url)).status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an own cover pointing at a private or loopback host is not fetched', async () => {
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }));
    for (const url of ['http://127.0.0.1/a.jpg', 'http://169.254.169.254/latest', 'http://localhost/a.jpg', 'http://10.0.0.5/a.jpg', 'http://[::1]/a.jpg']) {
      await mk(A, url);
      expect((await proxy(A, url)).status).toBe(502);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('more than 3 redirects is 502', async () => {
    await mk(A, COVER);
    upstream((url) => new Response(null, { status: 302, headers: { location: `${url}x` } }));
    expect((await proxy(A, COVER)).status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // the first request plus 3 hops, then it gives up
  });

  it('a 3xx without Location is 502', async () => {
    await mk(A, COVER);
    upstream(() => new Response(null, { status: 302 }));
    expect((await proxy(A, COVER)).status).toBe(502);
  });

  it('decimal, hex, IPv4-mapped and reserved-range IP literals are not fetched', async () => {
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }));
    const urls = [
      'http://2130706433/a.jpg', 'http://0x7f.1/a.jpg', 'http://017700000001/a.jpg', 'http://127.1/a.jpg',
      'http://[::ffff:127.0.0.1]/a.jpg', 'http://[::ffff:7f00:1]/a.jpg', 'http://localhost./a.jpg',
      'http://198.18.0.1/a.jpg', 'http://198.19.255.1/a.jpg', 'http://192.0.0.8/a.jpg',
      'http://192.0.2.1/a.jpg', 'http://198.51.100.7/a.jpg', 'http://203.0.113.9/a.jpg',
    ];
    for (const url of urls) {
      await mk(A, url);
      expect((await proxy(A, url)).status, url).toBe(502);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a content-type with parameters is served as the bare type', async () => {
    await mk(A, COVER);
    upstream(() => new Response(IMG, { headers: { 'content-type': 'IMAGE/JPEG; charset=binary' } }));
    const res = await proxy(A, COVER);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('a redirect to a private host is refused', async () => {
    await mk(A, COVER);
    upstream(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    expect((await proxy(A, COVER)).status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to another public host', async () => {
    await mk(A, COVER);
    upstream((url) =>
      url === COVER
        ? new Response(null, { status: 301, headers: { location: 'https://cdn.example.com/c.jpg' } })
        : new Response(IMG, { headers: { 'content-type': 'image/jpeg' } }),
    );
    expect((await proxy(A, COVER)).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('upstream 404 is 502', async () => {
    await mk(A, COVER);
    upstream(() => new Response('nope', { status: 404, headers: { 'content-type': 'image/jpeg' } }));
    const res = await proxy(A, COVER);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream' });
  });

  it('a fetch error is 502', async () => {
    await mk(A, COVER);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    expect((await proxy(A, COVER)).status).toBe(502);
  });

  it('text/html and image/svg+xml are 502', async () => {
    await mk(A, COVER);
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', '']) {
      upstream(() => new Response('<html>', { headers: type ? { 'content-type': type } : {} }));
      expect((await proxy(A, COVER)).status).toBe(502);
    }
  });

  it('a declared content-length of 6 MB is 502', async () => {
    await mk(A, COVER);
    upstream(() => new Response(IMG, { headers: { 'content-type': 'image/jpeg', 'content-length': '6000000' } }));
    expect((await proxy(A, COVER)).status).toBe(502);
  });

  it('a body over the cap with no content-length is 502', async () => {
    await mk(A, COVER);
    const chunk = new Uint8Array(1_000_000);
    let sent = 0;
    upstream(
      () =>
        new Response(
          new ReadableStream({
            pull(ctrl) {
              if (sent++ < 8) ctrl.enqueue(chunk);
              else ctrl.close();
            },
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
    );
    expect((await proxy(A, COVER)).status).toBe(502);
    expect(sent).toBeLessThan(8); // stopped reading once past the cap
  });

  it('a body exactly at the cap is served', async () => {
    await mk(A, COVER);
    upstream(() => new Response(new Uint8Array(5_000_000), { headers: { 'content-type': 'image/png' } }));
    const res = await proxy(A, COVER);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(5_000_000);
  });

  it('a hanging upstream is 502 after the timeout', async () => {
    await mk(A, COVER);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    upstream(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }) as unknown as Response,
    );
    const pending = proxy(A, COVER);
    await vi.advanceTimersByTimeAsync(8001);
    expect((await pending).status).toBe(502);
  });

  it('requires sign-in', async () => {
    const res = await app.fetch(new Request(`https://app.test/api/cover?url=${encodeURIComponent(COVER)}`), { ...env, ENVIRONMENT: 'prod' } as Env);
    expect(res.status).toBe(401);
  });
});
