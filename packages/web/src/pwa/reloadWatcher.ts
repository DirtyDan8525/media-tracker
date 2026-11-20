import { isTextField } from '../shell/useKeyboardLayout';

/**
 * "Update everyone's app" (Dan, 2026-11-20). The admin's button stores a time (`reloadAt`, GET /api/app). A device that finds a
 * time newer than the one it last saw checks for a new version and reloads once, when the app is opened or comes back to the
 * front, and never while a text field has focus.
 */
export const RELOAD_SEEN_KEY = 'mt-reload-seen';
/** How long to wait for a new version to show up (and again for it to take over) before reloading anyway. */
export const UPDATE_WAIT_MS = 5000;

export interface ReloadDeps {
  /** The current `reloadAt` from the server, or null; throws when it can't be read. */
  fetchReloadAt: () => Promise<string | null>;
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>;
  reload: () => void;
  waitMs: number;
}

const defaultDeps: ReloadDeps = {
  fetchReloadAt: async () => {
    const res = await fetch('/api/app', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`app ${res.status}`);
    const body = (await res.json()) as { reloadAt?: unknown };
    return typeof body.reloadAt === 'string' ? body.reloadAt : null;
  },
  getRegistration: async () => (navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : undefined),
  reload: () => location.reload(),
  waitMs: UPDATE_WAIT_MS,
};

/** What this device last saw: null = never stored; '' = stored while there was no reload time yet. */
function readSeen(): string | null {
  try { return localStorage.getItem(RELOAD_SEEN_KEY); } catch { return null; }
}
function writeSeen(v: string): boolean {
  try { localStorage.setItem(RELOAD_SEEN_KEY, v); return localStorage.getItem(RELOAD_SEEN_KEY) === v; } catch { return false; }
}
const ms = (iso: string): number => { const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };

let running = false;
let deferred = false;

/** Asks the service worker for a new version; if one arrives (and takes over), the page reloads once; else it reloads now. */
async function updateAndReload(deps: ReloadDeps): Promise<void> {
  const reg = await deps.getRegistration().catch(() => undefined);
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!reg || !sw) { deps.reload(); return; }
  let done = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cleanup = () => { timers.forEach(clearTimeout); sw.removeEventListener('controllerchange', finish); reg.removeEventListener('updatefound', onFound); };
  function finish() { if (done) return; done = true; cleanup(); deps.reload(); }
  const activate = (w: ServiceWorker) => {
    const skip = () => w.postMessage({ type: 'SKIP_WAITING' });
    if (w.state === 'installed') skip();
    else if (w.state === 'installing') w.addEventListener('statechange', () => { if (w.state === 'installed') skip(); });
    // Reload when it takes control; if it never does, don't leave the person waiting.
    timers.push(setTimeout(finish, deps.waitMs));
  };
  function onFound() { if (reg!.installing) activate(reg!.installing); }
  sw.addEventListener('controllerchange', finish);
  reg.addEventListener('updatefound', onFound);
  timers.push(setTimeout(finish, deps.waitMs)); // nothing new within the wait: reload as it is
  try { await reg.update(); } catch { /* offline or no new file: the timer decides */ }
  const incoming = reg.waiting ?? reg.installing;
  if (incoming && !done) { activate(incoming); }
  else if (!done && !reg.installing && !reg.waiting) {
    // update() said there is nothing new: no reason to wait the rest of the time.
    finish();
  }
}

async function perform(reloadAt: string, deps: ReloadDeps): Promise<void> {
  // Store first so this can never loop; if it can't be stored, don't reload at all.
  if (!writeSeen(reloadAt)) return;
  await updateAndReload(deps);
}

/** Waits for the typing to end (blur) before acting; being hidden and shown again runs a fresh check. */
function defer(deps: ReloadDeps): void {
  if (deferred) return;
  deferred = true;
  const onOut = () => {
    window.setTimeout(() => {
      if (isTextField(document.activeElement)) return;
      document.removeEventListener('focusout', onOut);
      deferred = false;
      void checkForReload(deps);
    }, 0);
  };
  document.addEventListener('focusout', onOut);
  const onHide = () => {
    if (document.visibilityState !== 'hidden') return;
    document.removeEventListener('visibilitychange', onHide);
    document.removeEventListener('focusout', onOut);
    deferred = false; // coming back to the front checks again
  };
  document.addEventListener('visibilitychange', onHide);
}

/** One check: compares the server's `reloadAt` with this device's last seen one. Never throws. */
export async function checkForReload(deps: ReloadDeps = defaultDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    const reloadAt = await deps.fetchReloadAt();
    const seen = readSeen();
    if (seen === null) { writeSeen(reloadAt ?? ''); return; } // a device that never stored one: new installs have the newest version anyway
    if (reloadAt === null || ms(reloadAt) <= ms(seen)) return;
    if (isTextField(document.activeElement)) { defer(deps); return; }
    await perform(reloadAt, deps);
  } catch {
    /* offline or an old server: try again next time */
  } finally {
    running = false;
  }
}

/** Checks now and every time the app comes back to the front. */
export function startReloadWatcher(deps: ReloadDeps = defaultDeps): void {
  void checkForReload(deps);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForReload(deps); });
}

/** Tests: forget the in-flight and deferred flags. */
export function resetReloadWatcher(): void { running = false; deferred = false; }
