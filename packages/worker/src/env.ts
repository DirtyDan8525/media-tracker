// D1 limits live in @media-tracker/shared (the web client needs them for import chunking).
export { D1_MAX_PARAMS, D1_MAX_QUERIES } from '@media-tracker/shared';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: 'dev' | 'prod';
  DEV_EMAIL?: string;
  /** '1' makes /api/lookup return canned results; honored only when ENVIRONMENT is 'dev' (e2e tests). */
  LOOKUP_FAKE?: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAIL: string;
  TMDB_KEY?: string;
  IGDB_ID?: string;
  IGDB_SECRET?: string;
}
