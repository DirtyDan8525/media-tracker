import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../App';
import { routes } from '../routes';
import { makeQueryClient } from './queryClient';


/** Renders the whole app (providers + routes) at `path` in a memory router. */
export function renderApp(path: string) {
  // The first-sign-in walkthrough and the install banner are tested on their own (onboarding.test.tsx).
  try { localStorage.setItem('mt-walkthrough-seen:u1', '1'); localStorage.setItem('mt-install-dismissed', '1'); } catch { /* storage unavailable */ }
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = makeQueryClient();
  const utils = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router, queryClient };
}
