import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { CompanyLayout } from './CompanyPages';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderCompany(access: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/me')) {
      return status === 200
        ? json(200, access)
        : json(status, {
            error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: 'r' },
          });
    }
    return json(200, {});
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A data router is required because the layout renders the global progress bar (useNavigation).
  const router = createMemoryRouter(
    [
      {
        path: '/c/:tenantId',
        element: <CompanyLayout tenantId="11111111-1111-4111-8111-111111111111" />,
        children: [{ index: true, element: <p>OVERVIEW</p> }],
      },
    ],
    { initialEntries: ['/c/11111111-1111-4111-8111-111111111111'] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

const links = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('CompanyLayout navigation gating', () => {
  it('shows only the sections a driver may open', async () => {
    renderCompany({
      role: { key: 'driver' },
      tenantStatus: 'ACTIVE',
      permissions: ['trip.read', 'ticket.validate'],
    });
    await screen.findByText('OVERVIEW');
    expect(links()).toContain('Dashboard');
    expect(links()).not.toContain('Staff');
    expect(links()).not.toContain('Roles');
    expect(links()).not.toContain('Activity');
  });

  it('shows team, roles and activity to an owner', async () => {
    renderCompany({
      role: { key: 'owner' },
      tenantStatus: 'ACTIVE',
      permissions: ['membership.read', 'role.read', 'audit.read'],
    });
    await screen.findByText('OVERVIEW');
    expect(links()).toEqual(expect.arrayContaining(['Dashboard', 'Staff', 'Roles', 'Activity']));
  });

  it('hides operations for a company that is still pending review', async () => {
    renderCompany({
      role: { key: 'owner' },
      tenantStatus: 'PENDING',
      permissions: ['membership.read', 'audit.read'],
    });
    await screen.findByText('OVERVIEW');
    expect(links()).not.toContain('Staff');
    expect(links()).not.toContain('Activity');
  });

  it('shows a not-found style error (no company details) for a non-member', async () => {
    renderCompany(null, 404);
    expect(await screen.findByRole('alert')).toHaveTextContent('Resource not found');
    expect(screen.queryByText('OVERVIEW')).not.toBeInTheDocument();
  });
});
