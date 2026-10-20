import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell, RequireAuth } from './Layouts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const me = (platformRoles: string[]) =>
  json(200, {
    id: 'u',
    email: 'a@example.com',
    displayName: 'A',
    emailVerifiedAt: 'x',
    mfaEnabled: true,
    identities: [],
    platformRoles,
  });

function renderAt(path: string, signedIn: boolean, platformRoles: string[] = []) {
  if (signedIn) document.cookie = 'csrf=abc; path=/';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => me(platformRoles));
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>LOGIN</p> },
      {
        path: '/app',
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [{ index: true, element: <p>HOME</p> }],
      },
      {
        path: '/private/x',
        element: (
          <RequireAuth>
            <p>PRIVATE</p>
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

const linkTexts = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('AppShell', () => {
  it('offers the platform admin link only to platform staff', async () => {
    renderAt('/app', true, ['OPERATIONS']);
    await screen.findByText('HOME');
    expect(linkTexts()).toContain('Platform admin');
  });

  it('does not show it to ordinary users', async () => {
    renderAt('/app', true, []);
    await screen.findByText('HOME');
    expect(linkTexts()).not.toContain('Platform admin');
  });
});

describe('RequireAuth redirects', () => {
  it('sends signed-out visitors to login without a redundant next for /app', async () => {
    const router = renderAt('/app', false);
    await screen.findByText('LOGIN');
    expect(router.state.location.search).toBe('');
  });

  it('preserves other destinations in ?next=', async () => {
    const router = renderAt('/private/x', false);
    await screen.findByText('LOGIN');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/private/x');
  });
});
