import { Hono } from 'hono';
import type { AppEnv } from '../auth/access';

export const cover = new Hono<AppEnv>();

export const COVER_MAX_BYTES = 5_000_000;
export const COVER_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

const invalid = { error: 'invalid' } as const;
const upstream = { error: 'upstream' } as const;

/** Hosts that are never a public cover server: loopback names, internal suffixes, IP literals in private ranges. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.startsWith('[') || h.includes(':')) return true; // IPv6 literals
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h); // the URL parser has already normalised other IPv4 spellings
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username !== '' || u.password !== '') return null;
    return u;
  } catch {
    return null;
  }
}

/** Reads a body up to `max` bytes; null when it is longer (the stream is cancelled). */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
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
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// 1 query (+ sign-in) and one outbound fetch. Only a URL that is the cover_url of one of the
// caller's own entries is fetched, so this is not an open proxy. The URL is compared as the exact
// stored string (not a normalised form), so what was checked is what is fetched.
cover.get('/', async (c) => {
  const raw = c.req.query('url');
  if (!raw || raw.length > 2000) return c.json(invalid, 400);
  const first = parseHttpUrl(raw);
  if (!first) return c.json(invalid, 400);

  const own = await c.env.DB.prepare('SELECT 1 AS ok FROM entries WHERE user_id = ? AND cover_url = ? LIMIT 1')
    .bind(c.var.user.id, raw)
    .first();
  if (!own) return c.json({ error: 'not_found' }, 404);
  if (isBlockedHost(first.hostname)) return c.json(upstream, 502);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS); // covers headers and body
  try {
    let url = first;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // No cookies or credentials of ours go with it; redirects are followed by hand so each hop is re-checked.
      const r = await fetch(url.href, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'image/*' } });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        await r.body?.cancel().catch(() => undefined);
        const next = loc ? parseHttpUrl(new URL(loc, url).href) : null;
        if (!next || isBlockedHost(next.hostname)) return c.json(upstream, 502);
        url = next;
        continue;
      }
      res = r;
      break;
    }
    if (!res || !res.ok) {
      await res?.body?.cancel().catch(() => undefined);
      return c.json(upstream, 502);
    }

    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    // SVG can carry script; served from our origin it would run there. Raster images only.
    if (!type.startsWith('image/') || type.startsWith('image/svg')) {
      await res.body?.cancel().catch(() => undefined);
      return c.json(upstream, 502);
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > COVER_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return c.json(upstream, 502);
    }
    const bytes = await readCapped(res, COVER_MAX_BYTES);
    if (!bytes) return c.json(upstream, 502);

    return new Response(bytes, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return c.json(upstream, 502); // network error, abort (timeout) or bad redirect target
  } finally {
    clearTimeout(timer);
  }
});
