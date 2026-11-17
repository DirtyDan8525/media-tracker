/**
 * /api/auth/*: sign up, sign in, sign out and password reset (Phase 4b, A1-A7). Mounted before
 * requireUser, so these answer signed-out callers. The Origin check in index.ts still applies.
 */
import { Hono } from 'hono';
import { DEFAULT_USER_SETTINGS, tabsFor, type UserSettings } from '@media-tracker/shared';
import { loadAppSettings } from '../settings/appSettings';
import { USER_COLS, USERNAME_RE, toAppUser, type AppEnv, type AppUser } from '../auth/user';
import { PASSWORD_MAX, hashPassword, validPassword, verifyPassword } from '../auth/password';
import { RESET_TTL_MS, clearedCookie, expiryFrom, isToken, newToken, readSessionToken, sessionCookie, sha256Hex } from '../auth/session';
import { cleanDisplayName, meBody } from './me';
import { pushSignup } from '../push/events';
import { ctxOf } from '../push/send';

export const auth = new Hono<AppEnv>();

const invalid = { error: 'invalid' } as const;
const badCredentials = { error: 'bad_credentials' } as const;
const notFound = { error: 'not_found' } as const;

/** A5: 10 failures for one username within 15 minutes lock it for 15 minutes. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;

type UserRow = Parameters<typeof toAppUser>[0];

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A fresh session: its token's hash, timestamps and the cookie that carries the token. */
async function freshSession() {
  const token = newToken();
  const now = Date.now();
  return { hash: await sha256Hex(token), created: new Date(now).toISOString(), expires: expiryFrom(now), cookie: sessionCookie(token) };
}

/** Sign-up links work once and expire after 7 days if unused. */
export const SIGNUP_LINK_TTL_MS = 7 * 86_400_000;
/** A sign-up link a person can use right now: not used, not revoked, not expired (?N = token hash, ?M = now). */
const linkLive = (hash: string, now: string) =>
  `token_hash = ${hash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ${now}`;

const INSERT_SESSION = 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at)';

// POST /api/auth/signup { username, password, displayName?, joinToken? } -> 201 Me + cookie. 4 queries, 5 with a sign-up link (the app settings, then one batch).
// Sign-ups switched off (AD2): 403 feature_off unless a live sign-up link comes with it.
// The first account on an empty database is the active admin; everyone after waits for approval,
// unless they carry a live sign-up link: then they are active and the link is used up in the same
// batch (a link taken a moment earlier just means pending, with joinLink: 'invalid').
auth.post('/signup', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || typeof body.username !== 'string') return c.json(invalid, 400);
  const username = body.username.toLowerCase();
  if (!USERNAME_RE.test(username) || !validPassword(body.password)) return c.json(invalid, 400);
  const displayName = body.displayName === undefined ? null : cleanDisplayName(body.displayName);
  if (displayName === undefined) return c.json(invalid, 400);
  if (body.joinToken !== undefined && typeof body.joinToken !== 'string') return c.json(invalid, 400);
  const joinHash = typeof body.joinToken === 'string' && isToken(body.joinToken) ? await sha256Hex(body.joinToken) : null;

  const db = c.env.DB;
  // AD2/AD6: the sign-up switch and the defaults a new person starts with (1 query).
  const app = await loadAppSettings(db);
  const closed = !app.features.signups;
  // Closed: only a sign-up link gets in (a plain sign-up is refused before anything is written).
  if (closed && !joinHash) return c.json({ error: 'feature_off' }, 403);
  const startSettings: UserSettings = {
    ...DEFAULT_USER_SETTINGS,
    theme: app.defaults.theme,
    tabs: tabsFor(app.defaults.lists, DEFAULT_USER_SETTINGS.tabs),
  };
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  const s = await freshSession();
  let created: UserRow | undefined;
  let joined = false;
  try {
    // The batch is one transaction: the status check, the insert and the claim see the same link.
    const results = await db.batch([
      db.prepare(
        `INSERT INTO users (id, email, username, display_name, settings_json, is_admin, status, password_hash, created_at)
         SELECT ?1, 'u:' || ?1, ?2, ?3, ?4, f.first,
                CASE WHEN f.first = 1 OR EXISTS (SELECT 1 FROM signup_links WHERE ${linkLive('?7', '?6')}) THEN 'active' ELSE 'pending' END, ?5, ?6
           FROM (SELECT NOT EXISTS (SELECT 1 FROM users) AS first) f
          WHERE ?8 = 0 OR f.first = 1 OR EXISTS (SELECT 1 FROM signup_links WHERE ${linkLive('?7', '?6')})`,
      ).bind(id, username, displayName, JSON.stringify(startSettings), passwordHash, s.created, joinHash, closed ? 1 : 0),
      db.prepare(`${INSERT_SESSION} VALUES (?, ?, ?, ?, ?)`).bind(s.hash, id, s.created, s.expires, s.created),
      db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id),
      // Claim the link (single use); only when a well-formed token came along. At most one signup can win it.
      ...(joinHash
        ? [db.prepare(`UPDATE signup_links SET used_by = ?1, used_at = ?3 WHERE ${linkLive('?2', '?3')}`).bind(id, joinHash, s.created)]
        : []),
    ]);
    created = results[2]!.results[0] as UserRow | undefined;
    joined = (results[3]?.meta.changes ?? 0) > 0;
  } catch (err) {
    // The UNIQUE (NOCASE) index on username is the guard; the whole batch rolled back.
    const message = String(err instanceof Error ? err.message : err);
    if (/UNIQUE/i.test(message)) return c.json({ error: 'taken' }, 409);
    // Sign-ups closed and the link was not live: the insert wrote no user, so the session insert failed (the batch rolled back).
    if (closed && /FOREIGN KEY/i.test(message)) return c.json({ error: 'feature_off' }, 403);
    throw err;
  }
  if (!created && closed) {
    // Foreign keys off: the session row went in without a user; drop it.
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(s.hash).run();
    return c.json({ error: 'feature_off' }, 403);
  }
  if (!created) throw new Error('signup: user not created');
  const me = meBody(toAppUser(created, c.env.ADMIN_EMAIL));
  // A link was offered but did not work (used, expired, revoked, unknown): the UI says so.
  if (created.status === 'pending') pushSignup(c.env, ctxOf(c), { id, username, displayName });
  const offered = body.joinToken !== undefined && body.joinToken !== '';
  return c.json(offered && !joined ? { ...me, joinLink: 'invalid' as const } : me, 201, { 'Set-Cookie': s.cookie });
});

