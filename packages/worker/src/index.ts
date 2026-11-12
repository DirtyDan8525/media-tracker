import { Hono } from 'hono';
import { requireUser, type AppEnv } from './auth/access';
import { me } from './api/me';
import { entries } from './api/entries';
import { importApi } from './api/import';
import { lookup } from './lookup/routes';

export type { AppUser, AppEnv } from './auth/access';
export type { Env } from './env';

export const app = new Hono<AppEnv>();

// Unauthenticated.
app.get('/api/health', (c) => c.json({ ok: true }));

// Everything else under /api requires a signed-in user. Later tasks mount
// their routers here: api.route('/entries', entries), etc.
export const api = new Hono<AppEnv>();
api.use('*', requireUser);
api.route('/me', me);
api.route('/lookup', lookup);
api.route('/', entries);
api.route('/import', importApi);
app.route('/api', api);

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
