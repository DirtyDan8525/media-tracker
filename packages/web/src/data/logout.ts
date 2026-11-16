import type { QueryClient } from '@tanstack/react-query';
import { REAUTH_FLAG } from '../api/auth';
import { localDb } from '../db/local';
import { forgetCurrentList } from '../shell/currentList';

/** Cloudflare Access's logout URL; the service worker already leaves /cdn-cgi/ navigations to the network. */
export const LOGOUT_PATH = '/cdn-cgi/access/logout';

/** A step that hasn't settled by now (a blocked IndexedDB never rejects) is abandoned so the logout still happens. */
export const STEP_TIMEOUT_MS = 2000;

function withTimeout(work: unknown): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, STEP_TIMEOUT_MS); });
  return Promise.race([Promise.resolve(work), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Log out (B19): forget everything this device holds for the user, then go to Access's logout page.
 * Every step is best-effort and independent: failing storage or a failing table must still reach the
 * logout URL, and the next person to open the app must see nothing of this user.
 */
export async function logOut(qc: QueryClient): Promise<void> {
  const steps: (() => unknown)[] = [
    () => qc.cancelQueries(), // a fetch landing after the clear would write the cache again
    () => localDb.entries.clear(),
    () => localDb.me.clear(),
    () => qc.clear(),
    () => sessionStorage.removeItem(REAUTH_FLAG),
    () => forgetCurrentList(),
  ];
  for (const step of steps) {
    try {
      await withTimeout(step());
    } catch {
      // keep going: clear what we can
    }
  }
  location.assign(LOGOUT_PATH);
}