// GET /api/auth/join/:token -> { valid } for the /join page: true only for an unused, unexpired, unrevoked link. 1 query.
auth.get('/join/:token', async (c) => {
  const token = c.req.param('token');
  if (!isToken(token)) return c.json({ valid: false });
  const row = await c.env.DB.prepare(`SELECT 1 AS ok FROM signup_links WHERE ${linkLive('?1', '?2')}`)
    .bind(await sha256Hex(token), new Date().toISOString())
    .first();
  return c.json({ valid: row !== null });
});

/** True when the last 10 failures fell within 15 minutes and the newest is under 15 minutes old. */
function locked(failures: string[], now: number): boolean {
  if (failures.length < LOGIN_MAX_FAILURES) return false;
  const newest = Date.parse(failures[0]!);
  const tenth = Date.parse(failures[LOGIN_MAX_FAILURES - 1]!);
  return newest - tenth <= LOGIN_WINDOW_MS && now - newest < LOGIN_LOCK_MS;
}

// POST /api/auth/login { username, password } -> Me + cookie. 4 queries at most (two batches of 2).
// Wrong password and unknown username are the same 401 bad_credentials, each after one hash.
auth.post('/login', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return c.json(invalid, 400);
  const password = body.password;
  if (password.length < 1 || [...password].length > PASSWORD_MAX) return c.json(invalid, 400);
  const username = body.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    await verifyPassword(password, null); // no such account can exist; same cost and answer anyway
    return c.json(badCredentials, 401);
  }

  const db = c.env.DB;
  const now = Date.now();
  const [userRes, failRes] = await db.batch([
    db.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = ?`).bind(username),
    db.prepare(`SELECT at FROM login_failures WHERE username = ? ORDER BY at DESC LIMIT ${LOGIN_MAX_FAILURES}`).bind(username),
  ]);
  if (locked((failRes!.results as { at: string }[]).map((r) => r.at), now)) return c.json({ error: 'too_many_attempts' }, 429);

  const row = userRes!.results[0] as (UserRow & { password_hash: string | null }) | undefined;
  const ok = await verifyPassword(password, row?.password_hash);
  if (!row || !ok) {
    // Old rows are pruned as we go: the lock never looks further back than two windows.
    await db.batch([
      db.prepare('INSERT INTO login_failures (username, at) VALUES (?, ?)').bind(username, new Date(now).toISOString()),
      db.prepare('DELETE FROM login_failures WHERE username = ? AND at < ?').bind(username, new Date(now - LOGIN_WINDOW_MS - LOGIN_LOCK_MS).toISOString()),
    ]);
    return c.json(badCredentials, 401);
  }
  if (row.status === 'removed') return c.json({ error: 'removed' }, 403);

  const s = await freshSession();
  await db.batch([
    db.prepare('DELETE FROM login_failures WHERE username = ?').bind(username),
    db.prepare(`${INSERT_SESSION} VALUES (?, ?, ?, ?, ?)`).bind(s.hash, row.id, s.created, s.expires, s.created),
  ]);
  return c.json(meBody(toAppUser(row, c.env.ADMIN_EMAIL)), 200, { 'Set-Cookie': s.cookie });
});

// POST /api/auth/logout -> 204, cookie cleared. 0-1 query. Signs out this device only.
auth.post('/logout', async (c) => {
  const token = readSessionToken(c.req.header('Cookie'));
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return c.body(null, 204, { 'Set-Cookie': clearedCookie() });
});

/** A live reset link's user (never a removed one). 1 query. */
async function resetUser(db: D1Database, tokenHash: string, now: number) {
  return db
    .prepare(
      `SELECT ${USER_COLS.split(', ').map((k) => `u.${k}`).join(', ')} FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ? AND r.expires_at > ? AND u.status <> 'removed'`,
    )
    .bind(tokenHash, new Date(now).toISOString())
    .first<UserRow>();
}

// GET /api/auth/reset/:token -> { username } for the reset page, or 404 when the link is used, expired or unknown. 1 query.
auth.get('/reset/:token', async (c) => {
  const token = c.req.param('token');
  if (!isToken(token)) return c.json(notFound, 404);
  const user = await resetUser(c.env.DB, await sha256Hex(token), Date.now());
  if (!user) return c.json(notFound, 404);
  return c.json({ username: user.username });
});

// POST /api/auth/reset { token, password } -> Me + cookie. 6 queries (1 + a batch of 5).
// Sets the password, signs out every other session, signs this device in and uses the link up.
auth.post('/reset', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body || !isToken(body.token) || !validPassword(body.password)) return c.json(invalid, 400);
  const db = c.env.DB;
  const now = Date.now();
  const tokenHash = await sha256Hex(body.token);
  const row = await resetUser(db, tokenHash, now);
  if (!row) return c.json(notFound, 404);

  const passwordHash = await hashPassword(body.password);
  const s = await freshSession();
  // Every write is conditional on the link still being live inside this transaction, so two
  // racing uses cannot both succeed.
  const live = `EXISTS (SELECT 1 FROM password_resets WHERE token_hash = ?3 AND expires_at > ?4)`;
  const nowIso = new Date(now).toISOString();
  const [updated] = await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?2 WHERE id = ?1 AND ${live}`).bind(row.id, passwordHash, tokenHash, nowIso),
    db.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND ${live}`).bind(row.id, null, tokenHash, nowIso),
    db.prepare(`${INSERT_SESSION} SELECT ?2, ?1, ?5, ?6, ?5 WHERE ${live}`).bind(row.id, s.hash, tokenHash, nowIso, s.created, s.expires),
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(row.id),
    db.prepare('DELETE FROM login_failures WHERE username = ?').bind(row.username),
  ]);
  if (!updated!.meta.changes) return c.json(notFound, 404);
  const user: AppUser = toAppUser(row, c.env.ADMIN_EMAIL);
  return c.json(meBody(user), 200, { 'Set-Cookie': s.cookie });
});

/** A7: a one-time reset link for `userId` (not removed); replaces any earlier link. 2 queries. Null when no such user. */
export async function createResetLink(db: D1Database, userId: string, origin: string): Promise<string | null> {
  const token = newToken();
  const now = Date.now();
  const [, inserted] = await db.batch([
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(userId),
    db.prepare(
      `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
       SELECT ?2, id, ?3, ?4 FROM users WHERE id = ?1 AND status <> 'removed'`,
    ).bind(userId, await sha256Hex(token), new Date(now).toISOString(), new Date(now + RESET_TTL_MS).toISOString()),
  ]);
  return inserted!.meta.changes ? `${origin}/reset/${token}` : null;
}

/** A fresh sign-up link made by `adminId`: only its hash is stored. 1 query. */
export async function createSignupLink(db: D1Database, adminId: string, origin: string) {
  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + SIGNUP_LINK_TTL_MS).toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO signup_links (token_hash, id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), id, adminId, new Date(now).toISOString(), expiresAt)
    .run();
  return { id, link: `${origin}/join/${token}`, expiresAt };
}
