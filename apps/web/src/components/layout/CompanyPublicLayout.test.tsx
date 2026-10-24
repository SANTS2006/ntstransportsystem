import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { CompanyPublicLayout } from './CompanyPublicLayout';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderAt(path: string, company: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/me'))
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    if (url.includes('/public/companies/')) {
      return company
        ? json(200, company)
        : json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    }
    return json(200, { trips: [], jobs: [] });
  });
  const router = createMemoryRouter(
    [
      {
        path: '/:slug',
        element: <CompanyPublicLayout />,
        children: [{ index: true, element: <p>COMPANY HOME</p> }],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('a company public site', () => {
  it('shows the company, and sends sign in, create account, trips and jobs to its own pages', async () => {
    renderAt('/acme-coaches', {
      id: 'c1',
      name: 'Acme Coaches',
      slug: 'acme-coaches',
      logoUrl: null,
      primaryColor: '#0b6e4f',
      accentColor: null,
    });
    await screen.findByText('COMPANY HOME');
    const href = (name: string) =>
      screen.getAllByRole('link', { name }).map((a) => a.getAttribute('href'));
    expect(href('Sign in')).toContain('/acme-coaches/login');
    expect(href('Create account')).toContain('/acme-coaches/register');
    expect(href('Find a trip')).toContain('/acme-coaches/trips');
    expect(href('Jobs')).toContain('/acme-coaches/jobs');
    expect(screen.getAllByText('Acme Coaches').length).toBeGreaterThan(0);
  });

  it('says so when there is no such company', async () => {
    renderAt('/nobody-here', null);
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});
