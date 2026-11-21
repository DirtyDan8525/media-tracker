import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { AFTER_SETUP_KEY } from './social';
import { localDb } from '../db/local';
import { forgetCurrentList } from '../shell/currentList';
import { forgetAddList } from '../shell/lastAddList';

/** After logging out the app reloads here: no session, so it opens on the sign-in screen. */
export const LOGOUT_REDIRECT = '/';

/** A step that hasn't settled by now (a blocked IndexedDB never rejects) is abandoned so the logout still happens. */
export const STEP_TIMEOUT_MS = 2000;

/** The whole logout waits at most this long in total, however many steps hang (each still starts). */
export const LOGOUT_DEADLINE_MS = 4000;

function withTimeout(work: unknown, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([Promise.resolve(work), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Log out (B19): forget everything this device holds for the user, end the session on the server, then reload at the sign-in screen.
 * Every step is best-effort and independent: failing storage or a failing table or request must still end in a reload, and the next person to open the app must see nothing of this user.
 */
export async function logOut(qc: QueryClient): Promise<void> {
  const steps: (() => unknown)[] = [
    () => qc.cancelQueries(), // a fetch landing after the clear would write the cache again
    () => api.post('/api/auth/logout'), // the server forgets the session and clears the cookie
    () => localDb.entries.clear(),
    () => localDb.me.clear(),
    () => qc.clear(),
    () => sessionStorage.removeItem(AFTER_SETUP_KEY),
    () => forgetCurrentList(),
    () => forgetAddList(),
  ];
  const deadline = Date.now() + LOGOUT_DEADLINE_MS;
  for (const step of steps) {
    try {
      // Past the deadline a step still starts (its synchronous clean-up runs) but is not waited for.
      await withTimeout(step(), Math.max(0, Math.min(STEP_TIMEOUT_MS, deadline - Date.now())));
    } catch {
      // keep going: clear what we can
    }
  }
  location.assign(LOGOUT_REDIRECT);
}
