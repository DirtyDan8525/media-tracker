import { AVATAR_MAX_BYTES } from '@media-tracker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AvatarReadError, AvatarTooBigError, clampCrop, cropRect, initialCrop, makeAvatar, readImage, zoomAt,
} from './avatarImage';

const VIEW = 280;
const blobOf = (kb: number, type: string) => new Blob([new Uint8Array(kb * 1024)], { type });

describe('crop maths', () => {
  it('initialCrop + cropRect: a landscape 4000 x 3000 photo shows its centre square', () => {
    const s = initialCrop(4000, 3000, VIEW);
    expect(s.scale).toBe(1);
    expect(cropRect(s, 4000, 3000, VIEW)).toEqual({ sx: 500, sy: 0, side: 3000 });
  });

  it('portrait and square photos', () => {
    expect(cropRect(initialCrop(3000, 4000, VIEW), 3000, 4000, VIEW)).toEqual({ sx: 0, sy: 500, side: 3000 });
    expect(cropRect(initialCrop(500, 500, VIEW), 500, 500, VIEW)).toEqual({ sx: 0, sy: 0, side: 500 });
  });

  it('at scale 2 the side halves', () => {
    const s = zoomAt(initialCrop(4000, 3000, VIEW), 2, VIEW / 2, VIEW / 2, 4000, 3000, VIEW);
    const r = cropRect(s, 4000, 3000, VIEW);
    expect(r.side).toBeCloseTo(1500, 3);
    // zooming on the centre keeps the centre of the photo in the middle
    expect(r.sx + r.side / 2).toBeCloseTo(2000, 3);
    expect(r.sy + r.side / 2).toBeCloseTo(1500, 3);
  });

  it('clampCrop never leaves a gap (drag far right gives x = 0) and clamps the scale to 1 to 4', () => {
    const s = initialCrop(4000, 3000, VIEW);
    expect(clampCrop({ ...s, x: 500, y: 500 }, 4000, 3000, VIEW)).toMatchObject({ x: 0, y: 0 });
    const far = clampCrop({ ...s, x: -5000, y: -5000 }, 4000, 3000, VIEW);
    expect(far.x).toBeCloseTo(VIEW - (4000 * VIEW) / 3000, 6);
    expect(far.y).toBe(0);
    expect(clampCrop({ ...s, scale: 9 }, 4000, 3000, VIEW).scale).toBe(4);
    expect(clampCrop({ ...s, scale: 0.2 }, 4000, 3000, VIEW).scale).toBe(1);
    const zoomed = clampCrop({ scale: 4, x: 100, y: -9999 }, 4000, 3000, VIEW);
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBeCloseTo(VIEW - VIEW * 4, 6);
  });

  it('zoomAt keeps the focal source pixel under the focal point', () => {
    const [w, h] = [4000, 3000];
    const k = VIEW / Math.min(w, h);
    const start = clampCrop({ scale: 1.5, x: -60, y: -20 }, w, h, VIEW);
    const [fx, fy] = [200, 90];
    const before = { u: (fx - start.x) / (k * start.scale), v: (fy - start.y) / (k * start.scale) };
    const next = zoomAt(start, 2.5, fx, fy, w, h, VIEW);
    expect(next.scale).toBe(2.5);
    expect((fx - next.x) / (k * next.scale)).toBeCloseTo(before.u, 6);
    expect((fy - next.y) / (k * next.scale)).toBeCloseTo(before.v, 6);
  });

  it('zoomAt out past 1 stays covered', () => {
    const s = zoomAt({ scale: 3, x: -400, y: -400 }, 1, 10, 10, 1000, 1000, VIEW);
    expect(s).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe('makeAvatar', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D);
  });
  const rect = { sx: 0, sy: 0, side: 100 };
  const img = {} as CanvasImageSource;

  it('steps the quality down until the file fits: 90 KB at 0.85, 70 KB at 0.7, 50 KB at 0.55', async () => {
    const sizes: Record<string, number> = { '0.85': 90, '0.7': 70, '0.55': 50 };
    const encode = vi.fn(async (_c: HTMLCanvasElement, type: string, q: number) => blobOf(sizes[String(q)] ?? 10, type));
    const out = await makeAvatar(img, rect, encode);
    expect(encode.mock.calls.map((c) => c[2])).toEqual([0.85, 0.7, 0.55]);
    expect(out.type).toBe('image/webp');
    expect(out.blob.size).toBe(50 * 1024);
    expect(out.blob.size).toBeLessThanOrEqual(AVATAR_MAX_BYTES);
    expect(typeof out.data).toBe('string');
    expect(out.data.length).toBeGreaterThan(0);
    // 256 px square
    const canvas = encode.mock.calls[0]![0];
    expect([canvas.width, canvas.height]).toEqual([256, 256]);
  });

  it('gives up with AvatarTooBigError when nothing fits (no quality below 0.4)', async () => {
    const encode = vi.fn(async (_c: HTMLCanvasElement, type: string, _q: number) => blobOf(90, type));
    await expect(makeAvatar(img, rect, encode)).rejects.toBeInstanceOf(AvatarTooBigError);
    const qs = encode.mock.calls.map((c) => c[2]);
    expect(Math.min(...qs)).toBeGreaterThanOrEqual(0.4);
    expect(qs[0]).toBe(0.85);
  });

  it('retries as JPEG when the browser answers a WebP request with another type', async () => {
    const encode = vi.fn(async (_c: HTMLCanvasElement, type: string, _q: number) => blobOf(10, type === 'image/webp' ? 'image/png' : type));
    const out = await makeAvatar(img, rect, encode);
    expect(out.type).toBe('image/jpeg');
    expect(encode.mock.calls.map((c) => c[1])).toEqual(['image/webp', 'image/jpeg']);
  });

  it('downsamples with high-quality smoothing', async () => {
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    await makeAvatar(img, rect, async (_c, type) => blobOf(10, type));
    expect(ctx.imageSmoothingQuality).toBe('high');
  });

  it('a canvas that cannot draw is a read error, not a hang', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(makeAvatar(img, rect, vi.fn())).rejects.toBeInstanceOf(AvatarReadError);
  });
});

describe('readImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a decode failure into AvatarReadError', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('nope')));
    await expect(readImage(new Blob(['x']))).rejects.toBeInstanceOf(AvatarReadError);
  });

  it('asks the browser to honour the EXIF rotation', async () => {
    const bitmap = { width: 10, height: 20 };
    const spy = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', spy);
    const file = new Blob(['x']);
    await expect(readImage(file)).resolves.toBe(bitmap);
    expect(spy).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  });

  it('rejects a zero-size image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 0, height: 0, close: vi.fn() }));
    await expect(readImage(new Blob(['x']))).rejects.toBeInstanceOf(AvatarReadError);
  });
});
