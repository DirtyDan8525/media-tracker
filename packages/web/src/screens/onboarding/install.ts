import { useSyncExternalStore } from 'react';

/** Chrome's install event (not in the DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own Install button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
}

/** True when the app is already running installed (home-screen icon / app window). */
export function isInstalled(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch { /* no matchMedia */ }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True on iPhone and iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** The browser's install prompt when it offered one: calling it opens the browser's own install dialog. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const e = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => deferred,
    () => null,
  );
  if (!e) return null;
  return async () => {
    await e.prompt();
    await e.userChoice.catch(() => undefined);
    deferred = null; // a prompt event can be used once
    emit();
  };
}
