import { afterEach, describe, expect, it, vi } from 'vitest';
import { cfSetFor, THEMES } from '@media-tracker/shared';
import { CARD_H, CARD_W } from './top5Card';
import { coverProxyUrl, loadCover, renderCardPng, saveImage, shareOrSave } from './shareImage';

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
/** Response bodies as bytes: Node's Response can't read jsdom's Blob. */
const pngBytes = () => new Uint8Array([137, 80, 78, 71]);

/** Stubs URL.createObjectURL / revokeObjectURL (jsdom has neither) and records anchor clicks. */
function stubDownload() {
  const clicks: { href: string; download: string; inDom: boolean }[] = [];
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:card' });
  const revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download, inDom: document.body.contains(this) });
  });
  return { clicks, revoke };
}

afterEach(() => {
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  vi.useRealTimers();
});

describe('coverProxyUrl', () => {
  it('encodes the URL', () => {
    const u = 'https://img.example/a b.jpg?x=1&y=2#z';
    expect(coverProxyUrl(u)).toBe(`/api/cover?url=${encodeURIComponent(u)}`);
    expect(new URL(coverProxyUrl(u), 'https://app.example').searchParams.get('url')).toBe(u);
  });
});

describe('loadCover', () => {
  it('fetches through the same-origin proxy and decodes the image', async () => {
    const bitmap = { width: 10, height: 15, close: vi.fn() };
    const fetchSpy = vi.fn(async () => new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    expect(await loadCover('https://img.example/f.jpg')).toBe(bitmap);
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe(coverProxyUrl('https://img.example/f.jpg'));
  });

  it('returns null on 404 and on a rejected fetch', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })));
    expect(await loadCover('https://img.example/gone.jpg')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await loadCover('https://img.example/f.jpg')).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('returns null for an empty URL (no request), an image that will not decode, and a request that hangs', async () => {
    const fetchSpy = vi.fn(async () => new Response(pngBytes(), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await loadCover('')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('bad', 'InvalidStateError'); }));
    expect(await loadCover('https://img.example/f.jpg')).toBeNull();

    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const pending = loadCover('https://img.example/slow.jpg');
    await vi.advanceTimersByTimeAsync(25_000); // 10 s for the proxy attempt, 10 s for the direct one
    expect(await pending).toBeNull();
  });
});

describe('loadCover device fallback', () => {
  const url = 'https://s4.anilist.co/file/cover.jpg';

  it('uses the direct CORS fetch when the proxy returns 502', async () => {
    const bitmap = { width: 10, height: 15, close: vi.fn() };
    const fetchSpy = vi.fn(async (u: string) =>
      u.startsWith('/api/cover') ? new Response('{"error":"bad_gateway"}', { status: 502 }) : new Response(pngBytes(), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    expect(await loadCover(url)).toBe(bitmap);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [direct, init] = fetchSpy.mock.calls[1] as unknown as [string, RequestInit];
    expect(direct).toBe(url);
    expect(init.mode).toBe('cors');
    expect(init.credentials).toBe('omit');
  });

  it('returns null (placeholder) when the proxy and the direct fetch both fail', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.startsWith('/api/cover')) return new Response('x', { status: 502 });
      throw new TypeError('Failed to fetch');
    }));
    expect(await loadCover(url)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })));
    expect(await loadCover(url)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('does not fetch directly when the proxy succeeds', async () => {
    const bitmap = { width: 1, height: 1, close: vi.fn() };
    const fetchSpy = vi.fn(async () => new Response(pngBytes(), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    expect(await loadCover(url)).toBe(bitmap);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never falls back for non-http(s) URLs', async () => {
    const fetchSpy = vi.fn(async () => new Response('x', { status: 502 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('createImageBitmap', vi.fn());
    expect(await loadCover('data:image/png;base64,AAAA')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('shareOrSave', () => {
  it('shares when canShare({files}) is true', async () => {
    const share = vi.fn(async () => {});
    const canShare = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, canShare, share });
    expect(await shareOrSave(png(), 'top5-anime.png', 'My Anime Top 5')).toBe('shared');
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.title).toBe('My Anime Top 5');
    expect(data.files).toHaveLength(1);
    expect(data.files![0]!.name).toBe('top5-anime.png');
    expect(data.files![0]!.type).toBe('image/png');
    expect((canShare.mock.calls[0] as unknown as [ShareData])[0].files).toHaveLength(1);
  });

  it('AbortError → \'cancelled\'', async () => {
    const { clicks } = stubDownload();
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: async () => { throw new DOMException('cancelled', 'AbortError'); } });
    expect(await shareOrSave(png(), 'top5-anime.png', 'My Anime Top 5')).toBe('cancelled');
    expect(clicks).toEqual([]);
  });

  it('a share that fails for another reason saves instead', async () => {
    const { clicks } = stubDownload();
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: async () => { throw new DOMException('no', 'NotAllowedError'); } });
    expect(await shareOrSave(png(), 'my-number-ones.png', 'My #1s')).toBe('saved');
    expect(clicks.map((c) => c.download)).toEqual(['my-number-ones.png']);
  });

  it('no canShare → clicks a download link named the filename → \'saved\'', async () => {
    vi.useFakeTimers();
    const { clicks, revoke } = stubDownload();
    vi.stubGlobal('navigator', {}); // no canShare, no share
    expect(await shareOrSave(png(), 'top5-anime.png', 'My Anime Top 5')).toBe('saved');
    expect(clicks).toEqual([{ href: 'blob:card', download: 'top5-anime.png', inDom: true }]);
    expect(document.querySelector('a[download]')).toBeNull(); // removed again
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:card');
  });

  it('canShare false → saved', async () => {
    const { clicks } = stubDownload();
    const share = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, canShare: () => false, share });
    expect(await shareOrSave(png(), 'top5-anime.png', 'x')).toBe('saved');
    expect(share).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
  });
});

