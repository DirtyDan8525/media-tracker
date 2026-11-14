import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { ToastProvider } from './design/components/Toast';
import { routes } from './routes';

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
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
