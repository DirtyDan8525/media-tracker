// 30-second song/album previews (GET /api/preview). Deezer's public API (no key) gives a signed MP3 `preview` URL per
// track; those URLs expire, so the URL is fetched fresh on every call and never cached. Only the matched Deezer id is
// cached (lookup_cache, source 'deezer-preview': hits 30 days, misses 1 day, expiry kept in the value).
import { getCached, putCached } from './cache';
import { fetchJson, logLine } from './http';
import { normalize, pickItem } from './spotifyLink';
import type { LookupDeps } from './sources/index';

const BASE = 'https://api.deezer.com';
const SEARCH_LIMIT = 10;
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_SOURCE = 'deezer-preview';

export type PreviewKind = 'track' | 'album';

interface DzItem {
  id?: unknown;
  title?: unknown;
  preview?: unknown;
  artist?: { name?: unknown } | null;
  error?: unknown;
}

const isPreviewUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^/]+\.dzcdn\.net\//.test(v);
const idOf = (v: unknown): string | null => (typeof v === 'number' || typeof v === 'string') && /^\d{1,12}$/.test(String(v)) ? String(v) : null;

async function dz<T>(path: string, d: LookupDeps): Promise<{ ok: boolean; body: T | null }> {
  const res = await fetchJson<T & { error?: unknown }>(`${BASE}${path}`, {}, d);
  return { ok: res.status === 200 && !!res.body && !(res.body as { error?: unknown }).error, body: res.body };
}

/** The first track of an album that has a preview clip, from a fresh /album/{id}/tracks call. */
async function albumPreview(id: string, d: LookupDeps): Promise<string | null> {
  const r = await dz<{ data?: DzItem[] }>(`/album/${id}/tracks?limit=50`, d);
  const hit = (r.body?.data ?? []).find((t) => isPreviewUrl(t?.preview));
  return hit ? (hit.preview as string) : null;
}

async function trackPreview(id: string, d: LookupDeps): Promise<string | null> {
  const r = await dz<DzItem>(`/track/${id}`, d);
  return r.ok && isPreviewUrl(r.body?.preview) ? (r.body!.preview as string) : null;
}

interface StoredId { id: string | null; exp: number }

/** Matches title+artist on Deezer: the Deezer id (and, for a track search, the fresh preview url already in the hit). */
async function searchMatch(kind: PreviewKind, title: string, artist: string, d: LookupDeps): Promise<{ answered: boolean; id: string | null; url: string | null }> {
  const clean = (s: string) => s.replace(/["\\]/g, ' ').trim();
  const q = `${kind}:"${clean(title)}"${clean(artist) ? ` artist:"${clean(artist)}"` : ''}`;
  const r = await dz<{ data?: DzItem[] }>(`/search/${kind}?limit=${SEARCH_LIMIT}&q=${encodeURIComponent(q)}`, d);
  if (!r.ok) return { answered: false, id: null, url: null };
  const items = (r.body?.data ?? []).map((i) => ({ ...i, name: i?.title, artists: [{ name: i?.artist?.name }] }));
  const best = pickItem(items as Parameters<typeof pickItem>[0], title, artist) as (DzItem & { name?: unknown }) | null;
  return { answered: true, id: best ? idOf(best.id) : null, url: best && isPreviewUrl(best.preview) ? (best.preview as string) : null };
}

/**
 * A fresh preview url for a song or album, or null. `deezerId` is the entry's own Deezer id (bare digits) when it
 * came from Deezer; otherwise Deezer is searched for title+artist with the Spotify-link matching rules. Never throws.
 */
export async function previewUrl(kind: PreviewKind, title: string, artist: string, deezerId: string | null, d: LookupDeps): Promise<string | null> {
  try {
    let id = deezerId;
    if (!id) {
      const key = `${kind}:${normalize(title)}|${normalize(artist)}`;
      const cached = await getCached<StoredId>(d.env.DB, PREVIEW_SOURCE, key);
      if (cached && typeof cached.exp === 'number' && Date.now() < cached.exp) {
        id = typeof cached.id === 'string' ? cached.id : null;
        if (!id) return null;
      } else {
        const m = await searchMatch(kind, title, artist, d);
        if (!m.answered) { logLine(d, 'deezer preview: search failed'); return null; } // not cached
        await putCached(d.env.DB, PREVIEW_SOURCE, key, { id: m.id, exp: Date.now() + (m.id ? HIT_TTL_MS : MISS_TTL_MS) } satisfies StoredId);
        if (!m.id) return null;
        if (kind === 'track' && m.url) return m.url;
        id = m.id;
      }
    }
    return kind === 'album' ? await albumPreview(id, d) : await trackPreview(id, d);
  } catch (err) {
    logLine(d, `deezer preview: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return null;
  }
}
