// D1 limits live in @media-tracker/shared (the web client needs them for import chunking).
export { D1_MAX_PARAMS, D1_MAX_QUERIES } from '@media-tracker/shared';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: 'dev' | 'prod';
  DEV_EMAIL?: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAIL: string;
  TMDB_KEY?: string;
  IGDB_ID?: string;
  IGDB_SECRET?: string;
}
