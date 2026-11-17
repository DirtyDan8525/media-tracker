/**
 * GET /api/app (AD1): the public subset of the admin-edited settings. Mounted before requireUser,
 * so the sign-in page can read its welcome text and look. Read-only; nothing secret in it.
 */
import { Hono } from 'hono';
import { publicAppSettings } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { loadAppSettings } from '../settings/appSettings';

export const appInfo = new Hono<AppEnv>();

// 1 query.
appInfo.get('/', async (c) => c.json(publicAppSettings(await loadAppSettings(c.env.DB)), 200, { 'Cache-Control': 'no-store' }));
