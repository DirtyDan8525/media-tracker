// Kitsu's typo-tolerant search, used as a spelling oracle for the AniList search (port of
// kitsuTitle_). Kitsu answers browsers and the Worker alike. Not paced.
import { fetchJsonMeta, type FetchDeps } from './http';

interface KitsuAnime {
  data?: { attributes?: { titles?: { en?: string; en_jp?: string }; canonicalTitle?: string } }[];
}

/** The official title of Kitsu's top hit for `term`, or '' (no hit, error, or non-200). */
export async function kitsuTitle(term: string, d: FetchDeps): Promise<string> {
  const url = 'https://kitsu.io/api/edge/anime?page[limit]=1&filter[text]=' + encodeURIComponent(term);
  const { status, body } = await fetchJsonMeta<KitsuAnime>(url, { headers: { Accept: 'application/vnd.api+json' } }, d);
  if (status !== 200) return '';
  const a = body?.data?.[0]?.attributes;
  return a ? a.titles?.en || a.canonicalTitle || a.titles?.en_jp || '' : '';
}
