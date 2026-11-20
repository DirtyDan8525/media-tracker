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

const ANNOUNCEMENT_PREFIX = 'mt-announcement-dismissed:';
export const announcementDismissed = (id: string): boolean => read(ANNOUNCEMENT_PREFIX + id);
export const dismissAnnouncement = (id: string): void => write(ANNOUNCEMENT_PREFIX + id);

/** The "Notifications are here" popup (one per device, not per user: the browser's permission is per device too). */
const NOTIFY_PROMPT_SEEN = 'mt-notify-prompt-seen';
export const notifyPromptSeen = (): boolean => read(NOTIFY_PROMPT_SEEN);
export const markNotifyPromptSeen = (): void => write(NOTIFY_PROMPT_SEEN);
