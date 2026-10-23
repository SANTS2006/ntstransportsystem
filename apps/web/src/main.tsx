import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AuthProvider } from './auth/AuthProvider';
import { ConfirmProvider } from './components/ui/Confirm';
import { ToastProvider } from './components/ui/Toast';
import { ApiError } from './lib/api';
import { router } from './router';
import './styles.css';

const queryClient: QueryClient = new QueryClient({
  // A timeout or dropped connection leaves a write's outcome unknown (the server may have
  // finished it). Refetch so the screen shows what actually happened instead of a stale "failed".
  mutationCache: new MutationCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 0) void queryClient.invalidateQueries();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false, // avoid needless requests on slow or metered connections
      retry: (count, err) => err instanceof ApiError && err.retryable && count < 2,
    },
    // Mutations are never retried automatically: a retried booking/payment could duplicate.
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
