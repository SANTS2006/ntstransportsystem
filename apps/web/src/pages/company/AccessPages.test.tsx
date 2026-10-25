import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { AccessContext } from './company-context';
import { RolesPage } from './AccessPages';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ROLES = {
  catalog: ['trip.read', 'trip.manage', 'booking.read', 'booking.manage'],
  roles: [
    {
      id: 'r-owner',
      key: 'owner',
      name: 'Company Owner',
      isSystem: true,
      members: 1,
      permissions: ['trip.read', 'trip.manage', 'booking.read', 'booking.manage'],
    },
    {
      id: 'r-disp',
      key: 'dispatcher',
      name: 'Dispatcher',
      isSystem: false,
      members: 2,
      permissions: ['trip.read'],
    },
  ],
};

function renderPage(permissions: string[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace('/api/v1', '');
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    if (url.endsWith('/roles') && (init?.method ?? 'GET') === 'GET') return json(200, ROLES);
    return new Response(null, { status: 204 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <AccessContext.Provider
          value={{
            tenantId: 't1',
            access: { role: { key: 'owner' }, tenantStatus: 'ACTIVE', permissions },
          }}
        >
          <RolesPage />
        </AccessContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('Roles and permissions', () => {
  it('shows what a role has and has not, and saves the ticked set', async () => {
    const user = userEvent.setup();
    const calls = renderPage([
      'role.manage',
      'trip.read',
      'trip.manage',
      'booking.read',
      'booking.manage',
    ]);
    await user.click(await screen.findByRole('button', { name: /Dispatcher/ }));
    const tripManage = await screen.findByRole('checkbox', { name: /trip\.manage/ });
    expect(tripManage).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /trip\.read/ })).toBeChecked();

    await user.click(tripManage);
    await user.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/tenants/t1/roles/r-disp/permissions');
    expect((put.body as { permissions: string[] }).permissions.sort()).toEqual([
      'trip.manage',
      'trip.read',
    ]);
  });

  it('locks system roles and people who cannot manage roles', async () => {
    const user = userEvent.setup();
    renderPage(['role.manage', 'trip.read']);
    await user.click(await screen.findByRole('button', { name: /Company Owner/ }));
    expect(await screen.findByText('System role: locked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });

  it('hides editing from someone without the role.manage permission', async () => {
    renderPage(['role.read']);
    await screen.findByRole('button', { name: /Dispatcher/ });
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });
});
