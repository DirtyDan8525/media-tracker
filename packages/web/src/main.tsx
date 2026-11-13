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
import { cachedMe } from './data/useMe';
import { applyTheme } from './design/theme';

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Paint with the user's theme from the on-device copy before the first render (no Midnight flash),
// but never wait more than 300 ms on IndexedDB.
const timeout = new Promise<null>((r) => setTimeout(() => r(null), 300));
Promise.race([cachedMe(), timeout])
  .then((me) => { if (me) applyTheme(me.settings); })
  .catch(() => {})
  .finally(render);

registerSW({ immediate: true });
