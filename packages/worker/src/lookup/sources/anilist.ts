// AniList anime lookup. The logic lives in @media-tracker/shared (the browser runs it too:
// AniList blocks Cloudflare's IPs, so the device calls AniList directly and this is the server's
// copy of the same code); this file adapts it to the Worker's source interface.
import { anilist, type FetchDeps } from '@media-tracker/shared';
import { withUserAgent } from '../http';
import type { DetailsFn, LookupDeps, SourceFn } from './index';

export const { buildResult, describe, formatDetails, queryVariants, scoreInto, toInfo } = anilist;
export type Candidate = anilist.Candidate;
export type Media = anilist.Media;

// Workers' fetch sends no User-Agent and AniList answers 403 without one.
const sharedDeps = (d: LookupDeps): FetchDeps => ({ fetch: withUserAgent(d.fetch), log: d.log });

export const search: SourceFn = (q, d) => anilist.search(q, sharedDeps(d));

export const details: DetailsFn = (sourceId, d) => anilist.details(sourceId, sharedDeps(d));
