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

function renderAt(
  path: string,
  signedIn: boolean,
  platformRoles: string[] = [],
  companies: { tenantId: string; name: string; membershipStatus: string }[] = [],
) {
  if (signedIn) document.cookie = 'csrf=abc; path=/';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/tenants/mine') ? json(200, { tenants: companies }) : me(platformRoles),
  );
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>LOGIN</p> },
      { path: '/platform', element: <p>PLATFORM AREA</p> },
      { path: '/c/:id', element: <p>COMPANY AREA</p> },
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
  it('sends platform staff straight to the platform area, never showing the passenger area', async () => {
    renderAt('/app', true, ['OPERATIONS']);
    await screen.findByText('PLATFORM AREA');
    expect(screen.queryByText('HOME')).toBeNull();
  });

  it('sends company staff straight to their company', async () => {
    renderAt('/app', true, [], [{ tenantId: 'c1', name: 'Coach Co', membershipStatus: 'ACTIVE' }]);
    await screen.findByText('COMPANY AREA');
  });

  it('keeps ordinary passengers in the passenger area, with no company or admin links', async () => {
    renderAt('/app', true, []);
    await screen.findByText('HOME');
    expect(linkTexts()).not.toContain('Platform admin');
    expect(linkTexts()).not.toContain('My companies');
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
