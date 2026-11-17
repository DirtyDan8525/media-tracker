import { Hono } from 'hono';
import { IMAGE_TYPES } from '@media-tracker/shared';
import { requireUser, type AppEnv } from './auth/user';
import { auth } from './api/auth';
import { me } from './api/me';
import { friends, users } from './api/friends';
import { entries } from './api/entries';
import { compare } from './api/compare';
import { activity } from './api/activity';
import { cover } from './api/cover';
import { importApi } from './api/import';
import { ratings } from './api/ratings';
import { social } from './api/social';
import { messages } from './api/messages';
import { RatingConflict } from './ratings/store';
import { lookup } from './lookup/routes';
import { admin } from './api/admin';
import { push } from './api/push';
import { appInfo } from './api/app';

export type { AppUser, AppEnv } from './auth/user';
export type { Env } from './env';

export const app = new Hono<AppEnv>();

// CSRF hardening for the cookie-authenticated API. Every mutation the web client makes is a
// same-origin fetch with a JSON body, so anything else is refused before auth and handlers run:
//  - A4: the Origin header must be this request's own origin (403 bad_origin). Browsers send it on
//    every non-GET fetch, same-origin included; SameSite=Lax on the session cookie is the second wall;
//  - Sec-Fetch-Site: cross-site is never ours (403);
//  - a body-carrying mutation must be application/json (415), which a cross-site <form> cannot send
//    without a CORS preflight. A DELETE has no body, so it may omit Content-Type when the browser
//    says it is same-origin (or sends no Sec-Fetch-Site at all, e.g. non-browser clients).
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (!MUTATING.has(method)) return next();
  if (c.req.header('Origin') !== new URL(c.req.url).origin) return c.json({ error: 'bad_origin' }, 403);
  const site = c.req.header('Sec-Fetch-Site');
  if (site === 'cross-site') return c.json({ error: 'forbidden' }, 403);
  const type = c.req.header('Content-Type');
  const mime = type?.split(';')[0]!.trim().toLowerCase();
  // A picture upload is the one raw body: an image type, which a cross-site <form> cannot send without a preflight.
  const isImageUpload = method === 'POST' && mime !== undefined && (IMAGE_TYPES as readonly string[]).includes(mime)
    && /^\/api\/conversations\/[^/]+\/messages\/image$/.test(new URL(c.req.url).pathname);
  const isJson = mime === 'application/json' || isImageUpload;
  const sameOrigin = site === undefined || site === 'same-origin' || site === 'none';
  if (!isJson && !(method === 'DELETE' && type === undefined && sameOrigin)) {
    return c.json({ error: 'unsupported_media_type' }, 415);
  }
  return next();
});

// Unauthenticated.
app.get('/api/health', (c) => c.json({ ok: true }));

// Re-auth hop the current web app navigates to when signed out: it sends the user home, where
// the sign-in screen (Phase 4b, B2) takes over. Returns no data.
app.get('/api/auth/reauth', () =>
  new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store' } }));

// Sign up, sign in, sign out, password reset: answered for signed-out callers (A1-A7).
app.route('/api/auth', auth);

// The public subset of the admin's app settings, readable signed out (the sign-in page uses it). Read-only.
app.route('/api/app', appInfo);

// Everything else under /api requires a signed-in user. Later tasks mount
// their routers here: api.route('/entries', entries), etc.
export const api = new Hono<AppEnv>();
api.use('*', requireUser);
api.route('/me', me);
api.route('/friends', friends);
api.route('/users', users);
api.route('/lookup', lookup);
api.route('/', entries);
api.route('/import', importApi);
api.route('/compare', compare);
api.route('/activity', activity);
api.route('/cover', cover);
api.route('/ratings', ratings);
api.route('/', social);
api.route('/', messages);
api.route('/admin', admin);
api.route('/push', push);
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
