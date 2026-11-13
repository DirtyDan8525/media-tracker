import type { SourceId } from './types';

const SAFE = /^[A-Za-z0-9_.-]{1,200}$/;

/** `album:<id>` / `track:<id>` style ids (deezer, spotify): the kind and the bare id, or null. */
function kindAndId(sourceId: string, kinds: readonly string[]): { kind: string; id: string } | null {
  const i = sourceId.indexOf(':');
  if (i < 0) return null;
  const kind = sourceId.slice(0, i);
  const id = sourceId.slice(i + 1);
  return kinds.includes(kind) && SAFE.test(id) ? { kind, id } : null;
}

/**
 * The public page for a lookup match, or null when the source has no per-item page we can build
 * (igdb, itunes) or the id is not in the shape that source uses. Used by the synopsis "More" link.
 */
export function sourceUrl(source: SourceId | null | undefined, sourceId: string | null | undefined): string | null {
  if (!source || !sourceId) return null;
  switch (source) {
    case 'anilist':
      return /^\d{1,9}$/.test(sourceId) ? `https://anilist.co/anime/${sourceId}` : null;
    case 'tmdb':
      return /^\d{1,9}$/.test(sourceId) ? `https://www.themoviedb.org/movie/${sourceId}` : null;
    case 'wiki':
      if (/^Q\d{1,12}$/.test(sourceId)) return `https://www.wikidata.org/wiki/${sourceId}`;
      return /^\d{1,12}$/.test(sourceId) ? `https://en.wikipedia.org/?curid=${sourceId}` : null;
    case 'tvmaze':
      return /^\d{1,9}$/.test(sourceId) ? `https://www.tvmaze.com/shows/${sourceId}` : null;
    case 'deezer': {
      const m = kindAndId(sourceId, ['album', 'track']);
      return m && /^\d{1,12}$/.test(m.id) ? `https://www.deezer.com/${m.kind}/${m.id}` : null;
    }
    case 'spotify': {
      const m = kindAndId(sourceId, ['album', 'track']);
      return m ? `https://open.spotify.com/${m.kind}/${m.id}` : null;
    }
    case 'openlibrary':
      return /^OL\d{1,12}W$/.test(sourceId) ? `https://openlibrary.org/works/${sourceId}` : null;
    case 'steam':
      return /^\d{1,12}$/.test(sourceId) ? `https://store.steampowered.com/app/${sourceId}/` : null;
    default:
      return null; // igdb, itunes: no stable public page from the stored id
  }
}
