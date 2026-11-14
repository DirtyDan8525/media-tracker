import { useSyncExternalStore } from 'react';

/**
 * Signed-out handling (Cloudflare Access session expired).
 *
 * The service worker answers navigations to app routes from its precache, so reloading `/`
 * would never reach Access. Instead we navigate to REAUTH_PATH: /api/* is denylisted from the
 * SW's navigation fallback, so the request hits the edge, Access shows its sign-in, and after
 * signing in the worker 302s back to `/`.
 *
 * Loop guard: the first signal in a browser session sets REAUTH_FLAG and hops; if the flag is
 * already set (we hopped and are still signed out), we stop and show "Can't sign you in".
 * A successful GET /api/me clears the flag.
 */
export const REAUTH_PATH = '/api/auth/reauth';
export const REAUTH_FLAG = 'mt-reauth';

export type AuthState = 'ok' | 'reauthing' | 'signedOut';

let state: AuthState = 'ok';
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  if (state === next) return;
  state = next;
  for (const fn of listeners) fn();
}

function readFlag(): boolean | null {
  try {
    return sessionStorage.getItem(REAUTH_FLAG) !== null;
  } catch {
    return null; // storage unavailable
  }
}

/** Called by the API client on a 401 or an opaque redirect. */
export function handleSignedOut(): void {
  if (state !== 'ok') return; // already hopping or showing the screen
  const flagged = readFlag();
  if (flagged === false) {
    try {
      sessionStorage.setItem(REAUTH_FLAG, '1');
      setState('reauthing');
      location.assign(REAUTH_PATH);
      return;
    } catch {
      // can't record the hop, so can't guard a loop: fall through to the screen
    }
  }
  setState('signedOut');
}

export function clearReauthFlag(): void {
  try {
    sessionStorage.removeItem(REAUTH_FLAG);
  } catch {
    // ignore
  }
}

/** The "Sign in again" button: a fresh hop, guarded again by the flag it sets. */
export function retrySignIn(): void {
  clearReauthFlag();
  state = 'ok';
  handleSignedOut();
}

export const isSignedOut = (): boolean => state === 'signedOut';
export const getAuthState = (): AuthState => state;

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getAuthState,
    getAuthState,
  );
}

/** Tests only. */
export function resetAuthState(): void {
  state = 'ok';
  for (const fn of listeners) fn();
}
