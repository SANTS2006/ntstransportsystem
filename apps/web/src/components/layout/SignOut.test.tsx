import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { PassengerShell } from './Layouts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeRouter = () =>
  createMemoryRouter(
    [
      {
        path: '/acme',
        element: <PassengerShell slug="acme" name="Acme" />,
        children: [{ index: true, element: <p>HOME</p> }],
      },
      { path: '/login', element: <p>LOGIN</p> },
    ],
    { initialEntries: ['/acme'] },
  );

afterEach(() => vi.restoreAllMocks());

describe('sign out', () => {
  it('shows the signing-out screen, calls logout, then goes to sign in', async () => {
    document.cookie = 'csrf=abc; path=/';
    const paths: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input).replace('/api/v1', '');
      paths.push(url);
      if (url === '/auth/me') {
        return json(200, {
          id: 'u',
          email: 'a@example.com',
          displayName: 'Ada Kamara',
          emailVerifiedAt: 'x',
          mfaEnabled: false,
          identities: [],
          platformRoles: [],
        });
      }
      return json(200, {});
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = makeRouter();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    const [button] = await screen.findAllByRole('button', { name: 'Sign out' });
    await userEvent.click(button!);
    expect(await screen.findByRole('alertdialog', { name: /Signing you out/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument(), { timeout: 4000 });
    expect(paths).toContain('/auth/logout');
  });

  it('never offers company registration to a signed-in user', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input).replace('/api/v1', '');
      return url === '/auth/me'
        ? json(200, {
            id: 'u',
            email: 'a@example.com',
            displayName: 'A',
            emailVerifiedAt: 'x',
            mfaEnabled: false,
            identities: [],
            platformRoles: [],
          })
        : json(200, {});
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = makeRouter();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('HOME');
    expect(screen.queryByText(/Register a company/i)).toBeNull();
  });
});
