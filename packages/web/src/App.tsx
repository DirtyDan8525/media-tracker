import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { FEATURE_OFF_TEXT, setFeatureOffHandler } from './api/featureOff';
import { APP_KEY, useAppSettings } from './data/appSettings';
import { ToastProvider, useToast } from './design/components/Toast';
import { applyTheme } from './design/theme';
import { routes } from './routes';

/** The app's name in the tab title, and the accent for people who are not signed in (the signed-in theme applies it itself). */
function BrandEffects() {
  const { brand } = useAppSettings();
  useEffect(() => { document.title = brand.name; }, [brand.name]);
  useEffect(() => {
    const root = document.documentElement;
    if (brand.accent && !root.style.getPropertyValue('--bg')) applyTheme({ theme: 'Midnight', colors: {} }, root, brand.accent);
  }, [brand.accent]);
  return null;
}

/** A 403 `feature_off` from any write: say so kindly and re-read the switches, so the button disappears. */
function FeatureOffNotice() {
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    setFeatureOffHandler(() => { toast.show(FEATURE_OFF_TEXT); void qc.invalidateQueries({ queryKey: APP_KEY }); });
    return () => setFeatureOffHandler(null);
  }, [toast, qc]);
  return null;
}

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider><BrandEffects /><FeatureOffNotice />{children}</ToastProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [queryClient] = useState(() => new QueryClient({
    // Retry network failures once; an HTTP answer (incl. signed-out 401) won't change on retry.
    defaultOptions: { queries: { staleTime: 30_000, retry: (n, err) => !(err instanceof ApiError) && n < 1 } },
  }));
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
