import type { QueryClient } from '@tanstack/react-query';
import { markSignedIn } from '../api/auth';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { localDb } from '../db/local';
import { forgetCurrentList } from '../shell/currentList';
import { cachedMe, ME_KEY, normalizeMe, storeMe } from './useMe';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export const login = (username: string, password: string) => api.post<Me>('/api/auth/login', { username, password });
export const signUp = (username: string, password: string, displayName?: string) =>
  api.post<Me>('/api/auth/signup', displayName ? { username, password, displayName } : { username, password });
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
  }
  const next = normalizeMe(me);
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
  qc.setQueryData(ME_KEY, next);
  qc.setQueryData(['me-cache'], next);
  await storeMe(next);
  markSignedIn();
}
