import { CARD_H, CARD_W, drawShareCard, type CardInput, type CardRow } from './top5Card';

/** How long a cover may take on the device; the proxy itself gives up upstream after 8 s (Task 3). */
export const COVER_LOAD_MS = 10_000;

/** The same-origin cover proxy (B18), so drawing the cover does not taint the canvas. */
export function coverProxyUrl(url: string): string {
  return `/api/cover?url=${encodeURIComponent(url)}`;
}

/** A decoded cover through the proxy, or null for no URL, any error, a hang or an image that won't decode. */
export async function loadCover(url: string): Promise<ImageBitmap | null> {
  if (!url) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), COVER_LOAD_MS);
  try {
    const res = await fetch(coverProxyUrl(url), { credentials: 'same-origin', signal: ctl.signal });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CardSpec = Omit<CardInput, 'rows'> & { rows: (Omit<CardRow, 'cover'> & { coverUrl: string })[] };

/** The Inter weights the card draws with; the canvas falls back to another font if they aren't loaded yet. */
const CARD_FONTS = ['400 32px Inter', '700 44px Inter', '800 64px Inter'];

/** Draws the card on a fresh 1080 × 1350 canvas and encodes it as PNG. Covers that fail draw as placeholders. */
export async function renderCardPng(input: CardSpec): Promise<Blob> {
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  const [, covers] = await Promise.all([
    Promise.all(CARD_FONTS.map((f) => fonts?.load(f).catch(() => []))),
    Promise.all(input.rows.map((r) => loadCover(r.coverUrl))),
  ]);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    drawShareCard(ctx, {
      ...input,
      rows: input.rows.map(({ coverUrl: _url, ...r }, i) => ({ ...r, cover: covers[i] ?? null })),
    });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The canvas gave no image'))), 'image/png');
    });
  } finally {
    for (const c of covers) c?.close();
  }
}

/** Downloads `blob` as `filename` through a temporary link. */
export function saveImage(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/**
 * Web Share with the PNG when the browser can share files (B17), else a download. Dismissing the share
 * sheet is 'cancelled'; a share that fails any other way (e.g. no user activation) saves instead.
 */
export async function shareOrSave(blob: Blob, filename: string, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  saveImage(blob, filename);
  return 'saved';
}

/** True when this browser can share a PNG file (the preview sheet's Share button). */
export function canShareImage(): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false;
  try {
    return nav.canShare({ files: [new File([new Uint8Array(0)], 'card.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}
