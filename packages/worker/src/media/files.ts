/** Shared by chat and comment pictures: type checks by first bytes, a capped body reader, and the R2 response. */
import type { Context } from 'hono';
import type { AppEnv } from '../auth/user';

const notFound = { error: 'not_found' } as const;

export const IMAGE_EXT_OK: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  // GIF87a / GIF89a.
  'image/gif': (b) => [0x47, 0x49, 0x46, 0x38].every((v, i) => b[i] === v) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  'image/webp': (b) => [0x52, 0x49, 0x46, 0x46].every((v, i) => b[i] === v) && [0x57, 0x45, 0x42, 0x50].every((v, i) => b[8 + i] === v),
};

/** The whole body, or null when it runs past `max` bytes (stops reading at once). */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    out.set(ch, at);
    at += ch.byteLength;
  }
  return out;
}

/** The stored file under `key` as a response (private cache; byte ranges answered with 206 so audio can seek). 404 when R2 no longer has it, 503 without the bucket. */
export async function serveObject(c: Context<AppEnv>, key: string): Promise<Response> {
  if (!c.env.MEDIA) return c.json({ error: 'not_configured' }, 503);
  const ranged = c.req.header('Range') !== undefined;
  const obj = await c.env.MEDIA.get(key, ranged ? { range: c.req.raw.headers } : undefined);
  if (!obj) return c.json(notFound, 404);
  const headers: Record<string, string> = {
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    // Private (never a shared cache), and the file under a key never changes.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (ranged && r) {
    const length = r.suffix !== undefined ? Math.min(r.suffix, obj.size) : (r.length ?? obj.size - (r.offset ?? 0));
    const offset = r.suffix !== undefined ? obj.size - length : (r.offset ?? 0);
    headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${obj.size}`;
    headers['Content-Length'] = String(length);
    return new Response(obj.body, { status: 206, headers });
  }
  headers['Content-Length'] = String(obj.size);
  return new Response(obj.body, { headers });
}
