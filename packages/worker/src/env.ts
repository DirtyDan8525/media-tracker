// D1 limits, verified 2026-11-10 on Cloudflare's D1 limits page
// (https://developers.cloudflare.com/d1/platform/limits/):
// max 100 bound parameters per query; max 50 queries per Worker invocation
// (free plan). We count every statement inside a db.batch() toward the 50
// (conservative).
export const D1_MAX_PARAMS = 100;
export const D1_MAX_QUERIES = 50;

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
