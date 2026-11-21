import type { QueryClient } from '@tanstack/react-query';
import { markSignedIn } from '../api/auth';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { localDb } from '../db/local';
import { forgetCurrentList } from '../shell/currentList';
import { forgetAddList } from '../shell/lastAddList';
import { APP_KEY } from './appSettings';
import { cachedMe, ME_KEY, normalizeMe, storeMe } from './useMe';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export const login = (username: string, password: string) => api.post<Me>('/api/auth/login', { username, password });
/** `joinLink: 'invalid'` comes back when a sign-up link was sent but did not work (used, expired, revoked). */
export type SignUpResult = Me & { joinLink?: 'invalid' };
export const signUp = (username: string, password: string, displayName?: string, joinToken?: string) =>
  api.post<SignUpResult>('/api/auth/signup', { username, password, ...(displayName ? { displayName } : {}), ...(joinToken ? { joinToken } : {}) });
/** Is this sign-up link still good? (the /join page; no session needed) */
export const checkJoinLink = (token: string) => api.get<{ valid: boolean }>(`/api/auth/join/${encodeURIComponent(token)}`);
/** Set when a signed-up person's link did not work, so the Waiting screen can say so (once). */
export const JOIN_INVALID_KEY = 'mt-join-invalid';
export const JOIN_INVALID_TEXT = 'That link was already used or expired — Dan will approve you soon.';
export const JOIN_INVITED_TEXT = "You're invited — your account is ready as soon as you sign up.";
export const resetPassword = (token: string, password: string) => api.post<Me>('/api/auth/reset', { token, password });

/**
 * A sign-in, sign-up or reset succeeded: the cookie is set, `me` is the answer. Someone else's
 * on-device copy (a different user last used this device) is wiped first; then the app is told
 * it is signed in and every query refetches under the new session.
 */
export async function finishSignIn(qc: QueryClient, me: Me): Promise<void> {
  const previous = await cachedMe();
  if (previous && previous.id !== me.id) {
    try {
      await Promise.all([localDb.entries.clear(), localDb.me.clear()]);
    } catch {
      // best-effort
    }
    forgetCurrentList();
    forgetAddList();
  }
  const next = normalizeMe(me);
  // The app settings are the same for everyone, so they stay.
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] && q.queryKey[0] !== APP_KEY[0] });
  qc.setQueryData(ME_KEY, next);
  qc.setQueryData(['me-cache'], next);
  await storeMe(next);
  markSignedIn();
}

/** Settings → Account → Change password. Needs the current password; every other device is signed out (this one stays). */
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post<{ ok: true; signedOutOthers: number }>('/api/auth/password', { currentPassword, newPassword });
