/**
 * A3: sessions. The cookie holds 32 random bytes (base64url); D1 holds only their SHA-256, so a
 * leaked database cannot sign anyone in. Sessions last 365 days and roll forward when used more
 * than a day after their last use.
 */
export const SESSION_COOKIE = 'mt_session';
export const SESSION_DAYS = 365;
const DAY_MS = 86_400_000;
export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
/** Renew (and re-send the cookie) when last used longer ago than this. */
export const ROLL_AFTER_MS = DAY_MS;
/** A7: reset links last 24 hours. */
export const RESET_TTL_MS = DAY_MS;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as base64url (43 chars, no padding). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_RE.test(v);

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const expiryFrom = (now: number) => new Date(now + SESSION_DAYS * DAY_MS).toISOString();

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** The session token from the Cookie header, if it is well formed. */
export function readSessionToken(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return isToken(value) ? value : null;
  }
  return null;
}

/** A new session for `userId`: the statement to run (alone or in a batch) and the cookie to send. */
export async function newSession(db: D1Database, userId: string): Promise<{ stmt: D1PreparedStatement; cookie: string }> {
  const token = newToken();
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const stmt = db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, iso, expiryFrom(now), iso);
  return { stmt, cookie: sessionCookie(token) };
}
