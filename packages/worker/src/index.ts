import { Hono } from 'hono';
import { requireUser, type AppEnv } from './auth/access';
import { me } from './api/me';
import { entries } from './api/entries';
import { compare } from './api/compare';
import { activity } from './api/activity';
import { cover } from './api/cover';
import { importApi } from './api/import';
import { ratings } from './api/ratings';
import { RatingConflict } from './ratings/store';
import { lookup } from './lookup/routes';

export type { AppUser, AppEnv } from './auth/access';
export type { Env } from './env';

export const app = new Hono<AppEnv>();

// CSRF hardening for the cookie-authenticated API. Every mutation the web client makes is a
// same-origin fetch with a JSON body, so anything else is refused before auth and handlers run:
//  - Sec-Fetch-Site: cross-site is never ours (403);
//  - a body-carrying mutation must be application/json (415), which a cross-site <form> cannot send
//    without a CORS preflight. A DELETE has no body, so it may omit Content-Type when the browser
//    says it is same-origin (or sends no Sec-Fetch-Site at all, e.g. non-browser clients).
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (!MUTATING.has(method)) return next();
  const site = c.req.header('Sec-Fetch-Site');
  if (site === 'cross-site') return c.json({ error: 'forbidden' }, 403);
  const type = c.req.header('Content-Type');
  const isJson = type !== undefined && type.split(';')[0]!.trim().toLowerCase() === 'application/json';
  const sameOrigin = site === undefined || site === 'same-origin' || site === 'none';
  if (!isJson && !(method === 'DELETE' && type === undefined && sameOrigin)) {
    return c.json({ error: 'unsupported_media_type' }, 415);
  }
  return next();
});

// Unauthenticated.
app.get('/api/health', (c) => c.json({ ok: true }));

// Re-auth hop for the web app: a top-level navigation here (which the service worker
// never answers) lets Cloudflare Access show its sign-in when the session has expired;
// once signed in, Access returns here and we send the user home. Returns no data.
app.get('/api/auth/reauth', () =>
  new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store' } }));

// Everything else under /api requires a signed-in user. Later tasks mount
// their routers here: api.route('/entries', entries), etc.
export const api = new Hono<AppEnv>();
api.use('*', requireUser);
api.route('/me', me);
api.route('/lookup', lookup);
api.route('/', entries);
api.route('/import', importApi);
api.route('/compare', compare);
api.route('/activity', activity);
api.route('/cover', cover);
api.route('/ratings', ratings);
app.route('/api', api);

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  // A rating write raced another write to the same set; nothing was saved. The client reloads and retries.
  if (err instanceof RatingConflict) return c.json({ error: 'conflict' }, 409);
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
