import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach } from 'vitest';
import { installOriginHelper } from './origin';
import { forgetAppSettings } from '../src/settings/appSettings';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Non-GET test requests get a matching Origin unless they set one (A4); see test/origin.ts.
installOriginHelper();
// GET /api/app keeps a per-isolate copy for a minute; tests write app_settings directly, so each starts without one.
beforeEach(() => forgetAppSettings());
