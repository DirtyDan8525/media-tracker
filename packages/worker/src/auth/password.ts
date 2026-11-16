/**
 * A2: PBKDF2-SHA256 via WebCrypto, 16-byte salt, stored as `pbkdf2$<iterations>$<salt b64>$<hash b64>`.
 * New hashes use 30,000 iterations so a sign-in fits the Workers Free plan's 10 ms CPU budget
 * (Dan, 2026-11-16: stay on Free; ~6 ms measured in Node). Verification uses the count stored in the
 * hash (10,000-100,000, Workers' cap), so the count can be raised later without resetting anyone. Runs in the Worker and, unchanged, in Node
 * (scripts/set-password.ts), so both hash the same way.
 */
export const PBKDF2_ITERATIONS = 30_000;
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 100_000;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const SALT_BYTES = 16;
const HASH_BITS = 256;

/** 8-128 characters (code points). */
export function validPassword(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const n = [...v].length;
  return n >= PASSWORD_MIN && n <= PASSWORD_MAX;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function unb64(s: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/** Constant-time comparison of two byte strings (length is not secret: always 32 here). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

/** A well-formed stored value that matches no password: unknown usernames still cost one hash. */
const DUMMY = `pbkdf2$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

/**
 * True when `password` matches `stored`. A missing or malformed `stored` still runs one full hash
 * (against a dummy) and answers false, so timing does not tell whether the account exists.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  const iterations = /^\d{5,6}$/.test(parts[1] ?? '') ? Number(parts[1]) : NaN;
  const ok =
    parts.length === 4 && parts[0] === 'pbkdf2' && iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS
      && unb64(parts[2]!)?.length === SALT_BYTES && unb64(parts[3]!)?.length === HASH_BITS / 8;
  const [, , saltB64, hashB64] = (ok ? stored! : DUMMY).split('$');
  const actual = await derive(password, unb64(saltB64!)!, ok ? iterations : PBKDF2_ITERATIONS);
  return timingSafeEqual(actual, unb64(hashB64!)!) && ok;
}
