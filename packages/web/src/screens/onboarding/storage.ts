/**
 * What the walkthrough and install help remember on this device. The settings API only keeps the
 * keys it knows (the Worker drops the rest), so "seen" lives in localStorage, per user, and every
 * access is in try/catch (private mode and blocked storage throw).
 */
const SEEN_PREFIX = 'mt-walkthrough-seen:';
const INSTALL_DISMISSED = 'mt-install-dismissed';

function read(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function write(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* best-effort */ }
}

export const walkthroughSeen = (userId: string): boolean => read(SEEN_PREFIX + userId);
export const markWalkthroughSeen = (userId: string): void => write(SEEN_PREFIX + userId);

export const installDismissed = (): boolean => read(INSTALL_DISMISSED);
export const dismissInstall = (): void => write(INSTALL_DISMISSED);
