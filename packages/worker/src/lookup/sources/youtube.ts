// YouTube lookup. A pasted link goes to oEmbed (no key): title, channel, thumbnail. A title search goes to the
// YouTube Data API v3 (search.list, 100 quota units a search) and needs the Worker secret YOUTUBE_API_KEY, which
// is only ever read here; without it a search finds nothing (the route tells the app "not configured") and a
// pasted link still works. Details (videos.list) give the length and publish date, also with the key.
import type { Details, LookupInfo } from '@media-tracker/shared';
import { trimSynopsis } from '@media-tracker/shared';
import { assertAnswered, fetchJson, logLine } from '../http';
import type { DetailsFn, LookupDeps, LookupQuery, SourceFn } from './index';

const OEMBED = 'https://www.youtube.com/oembed';
const SEARCH = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';
const MAX_RESULTS = 8;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const thumbnailUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const PATH_KINDS = new Set(['shorts', 'live', 'embed']);

/**
 * A pasted YouTube video link (watch?v=, youtu.be/, /shorts/, /live/, /embed/, any extra params, with or
 * without the scheme), as its video id and canonical watch URL. null for anything else (a channel page,
 * another site, a title).
 */
export function parseYouTubeLink(term: string): { id: string; url: string } | null {
  const text = term.trim();
  if (!text || /\s/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') id = parts[0] ?? null;
  else if (WATCH_HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts.length === 2 && PATH_KINDS.has(parts[0]!)) id = parts[1]!;
  }
  return id && VIDEO_ID.test(id) ? { id, url: watchUrl(id) } : null;
}

const info = (id: string, title: string, channel: string): LookupInfo => ({
  title: trimSynopsis(title, 300), trusted: true, cover: thumbnailUrl(id), genres: '', creator: trimSynopsis(channel, 300),
  source: 'youtube', sourceId: id,
});

interface OEmbedReply { title?: string | null; author_name?: string | null }

async function lookupLink(link: { id: string; url: string }, d: LookupDeps): Promise<LookupInfo | null> {
  const { status, body } = await fetchJson<OEmbedReply>(`${OEMBED}?url=${encodeURIComponent(link.url)}&format=json`, {}, d);
  // 401/404: private, deleted or not embeddable; the pasted link is simply not found.
  if (status !== 200 || !body?.title) return null;
  return info(link.id, body.title, body.author_name ?? '');
}

interface SearchReply {
  items?: { id?: { kind?: string; videoId?: string } | null; snippet?: { title?: string | null; channelTitle?: string | null } | null }[];
}

async function searchTitle(term: string, d: LookupDeps): Promise<LookupInfo | null> {
  const key = d.env.YOUTUBE_API_KEY;
  if (!key) {
    logLine(d, 'youtube: search not configured (no YOUTUBE_API_KEY)');
    return null;
  }
  const url = `${SEARCH}?part=snippet&type=video&q=${encodeURIComponent(term)}&maxResults=${MAX_RESULTS}&key=${encodeURIComponent(key)}`;
  const { status, body } = await fetchJson<SearchReply>(url, {}, d);
  if (status !== 200) return null;
  const infos: LookupInfo[] = [];
  for (const it of body?.items ?? []) {
    const id = it.id?.videoId;
    if (!id || !VIDEO_ID.test(id) || !it.snippet?.title) continue;
    infos.push(info(id, it.snippet.title, it.snippet.channelTitle ?? ''));
  }
  const top = infos[0];
  if (!top) return null;
  return infos.length > 1 ? { ...top, choices: infos.map((i) => ({ ...i })) } : top;
}

export const search: SourceFn = async (q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null> => {
  const link = parseYouTubeLink(q.term);
  return link ? lookupLink(link, d) : searchTitle(q.term.trim(), d);
};

/** ISO 8601 duration ("PT1H2M3S") as "1:02:03" / "12:34" / "0:45"; '' for zero, live ("P0D") or unreadable. */
export function durationLabel(iso: string): string {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!m) return '';
  const [days, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0)) as [number, number, number, number];
  const total = ((days * 24 + h) * 60 + min) * 60 + s;
  if (total <= 0) return '';
  const hours = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
}

interface VideosReply {
  items?: { snippet?: { publishedAt?: string | null; description?: string | null } | null; contentDetails?: { duration?: string | null } | null }[];
}

export const details: DetailsFn = async (sourceId: string, d: LookupDeps): Promise<Details | null> => {
  const key = d.env.YOUTUBE_API_KEY;
  if (!key || !VIDEO_ID.test(sourceId)) return null;
  const url = `${VIDEOS}?part=contentDetails,snippet&id=${sourceId}&key=${encodeURIComponent(key)}`;
  const { status, body } = await fetchJson<VideosReply>(url, {}, d);
  if (status === 404) return null;
  assertAnswered(status, 'youtube details');
  const item = body?.items?.[0];
  if (!item) return null;
  const published = /^\d{4}-\d{2}-\d{2}/.exec(item.snippet?.publishedAt ?? '')?.[0] ?? '';
  return {
    releaseDate: published,
    synopsis: item.snippet?.description ? trimSynopsis(item.snippet.description, 600) : '',
    lengthLabel: durationLabel(item.contentDetails?.duration ?? ''),
    origin: '',
  };
};
