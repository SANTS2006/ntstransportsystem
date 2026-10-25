import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Probe() {
  const { user, loading, error } = useAuth();
  if (loading) return <p>loading</p>;
  if (error) return <p>error:{error.status}</p>;
  return <p>{user ? `user:${user.email}` : 'signed-out'}</p>;
}
const renderProbe = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );

const clearCsrf = () => {
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

afterEach(() => {
  vi.restoreAllMocks();
  clearCsrf();
});

describe('AuthProvider', () => {
  it('skips the session probe entirely when there is no csrf cookie (signed out)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    renderProbe();
    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads the user when the cookie hint is present', async () => {
    document.cookie = 'csrf=abc; path=/';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        id: 'u',
        email: 'a@example.com',
        displayName: 'A',
        emailVerifiedAt: 'x',
        mfaEnabled: false,
        identities: [],
        platformRoles: [],
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByText('user:a@example.com')).toBeInTheDocument());
  });

  it('treats a 401 as signed out even if the hint cookie is stale', async () => {
    document.cookie = 'csrf=stale; path=/';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
  });

  it('surfaces a server failure as an error, not as signed out', async () => {
    document.cookie = 'csrf=abc; path=/';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }),
    );
    renderProbe();
    // The provider retries a 5xx twice with backoff (1s, 2s) before reporting the failure.
    await waitFor(() => expect(screen.getByText('error:500')).toBeInTheDocument(), {
      timeout: 6000,
    });
  });

  it('signs the page out when it is shown again (Back button) after the session is gone', async () => {
    document.cookie = 'csrf=abc; path=/';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        id: 'u',
        email: 'a@example.com',
        displayName: 'A',
        emailVerifiedAt: 'x',
        mfaEnabled: false,
        identities: [],
        platformRoles: [],
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByText('user:a@example.com')).toBeInTheDocument());
    clearCsrf(); // signing out removes this cookie
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
  });
});
