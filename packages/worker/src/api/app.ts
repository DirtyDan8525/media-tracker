/**
 * GET /api/app (AD1): the public subset of the admin-edited settings. Mounted before requireUser,
 * so the sign-in page can read its welcome text and look. Read-only; nothing secret in it.
 */
import { Hono } from 'hono';
import { publicAppSettings } from '@media-tracker/shared';
import type { AppEnv } from '../auth/user';
import { cachedAppSettings } from '../settings/appSettings';

export const appInfo = new Hono<AppEnv>();

// 0-1 queries: this isolate's copy, read again after a minute or an admin save here (settings/appSettings.ts).
// `media`: whether this server can store photos and voice memos (the R2 MEDIA binding); the composer hides them without it.
appInfo.get('/', async (c) => c.json({ ...publicAppSettings(await cachedAppSettings(c.env.DB)), media: c.env.MEDIA !== undefined }, 200, { 'Cache-Control': 'no-store' }));
