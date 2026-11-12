// Spotify album/song links (port of spotifyAlbum_ and spotifyTrack_ from the
// script). The chain (chain.ts) sends a pasted link here, already normalized to
// https://open.spotify.com/{album|track}/<id>, with no text search on a URL.
// Reads the page's og: tags; Spotify's oembed endpoint is the backup for a
// missing title or cover. Details re-read the same page. Free, no key, not paced.
// Worst case per lookup: 2 requests (page + oembed); details 1, or 2 when the page has no title.
import type { Details, LookupInfo } from '@media-tracker/shared';
import { fetchJson, fetchText, logLine } from '../http';
import { trackCountLabel } from './format';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const PAGE = 'https://open.spotify.com';

export interface SpotifyPage {
  title: string;
  artist: string;
  album: string;
  year: string;
  type: string;
  /** The number from "5 songs" (albums only), '' when absent. */
  songs: string;
  cover: string;
}

type Kind = 'album' | 'track';

const SPOTIFY_REF = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(album|track)\/([A-Za-z0-9]+)/;

/** The album/track a Spotify link names; the chain strips /intl-xx/ and ?si= already, but this doesn't depend on it. */
export function parseSpotifyRef(term: string): { kind: Kind; id: string } | null {
  const m = SPOTIFY_REF.exec(term);
  return m ? { kind: m[1] as Kind, id: m[2]! } : null;
}

const MAX_SCAN = 200_000; // no </head>: scan only this much of the page
const MAX_TAG = 4000; // a <meta ...> tag longer than this is not one of ours

/**
 * An og:/meta tag's content, either attribute order, HTML entities decoded; ''
 * when absent. Only the <head> is searched (the first 200 KB when there is no
 * </head>), tag by tag, with no nested quantifiers, so malformed markup costs
 * linear time (Workers allow ~10 ms of CPU per request).
 */
export function ogMeta(html: string, prop: string): string {
  const end = html.search(/<\/head>/i);
  const head = html.slice(0, end >= 0 ? end : MAX_SCAN);
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`(?:property|name)="${p}"`, 'i');
  const tag = /<meta\b/gi;
  let close = -1; // position of the next '>' at or after the current tag start
  for (let m = tag.exec(head); m; m = tag.exec(head)) {
    if (close < m.index) {
      close = head.indexOf('>', m.index);
      if (close < 0) return ''; // no tag can end after this point
    }
    if (close - m.index > MAX_TAG) continue;
    const t = head.slice(m.index, close);
    if (!named.test(t)) continue;
    const c = /content="([^"]*)"/i.exec(t);
    if (c) return c[1]!.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  }
  return '';
}

const blank = (): SpotifyPage => ({ title: '', artist: '', album: '', year: '', type: '', songs: '', cover: '' });

/** og:title "Listen to Live At Electric Lady - Album by Clairo | Spotify"; og:description "Clairo · EP · 2023 · 5 songs". */
export function parseAlbumPage(html: string): SpotifyPage {
  const p = blank();
  const t = /^(?:Listen to )?(.*?) - (?:Album|Single|EP|Compilation) by (.*?)(?: \| Spotify)?$/i.exec(ogMeta(html, 'og:title'));
  if (t) {
    p.title = t[1]!;
    p.artist = t[2]!;
  }
  const d = ogMeta(html, 'og:description').split(' · ');
  if (d.length >= 3) {
    if (!p.artist) p.artist = d[0]!;
    p.type = d[1]!;
    p.year = d[2]!;
    p.songs = d.map((x) => /^(\d+) songs?$/i.exec(x)?.[1]).find(Boolean) ?? '';
  }
  p.cover = ogMeta(html, 'og:image');
  return p;
}

/** og:title "Song - song and lyrics by Artist | Spotify"; og:description "Artist · Album · Song · 2023". */
export function parseTrackPage(html: string): SpotifyPage {
  const p = blank();
  const t = /^(?:Listen to )?(.*?) - song(?: and lyrics)? by (.*?)(?: \| Spotify)?$/i.exec(ogMeta(html, 'og:title'));
  if (t) {
    p.title = t[1]!;
    p.artist = t[2]!;
  }
  const d = ogMeta(html, 'og:description').split(' · ');
  if (d.length >= 3) {
    if (!p.artist) p.artist = d[0]!;
    p.album = d[1]!;
    p.year = d.find((x) => /^\d{4}$/.test(x)) || '';
  }
  p.cover = ogMeta(html, 'og:image');
  return p;
}

/** oembed gives 300px art; the 640px version has a different id prefix. */
export function oembedCover(url: string | null | undefined): string {
  return String(url || '').replace('ab67616d00001e02', 'ab67616d0000b273');
}

export function spotifyInfo(kind: Kind, id: string, p: SpotifyPage): LookupInfo {
  const info: LookupInfo = {
    title: p.title,
    trusted: true,
    creator: p.artist,
    genres: '',
    cover: p.cover,
    sub: kind === 'album'
      ? [p.artist, p.year, p.type && !/album/i.test(p.type) ? p.type.toUpperCase() : ''].filter(Boolean).join(' · ')
      : [p.artist, p.album, p.year].filter(Boolean).join(' · '),
    source: 'spotify',
    sourceId: `${kind}:${id}`,
  };
  if (kind === 'track') info.album = p.album;
  return info;
}

/** Year and, for albums, the track count; everything else Spotify's page doesn't say. */
export function spotifyDetails(kind: Kind, p: SpotifyPage): Details {
  return {
    releaseDate: /^\d{4}$/.test(p.year) ? p.year : '',
    synopsis: '',
    lengthLabel: kind === 'album' ? trackCountLabel(Number(p.songs)) : '',
    origin: '',
  };
}

interface Oembed {
  title?: string | null;
  thumbnail_url?: string | null;
}

async function readPage(kind: Kind, id: string, d: LookupDeps): Promise<SpotifyPage> {
  const r = await fetchText(`${PAGE}/${kind}/${id}`, {}, d);
  if (r.status !== 200 || !r.body) {
    logLine(d, `spotify: page status ${r.status}`);
    return blank();
  }
  return kind === 'album' ? parseAlbumPage(r.body) : parseTrackPage(r.body);
}

async function readOembed(kind: Kind, id: string, d: LookupDeps): Promise<Oembed | null> {
  const r = await fetchJson<Oembed>(`${PAGE}/oembed?url=${encodeURIComponent(`${PAGE}/${kind}/${id}`)}`, {}, d);
  return r.status === 200 && r.body ? r.body : null;
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const ref = parseSpotifyRef(q.term);
  if (!ref) return null;
  const p = await readPage(ref.kind, ref.id, d);
  if (!p.title || !p.cover) {
    // Backup: the embed info has the name and cover, but not the artist.
    const o = await readOembed(ref.kind, ref.id, d);
    if (o) {
      p.title = p.title || o.title || '';
      p.cover = p.cover || oembedCover(o.thumbnail_url);
    }
  }
  if (!p.title) return null;
  return spotifyInfo(ref.kind, ref.id, p);
};

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  const m = /^(album|track):([A-Za-z0-9]{1,64})$/.exec(sourceId);
  if (!m) return null;
  const kind = m[1] as Kind;
  const p = await readPage(kind, m[2]!, d);
  if (p.title) return spotifyDetails(kind, p);
  // No usable page: oembed can only say the item exists.
  const o = await readOembed(kind, m[2]!, d);
  return o?.title ? spotifyDetails(kind, p) : null;
};
