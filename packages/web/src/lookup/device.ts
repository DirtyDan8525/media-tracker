import { anilist, type Details, type FetchDeps, type LookupInfo } from '@media-tracker/shared';
import { isSpotifyLink, type LookupQuery } from './query';

// AniList blocks Cloudflare's IPs, so the Worker cannot reach it; this device can. The logic is
// the Worker's own (@media-tracker/shared), run here with the browser's fetch. The service worker
// caches nothing at runtime, so these cross-origin calls always reach the network.

// Called as a plain function: a detached window.fetch throws "Illegal invocation".
const deps = (): FetchDeps => ({ fetch: (input, init) => fetch(input, init) });

/** AniList's best match for an anime lookup, or null when it is not an anime term, finds nothing or fails (the server then tries). */
export async function searchOnDevice(q: LookupQuery): Promise<LookupInfo | null> {
  if (q.category !== 'anime' || isSpotifyLink(q.term)) return null;
  try {
    return await anilist.search({ term: q.term }, deps());
  } catch {
    return null;
  }
}

/** AniList details from this device. Resolves to `failed` when AniList could not answer (so the caller leaves the entry as it is). */
export async function detailsOnDevice(sourceId: string): Promise<{ details: Details | null; failed?: boolean }> {
  try {
    return { details: await anilist.details(sourceId, deps()) };
  } catch {
    return { details: null, failed: true };
  }
}
