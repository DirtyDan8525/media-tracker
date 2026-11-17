// D1 limits live in @media-tracker/shared (the web client needs them for import chunking).
export { D1_MAX_PARAMS, D1_MAX_QUERIES } from '@media-tracker/shared';

export interface Env {
  DB: D1Database;
  /** R2 bucket for message pictures (Phase 6). Optional: without it, sending a picture answers 503 not_configured. */
  MEDIA?: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: 'dev' | 'prod';
  DEV_EMAIL?: string;
  /** '1' makes /api/lookup return canned results; honored only when ENVIRONMENT is 'dev' (e2e tests). */
  LOOKUP_FAKE?: string;
  /** The admin's email (Dan's row from before Phase 4b). Empty on a fresh install: the first sign-up is the admin. */
  ADMIN_EMAIL: string;
  TMDB_KEY?: string;
  IGDB_ID?: string;
  IGDB_SECRET?: string;
  /** YouTube Data API v3 key (title search on the YouTube list). Worker secret; never sent to the browser. A pasted link needs no key. */
  YOUTUBE_API_KEY?: string;
}
