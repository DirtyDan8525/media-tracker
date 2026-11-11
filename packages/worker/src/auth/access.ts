import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { DEFAULT_USER_SETTINGS, type UserSettings } from '@media-tracker/shared';
import type { Env } from '../env';

export interface AppUser {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  settings: UserSettings;
}

/** Hono generics for the whole app: bindings plus the user set by requireUser. */
export type AppEnv = { Bindings: Env; Variables: { user: AppUser } };

// One remote JWKS set per team domain, cached for the life of the isolate
// (jose handles key caching and refetch-on-unknown-kid internally).
const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let jwks = jwksByDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByDomain.set(teamDomain, jwks);
  }
  return jwks;
}

/** Verifies the Cloudflare Access JWT on the request. Null if missing, invalid, or without an email. */
export async function verifyAccess(req: Request, env: Env): Promise<{ email: string } | null> {
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  try {
    const { payload } = await jwtVerify(token, jwksFor(env.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
    });
    const email = payload.email;
    if (typeof email !== 'string' || !email) return null;
    return { email };
  } catch {
    return null;
  }
}

interface UserRow {
  id: string;
  email: string;
  username: string | null;
  settings_json: string;
  is_admin: number;
}

function toAppUser(row: UserRow): AppUser {
  let stored: Partial<UserSettings> = {};
  try {
    stored = JSON.parse(row.settings_json) as Partial<UserSettings>;
  } catch {
    // corrupt settings fall back to defaults
  }
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    isAdmin: row.is_admin === 1,
    // merge over defaults so older rows missing a key still get one
    settings: { ...DEFAULT_USER_SETTINGS, ...stored },
  };
}

async function getOrCreateUser(env: Env, email: string): Promise<AppUser> {
  const select = () =>
    env.DB.prepare('SELECT id, email, username, settings_json, is_admin FROM users WHERE email = ?')
      .bind(email)
      .first<UserRow>();

  const existing = await select();
  if (existing) return toAppUser(existing);

  const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase();
  const isAdmin = adminEmail !== '' && email === adminEmail ? 1 : 0;
  // OR IGNORE: two first requests racing on the same email must not fail.
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (id, email, settings_json, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), email, JSON.stringify(DEFAULT_USER_SETTINGS), isAdmin, new Date().toISOString())
    .run();
  const created = await select();
  if (!created) throw new Error('failed to create user');
  return toAppUser(created);
}

/** Resolves the signed-in user (creating the row on first sign-in) or answers 401. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  let email: string | undefined;
  // The DEV_EMAIL bypass exists only when ENVIRONMENT is exactly 'dev'.
  if (c.env.ENVIRONMENT === 'dev' && c.env.DEV_EMAIL) {
    email = c.env.DEV_EMAIL;
  } else {
    email = (await verifyAccess(c.req.raw, c.env))?.email;
  }
  if (!email) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', await getOrCreateUser(c.env, email.trim().toLowerCase()));
  await next();
};
