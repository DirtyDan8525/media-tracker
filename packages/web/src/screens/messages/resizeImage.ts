/** M6: the phone/PC resizes before upload: longest side at most 1600 px, JPEG about 0.82, at most 1.5 MB. */
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.82;
export const TARGET_BYTES = 1.5 * 1024 * 1024;

/** The size that fits `max` on its longest side (never enlarged), aspect kept. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/** A JPEG of `file` fitted to 1600 px; lowers the quality in steps when it is still over 1.5 MB. Rejects when the file is not a readable picture. */
export async function resizeImage(file: Blob): Promise<Blob> {
  const img = await decode(file);
  try {
    const { width, height } = fitWithin(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(img.source, 0, 0, width, height);
    let blob: Blob | null = null;
    for (const q of [JPEG_QUALITY, 0.7, 0.55, 0.4]) {
      blob = await toBlob(canvas, q);
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (!blob) throw new Error('could not encode');
    return blob;
  } finally {
    img.done();
  }
}
