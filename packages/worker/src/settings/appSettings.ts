/**
 * Reads the admin-edited app settings (AD1). `loadAppSettings` reads the table afresh (1 query), so a change shows on
 * the next request; the write guards and the admin screens use it. The public GET /api/app uses `cachedAppSettings`:
 * kept in this isolate's memory for APP_SETTINGS_TTL_MS, and dropped at once when the admin saves in this isolate, so
 * other isolates show a change within a minute.
 */
import type { MiddlewareHandler } from 'hono';
import { resolveAppSettings, type AppSettings, type FeatureKey } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';

/** All settings, defaults filled in. 1 query. */
export async function loadAppSettings(db: D1Database): Promise<AppSettings> {
  const { results } = await db.prepare('SELECT key, value_json FROM app_settings').all<{ key: string; value_json: string }>();
  return resolveAppSettings(results);
}

/** How long GET /api/app answers from this isolate's copy. */
export const APP_SETTINGS_TTL_MS = 60_000;
let cache: { at: number; value: AppSettings } | null = null;

/** All settings, defaults filled in, from this isolate's copy when it is younger than APP_SETTINGS_TTL_MS. 0-1 queries. */
export async function cachedAppSettings(db: D1Database, now = Date.now()): Promise<AppSettings> {
  if (cache && now - cache.at >= 0 && now - cache.at < APP_SETTINGS_TTL_MS) return cache.value;
  const value = await loadAppSettings(db);
  cache = { at: now, value };
  return value;
}

/** Drops this isolate's copy (an admin save; tests). */
export function forgetAppSettings(): void {
  cache = null;
}

/**
 * AD2: refuses the request with 403 `feature_off` when the switch is off. Put it in front of a write
 * handler. 1 query. Reads of old data are not guarded.
 */
export const featureOn = (key: FeatureKey): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!(await loadAppSettings(c.env.DB)).features[key]) return c.json({ error: 'feature_off' }, 403);
  await next();
};
