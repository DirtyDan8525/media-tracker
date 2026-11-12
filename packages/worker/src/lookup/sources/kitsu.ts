// Kitsu's typo-tolerant search, used only as a spelling oracle for the AniList
// adapter (port of kitsuTitle_). Not a chain step; no pacing needed.
import { fetchJson } from '../http';
import type { LookupDeps } from './index';

interface KitsuAnime {
  data?: { attributes?: { titles?: { en?: string; en_jp?: string }; canonicalTitle?: string } }[];
}

/** The official title of Kitsu's top hit for `term`, or '' (no hit, error, or non-200). */
export async function kitsuTitle(term: string, d: LookupDeps): Promise<string> {
  const url = 'https://kitsu.io/api/edge/anime?page[limit]=1&filter[text]=' + encodeURIComponent(term);
  const { status, body } = await fetchJson<KitsuAnime>(url, { headers: { Accept: 'application/vnd.api+json' } }, d);
  if (status !== 200) return '';
  const a = body?.data?.[0]?.attributes;
  return a ? a.titles?.en || a.canonicalTitle || a.titles?.en_jp || '' : '';
}
