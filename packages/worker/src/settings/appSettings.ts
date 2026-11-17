/**
 * Reads the admin-edited app settings (AD1). Never cached across requests: each caller reads the
 * table afresh (1 query), so a change shows on the next request.
 */
import type { MiddlewareHandler } from 'hono';
import { resolveAppSettings, type AppSettings, type FeatureKey } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';

/** All settings, defaults filled in. 1 query. */
export async function loadAppSettings(db: D1Database): Promise<AppSettings> {
  const { results } = await db.prepare('SELECT key, value_json FROM app_settings').all<{ key: string; value_json: string }>();
  return resolveAppSettings(results);
}

/**
 * AD2: refuses the request with 403 `feature_off` when the switch is off. Put it in front of a write
 * handler. 1 query. Reads of old data are not guarded.
 */
export const featureOn = (key: FeatureKey): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!(await loadAppSettings(c.env.DB)).features[key]) return c.json({ error: 'feature_off' }, 403);
  await next();
};
