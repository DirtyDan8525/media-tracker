import { Hono } from 'hono';
import type { AppEnv } from '../auth/user';
import { getCached, putCached } from '../lookup/cache';
import { searchKitsu } from '../lookup/sources/kitsu';
import type { LookupDeps } from '../lookup/sources/index';
import { visibleEntrySql } from '../social/visibility';

export const cover = new Hono<AppEnv>();

export const COVER_MAX_BYTES = 5_000_000;
export const COVER_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

const invalid = { error: 'invalid' } as const;
const upstream = { error: 'upstream' } as const;

/**
 * Hosts that are never a public cover server: loopback names, internal suffixes, IPv6 literals and
 * IPv4 literals in private, loopback, link-local, CGNAT, benchmarking (198.18/15), IETF protocol
 * (192.0.0/24), documentation (TEST-NET-1/2/3) and multicast/reserved ranges.
 *
 * This is a name/literal check only. It does NOT defend against DNS rebinding or a public name that
 * resolves to a private address: a Worker cannot see the resolved IP. That is acceptable on Workers,
 * whose outbound fetch cannot reach private (RFC 1918), loopback or link-local addresses, so there is
 * no internal network to reach. Do not reuse this proxy on a runtime that sits inside a private network.
 */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.startsWith('[') || h.includes(':')) return true; // IPv6 literals
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h); // the URL parser has already normalised other IPv4 spellings
  if (m) {
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
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

type Fetched = { type: string; bytes: Uint8Array } | null;

/**
 * One safe image fetch: host blocklist on the start URL and on every redirect hop (followed by hand, at most
 * MAX_REDIRECTS), then image-type (no SVG), declared-size and streamed-size limits. `signal` carries the
 * time limit. Null on any failure. Up to 4 outbound fetches (one request and at most 3 redirect hops).
 */
async function fetchImage(first: URL, signal: AbortSignal): Promise<Fetched> {
  if (isBlockedHost(first.hostname)) return null;
  try {
    let url = first;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // No cookies or credentials of ours go with it; redirects are followed by hand so each hop is re-checked.
      const r = await fetch(url.href, { signal, redirect: 'manual', headers: { Accept: 'image/*' } });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        await r.body?.cancel().catch(() => undefined);
        const next = loc ? parseHttpUrl(new URL(loc, url).href) : null;
        if (!next || isBlockedHost(next.hostname)) return null;
        url = next;
        continue;
      }
      res = r;
      break;
    }
    if (!res || !res.ok) {
      await res?.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    // SVG can carry script; served from our origin it would run there. Raster images only.
    if (!type.startsWith('image/') || type.startsWith('image/svg')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > COVER_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readCapped(res, COVER_MAX_BYTES);
    return bytes ? { type, bytes } : null; // network error, abort (timeout) or bad redirect target land in the catch
  } catch {
    return null;
  }
}

const KITSU_COVER = 'kitsu-cover';

/**
 * The Kitsu poster URL for an AniList cover URL: from lookup_cache (source 'kitsu-cover', key = the cover
 * URL, value {poster}; poster null is a remembered "no match"), else one Kitsu search by title using the
 * shared Kitsu source (same similarity scoring, accepts >= 0.45), then cached. Not cached when Kitsu did
 * not answer, so an outage is not frozen in for 30 days. D1: 1 read, and 1 write on a miss.
 */
async function kitsuPoster(db: D1Database, coverUrl: string, title: string, signal: AbortSignal): Promise<string | null> {
  const cached = await getCached<{ poster: string | null }>(db, KITSU_COVER, coverUrl);
  if (cached) return cached.poster;
  // The search's own fetches also stop on the request's time limit.
  const d: LookupDeps = {
    fetch: ((input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })) as typeof fetch,
    env: {} as LookupDeps['env'],
  };
  const { answered, info } = await searchKitsu({ term: title, typedTitle: title, hint: '', category: 'anime' }, d);
  if (!answered) return null;
  const poster = info?.cover || null;
  await putCached(db, KITSU_COVER, coverUrl, { poster });
  return poster;
}

// D1: 1 visibility query (own entry, or a friend's non-private one), plus on an anime fallback 1 cache read and (on a miss) 1 cache write; 3 at most.
// Outbound: the cover fetch (one request and at most 3 redirect hops); if that fails for an anime entry,
// at most 1 Kitsu search (none when the mapping is cached) plus the poster fetch (one request and at most
// 3 redirect hops). All of it shares one COVER_TIMEOUT_MS limit, so the device's single 10 s wait still covers it.
// Sign-in is required and the url must equal the cover_url of an entry the caller can see (own, or an accepted friend's non-private one; S13), so
// it is not an anonymous proxy. But cover_url is user-set (any http(s) URL), so in effect a signed-in
// user can have the Worker fetch any public http(s) image of up to COVER_MAX_BYTES (B18); the size,
// time, type and host limits above and below are what bound that. The ownership check compares the
// raw string; the host check and the fetch then both use the parsed (normalised) URL.
// AniList's CDN blocks Cloudflare Workers, so for an anime cover that fails, the same show is looked up
// on Kitsu by the entry's title and its poster is served instead (the poster URL comes from Kitsu, not the
// user, and goes through the same host/redirect/type/size checks).
cover.get('/', async (c) => {
  const raw = c.req.query('url');
  if (!raw || raw.length > 2000) return c.json(invalid, 400);
  const first = parseHttpUrl(raw);
  if (!first) return c.json(invalid, 400);

  // Own entries, or an accepted friend's non-private ones (S13): the same rule as every friend read.
  const own = await c.env.DB.prepare(`SELECT e.title, e.category FROM entries e WHERE e.cover_url = ?2 AND ${visibleEntrySql('e', '?1')} LIMIT 1`)
    .bind(c.var.user.id, raw)
    .first<{ title: string; category: string }>();
  if (!own) return c.json({ error: 'not_found' }, 404);
  if (isBlockedHost(first.hostname)) return c.json(upstream, 502);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS); // covers every fetch and body below
  try {
    let img = await fetchImage(first, controller.signal);
    if (!img && own.category === 'anime' && own.title.trim() !== '' && !controller.signal.aborted) {
      const poster = await kitsuPoster(c.env.DB, raw, own.title, controller.signal);
      const url = poster ? parseHttpUrl(poster) : null;
      if (url) img = await fetchImage(url, controller.signal);
    }
    if (!img) return c.json(upstream, 502);
    return new Response(img.bytes, {
      headers: {
        'Content-Type': img.type,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return c.json(upstream, 502);
  } finally {
    clearTimeout(timer);
  }
});
