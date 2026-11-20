import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-400-italic.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './design/tokens.css';
import './design/global.css';
import './design/components.css';
import './design/lists.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { startReloadWatcher } from './pwa/reloadWatcher';
import { cachedMe } from './data/useMe';
import { applyTheme } from './design/theme';
import { applyTextScale, getDeviceTheme, getTextScale, withDeviceLook } from './design/deviceLook';

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// This device's own theme and text size come first, synchronously, so there is no flash (the account's theme is only the start).
applyTextScale(getTextScale());
const deviceTheme = getDeviceTheme();
if (deviceTheme) applyTheme(deviceTheme);

// Paint with the user's theme from the on-device copy before the first render (no Midnight flash),
// but never wait more than 300 ms on IndexedDB.
const timeout = new Promise<null>((r) => setTimeout(() => r(null), 300));
Promise.race([cachedMe(), timeout])
  .then((me) => { if (me) applyTheme(withDeviceLook(me.settings)); })
  .catch(() => {})
  .finally(render);

// Look for a new version every 30 minutes while the app is open, and whenever it comes back to the
// front (Dan, 2026-11-17: friends shouldn't have to close and reopen it). With autoUpdate, a new
// version found this way installs and the page reloads into it.
const UPDATE_EVERY_MS = 30 * 60 * 1000;
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => { if (navigator.onLine !== false) void registration.update().catch(() => {}); };
    setInterval(check, UPDATE_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  },
});

// "Update everyone's app" (Admin): reload once when the admin has pressed it since this device last looked.
startReloadWatcher();

// iPhone Safari's own pinch gesture (it ignores user-scalable=no): block it so the app never zooms (Dan, 2026-11-20).
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