describe('saveImage', () => {
  it('downloads without trying to share', () => {
    const { clicks } = stubDownload();
    const share = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    saveImage(png(), 'top5-books.png');
    expect(clicks.map((c) => c.download)).toEqual(['top5-books.png']);
    expect(share).not.toHaveBeenCalled();
  });
});

describe('renderCardPng', () => {
  const base = { kind: 'top5' as const, heading: 'My Anime Top 5', username: 'dan', colors: THEMES.Midnight!, cf: cfSetFor('Midnight') };
  const rows = [
    { rank: 1, title: 'Frieren', creator: 'Madhouse', rating: 9.5, square: false, coverUrl: 'https://img.example/f.jpg' },
    { rank: 2, title: 'Mushishi', creator: 'Artland', rating: 9, square: false, coverUrl: 'https://img.example/gone.jpg' },
    { rank: 3, title: 'No cover', creator: '', rating: 8, square: false, coverUrl: '' },
  ];

  function stubCanvas(blob: Blob | null) {
    const drawn: unknown[] = [];
    const ctx = new Proxy({ filter: 'none', measureText: (t: string) => ({ width: t.length * 20 }) }, {
      get: (t, k) => (k in t ? t[k as keyof typeof t] : (...args: unknown[]) => { if (k === 'drawImage') drawn.push(args[0]); }),
      set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      sizes.push([this.width, this.height]);
      expect(type).toBe('image/png');
      cb(blob);
    });
    return { drawn, sizes };
  }

  it('waits for Inter 400/700/800, loads covers in parallel through the proxy, and draws a 1080 × 1350 PNG; a failed cover still gives an image', async () => {
    const load = vi.fn(async () => []);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    const bitmap = { width: 300, height: 450, close: vi.fn() };
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      seen.push(u);
      return u.includes('gone') ? new Response('', { status: 404 }) : new Response(pngBytes(), { status: 200 });
    }));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const out = png();
    const { drawn, sizes } = stubCanvas(out);
    expect(await renderCardPng({ ...base, rows })).toBe(out);
    expect(sizes).toEqual([[CARD_W, CARD_H]]);
    expect(load.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(expect.arrayContaining([
      expect.stringMatching(/^400 .*Inter/), expect.stringMatching(/^700 .*Inter/), expect.stringMatching(/^800 .*Inter/),
    ]));
    // The failed cover is retried straight from the device after the proxy 404s.
    expect(seen.sort()).toEqual([coverProxyUrl('https://img.example/f.jpg'), coverProxyUrl('https://img.example/gone.jpg'), 'https://img.example/gone.jpg'].sort());
    expect(drawn).toContain(bitmap);
    expect(bitmap.close).toHaveBeenCalled();
    delete (document as { fonts?: unknown }).fonts;
  });

  it('rejects when the canvas gives no blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    stubCanvas(null);
    await expect(renderCardPng({ ...base, rows })).rejects.toThrow();
  });
});
