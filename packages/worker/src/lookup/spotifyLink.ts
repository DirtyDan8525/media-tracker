// Direct Spotify links for songs and albums (GET /api/spotify/link). Spotify Web API, Client Credentials flow:
// needs SPOTIFY_ID and SPOTIFY_SECRET (optional Worker secrets). Without them, or on any Spotify failure,
// the answer is null and the app falls back to a Spotify search link.
// Cache (lookup_cache, source 'spotify-link'): answers by kind+title+artist (hits 30 days, misses 1 day, kept in the
// value because the cache's own limit is 30 days) and the token under '__token'.
import { getCached, putCached } from './cache';
import { fetchJson, logLine } from './http';
import type { LookupDeps } from './sources/index';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';
const SEARCH_LIMIT = 5; // the API maximum is 10 since Feb 2026
const TOKEN_MARGIN_SEC = 60;
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

export const LINK_SOURCE = 'spotify-link';
export const TOKEN_KEY = '__token';

export type SpotifyKind = 'track' | 'album';

interface Item {
  id?: unknown;
  name?: unknown;
  artists?: { name?: unknown }[] | null;
  external_urls?: { spotify?: unknown } | null;
}

/** Lowercase, no diacritics, "(feat. …)" / "- Remastered 2011" parts dropped, punctuation turned to single spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[([][^)\]]*\b(?:feat|ft|featuring|with|remaster(?:ed)?)\b[^)\]]*[)\]]/g, ' ')
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster.*$/, ' ')
    .replace(/\s+[-–]\s+(?:feat|ft|featuring)\b.*$/, ' ')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const titleMatches = (want: string, got: string): boolean => !!want && !!got && (got === want || got.startsWith(want) || want.startsWith(got));

function artistMatches(want: string, item: Item): boolean {
  if (!want) return true;
  return (item.artists || []).some((a) => {
    const n = typeof a?.name === 'string' ? normalize(a.name) : '';
    return !!n && (n === want || n.includes(want) || want.includes(n));
  });
}

/** The best item: title equal (or starts-with) and the artist among its artists; null when none. Exact title wins over starts-with. */
export function pickItem(items: Item[], title: string, artist: string): Item | null {
  const want = normalize(title);
  const who = normalize(artist);
  const ok = items.filter((i) => i && typeof i.name === 'string' && titleMatches(want, normalize(i.name as string)) && artistMatches(who, i));
  return ok.find((i) => normalize(i.name as string) === want) ?? ok[0] ?? null;
}

function itemUrl(kind: SpotifyKind, item: Item): string | null {
  const direct = item.external_urls?.spotify;
  if (typeof direct === 'string' && direct.startsWith('https://open.spotify.com/')) return direct;
  return typeof item.id === 'string' && /^[A-Za-z0-9]{1,40}$/.test(item.id) ? `https://open.spotify.com/${kind}/${item.id}` : null;
}

interface StoredToken { token?: unknown; exp?: unknown }

/** A Client Credentials token (stored one while valid, else a new one); '' without keys or when the request fails. */
export async function spotifyToken(d: LookupDeps, forceNew: boolean): Promise<string> {
  if (!forceNew) {
    const s = await getCached<StoredToken>(d.env.DB, LINK_SOURCE, TOKEN_KEY);
    if (s && typeof s.token === 'string' && s.token && typeof s.exp === 'number' && Date.now() < s.exp) return s.token;
  }
  const { SPOTIFY_ID: id, SPOTIFY_SECRET: secret } = d.env;
  if (!id || !secret) return '';
  const res = await fetchJson<{ access_token?: unknown; expires_in?: unknown }>(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }, d);
  const token = res.body?.access_token;
  if (res.status !== 200 || typeof token !== 'string' || !token) {
    logLine(d, `spotify link: token request failed with status ${res.status}`);
    return '';
  }
  const expiresIn = res.body?.expires_in;
  const ttl = typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : 3600;
  await putCached(d.env.DB, LINK_SOURCE, TOKEN_KEY, { token, exp: Date.now() + (ttl - TOKEN_MARGIN_SEC) * 1000 });
  return token;
}

async function search(kind: SpotifyKind, title: string, artist: string, d: LookupDeps): Promise<{ status: number; items: Item[] }> {
  const clean = (s: string) => s.replace(/["\\]/g, ' ').trim();
  const q = `${kind}:"${clean(title)}"${clean(artist) ? ` artist:"${clean(artist)}"` : ''}`;
  const url = `${SEARCH_URL}?type=${kind}&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(q)}`;
  const send = (token: string) => fetchJson<Record<string, { items?: Item[] } | undefined>>(url, { headers: { Authorization: `Bearer ${token}` } }, d);
  const first = await spotifyToken(d, false);
  if (!first) return { status: 0, items: [] };
  let res = await send(first);
  if (res.status === 401) {
    const fresh = await spotifyToken(d, true);
    if (fresh) res = await send(fresh);
  }
  const items = res.body?.[`${kind}s`]?.items;
  return { status: res.status, items: Array.isArray(items) ? items : [] };
}

interface StoredLink { url: string | null; exp: number }

/** The Spotify URL for a song or album, or null (no keys, no match, or Spotify unavailable). Never throws. */
export async function spotifyLink(kind: SpotifyKind, title: string, artist: string, d: LookupDeps): Promise<string | null> {
  if (!d.env.SPOTIFY_ID || !d.env.SPOTIFY_SECRET) return null;
  const key = `${kind}:${normalize(title)}|${normalize(artist)}`;
  const cached = await getCached<StoredLink>(d.env.DB, LINK_SOURCE, key);
  if (cached && typeof cached.exp === 'number' && Date.now() < cached.exp) return typeof cached.url === 'string' ? cached.url : null;
  try {
    const res = await search(kind, title, artist, d);
    if (res.status !== 200) {
      logLine(d, `spotify link: search failed with status ${res.status}`); // not cached: try again next time
      return null;
    }
    const item = pickItem(res.items, title, artist);
    const url = item ? itemUrl(kind, item) : null;
    await putCached(d.env.DB, LINK_SOURCE, key, { url, exp: Date.now() + (url ? HIT_TTL_MS : MISS_TTL_MS) } satisfies StoredLink);
    return url;
  } catch (err) {
    logLine(d, `spotify link: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return null;
  }
}
