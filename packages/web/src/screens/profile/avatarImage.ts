import { AVATAR_MAX_BYTES, AVATAR_SIZE, type AvatarType } from '@media-tracker/shared';

/** The photo could not be opened (not an image, a format this browser can't decode such as HEIC, or a canvas that won't draw). */
export class AvatarReadError extends Error {
  constructor(message = "Couldn't read that image") {
    super(message);
    this.name = 'AvatarReadError';
  }
}

/** Even at the lowest quality the 256 px square is over AVATAR_MAX_BYTES. */
export class AvatarTooBigError extends Error {
  constructor() {
    super('That photo has too much detail to shrink');
    this.name = 'AvatarTooBigError';
  }
}

/**
 * Where the photo sits under the square crop viewport. `scale` is 1 or more, relative to "the photo just
 * covers the viewport" (its short side equals the viewport); `x`/`y` are the offset of the photo's
 * top-left corner from the viewport's, in viewport px (never positive: the photo covers the square).
 */
export interface CropState { scale: number; x: number; y: number }

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

/** Viewport px per source pixel at scale 1. */
const coverFactor = (imgW: number, imgH: number, view: number): number => view / Math.min(imgW, imgH);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
// Float noise from the divisions would make a clean 500 come out as 500.00000000000006.
const tidy = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Centred, scale 1. */
export function initialCrop(imgW: number, imgH: number, view: number): CropState {
  const k = coverFactor(imgW, imgH, view);
  return { scale: 1, x: (view - imgW * k) / 2, y: (view - imgH * k) / 2 };
}

/** Scale limited to 1-4 and the offsets limited so the photo still covers the whole square. */
export function clampCrop(s: CropState, imgW: number, imgH: number, view: number): CropState {
  const scale = clamp(s.scale, MIN_SCALE, MAX_SCALE);
  const k = coverFactor(imgW, imgH, view) * scale;
  return {
    scale,
    x: clamp(s.x, view - imgW * k, 0),
    y: clamp(s.y, view - imgH * k, 0),
  };
}

/** Zooms to `scale`, keeping the photo point under the focal point (fx, fy, viewport px) where it is. */
export function zoomAt(s: CropState, scale: number, fx: number, fy: number, imgW: number, imgH: number, view: number): CropState {
  const next = clamp(scale, MIN_SCALE, MAX_SCALE);
  const k0 = coverFactor(imgW, imgH, view);
  const u = (fx - s.x) / (k0 * s.scale);
  const v = (fy - s.y) / (k0 * s.scale);
  return clampCrop({ scale: next, x: fx - u * k0 * next, y: fy - v * k0 * next }, imgW, imgH, view);
}

/** The square of the photo, in source pixels, that the viewport shows. */
export function cropRect(s: CropState, imgW: number, imgH: number, view: number): { sx: number; sy: number; side: number } {
  const k = coverFactor(imgW, imgH, view) * s.scale;
  const side = view / k;
  return {
    sx: tidy(clamp(-s.x / k, 0, Math.max(0, imgW - side))),
    sy: tidy(clamp(-s.y / k, 0, Math.max(0, imgH - side))),
    side: tidy(side),
  };
}

/**
 * Decodes the chosen file. `imageOrientation: 'from-image'` applies the EXIF rotation, so a phone
 * photo comes out upright. Anything the browser can't decode (HEIC on most desktops) is an AvatarReadError.
 */
export async function readImage(file: Blob): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      // An older browser may not know the option; a file it can't decode fails again below.
      if (err instanceof TypeError) bitmap = await createImageBitmap(file);
      else throw err;
    }
  } catch {
    throw new AvatarReadError();
  }
  if (!bitmap.width || !bitmap.height) {
    bitmap.close?.();
    throw new AvatarReadError();
  }
  return bitmap;
}

const QUALITIES = [0.85, 0.7, 0.55, 0.4] as const;

type Encode = (canvas: HTMLCanvasElement, type: string, quality: number) => Promise<Blob>;

const encodeCanvas: Encode = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new AvatarReadError())), type, quality);
  });

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new AvatarReadError());
    reader.readAsDataURL(blob);
  });
}

/**
 * Draws the chosen square at AVATAR_SIZE and encodes it: WebP at 0.85 (JPEG when the browser answers
 * with another type, as Safari does), stepping the quality down by 0.15 to 0.4 until it is within AVATAR_MAX_BYTES.
 */
export async function makeAvatar(
  img: CanvasImageSource,
  rect: { sx: number; sy: number; side: number },
  encode: Encode = encodeCanvas,
): Promise<{ type: AvatarType; data: string; blob: Blob }> {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AvatarReadError();
  ctx.fillStyle = '#ffffff'; // JPEG has no alpha: a transparent PNG would turn black
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(img, rect.sx, rect.sy, rect.side, rect.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  let type: AvatarType = 'image/webp';
  for (const quality of QUALITIES) {
    let blob = await encode(canvas, type, quality);
    if (type === 'image/webp' && blob.type !== 'image/webp') {
      type = 'image/jpeg';
      blob = await encode(canvas, type, quality);
    }
    if (blob.size <= AVATAR_MAX_BYTES) return { type, data: await toBase64(blob), blob };
  }
  throw new AvatarTooBigError();
}
