import { useSyncExternalStore } from 'react';

/**
 * Whether this device has a session (Phase 4b). The API client moves it to 'signedOut' on any
 * 401 (or 'removed' on a 401 `removed`); a successful sign-in moves it back to 'ok'.
 * SessionGate shows the sign-in screen (or the removed message) whenever it is not 'ok'.
 */
export type AuthState = 'ok' | 'signedOut' | 'removed';

let state: AuthState = 'ok';
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  if (state === next) return;
  state = next;
  for (const fn of listeners) fn();
}

/** Called by the API client on a 401 outside /api/auth/*. */
export function handleSignedOut(removed = false): void {
  setState(removed ? 'removed' : 'signedOut');
}

/** A sign-in, sign-up or password reset succeeded. */
export function markSignedIn(): void {
  setState('ok');
}

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
