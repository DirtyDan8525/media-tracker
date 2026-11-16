import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { installOriginHelper } from './origin';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Non-GET test requests get a matching Origin unless they set one (A4); see test/origin.ts.
installOriginHelper();
