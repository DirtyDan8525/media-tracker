/**
 * Public profile links (Phase 5 item 34): `/p/<token>`, 16 random bytes (128 bits) as base64url.
 * Like sessions and sign-up links, the SHA-256 is the lookup key (users.public_token_hash); the raw token is also kept (users.public_token, migration 0024) so the owner can share the link any time. Lookups hash
 * the presented token first and match the hash exactly in SQL, so the time taken says nothing about
 * how close a guess was.
 */
import { sha256Hex } from '../auth/session';

const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function newPublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The stored hash for a presented token, or null when it is not even shaped like one (no query needed). */
export async function publicTokenHash(token: string): Promise<string | null> {
  return PUBLIC_TOKEN_RE.test(token) ? sha256Hex(token) : null;
}
