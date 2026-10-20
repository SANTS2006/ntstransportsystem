import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessContext } from './company-context';
import { CrewPanel } from './CrewPanel';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const TENANT = '11111111-1111-4111-8111-111111111111';
const TRIP = '22222222-2222-4222-8222-222222222222';
const roster = [
  { id: 'e1', fullName: 'Aminata Kamara', role: 'DRIVER', licenceExpiresOn: '2033-01-01' },
  { id: 'e2', fullName: 'Musa Bangura', role: 'DRIVER', licenceExpiresOn: null },
  { id: 'e3', fullName: 'Chris Conductor', role: 'CONDUCTOR', licenceExpiresOn: null },
];

function setup(crew: unknown[], assignResponse?: Response) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace('/api/v1', '');
    if (url.endsWith(`/trips/${TRIP}/crew`) && init?.method === 'POST')
      return assignResponse ?? new Response(null, { status: 204 });
    if (url.endsWith(`/trips/${TRIP}/crew`)) return json(200, { crew });
    if (url.endsWith('/crew/roster')) return json(200, { roster });
    throw new Error(`unexpected request: ${url}`);
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <AccessContext.Provider
        value={{
          tenantId: TENANT,
          access: {
            role: { key: 'dispatcher' },
            tenantStatus: 'ACTIVE',
            permissions: ['trip.manage'],
          },
        }}
      >
        <CrewPanel tripId={TRIP} canManage open />
      </AccessContext.Provider>
    </QueryClientProvider>,
  );
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe('CrewPanel', () => {
  it('lists current crew and offers only people not already on the trip', async () => {
    setup([{ employeeId: 'e1', fullName: 'Aminata Kamara', role: 'DRIVER' }]);
    expect(await screen.findByText('Aminata Kamara')).toBeInTheDocument();
    const options = await screen.findAllByRole('option');
    const names = options.map((o) => o.textContent);
    expect(names).toContain('Musa Bangura (driver)');
    expect(names).toContain('Chris Conductor (conductor)');
    expect(names).not.toContain('Aminata Kamara (driver)');
  });

  it('assigns the picked person with their own job role, never a client-chosen one', async () => {
    const spy = setup([]);
    await screen.findByText('No crew assigned yet.');
    await userEvent.selectOptions(await screen.findByLabelText('Choose crew member'), 'e3');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(spy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ employeeId: 'e3', role: 'CONDUCTOR' });
  });

  it("shows the server's reason when an assignment is refused", async () => {
    setup(
      [],
      json(409, {
        error: {
          code: 'CONFLICT',
          message: 'This driver has no licence valid on 2026-10-22',
          requestId: 'r1',
        },
      }),
    );
    await screen.findByText('No crew assigned yet.');
    await userEvent.selectOptions(await screen.findByLabelText('Choose crew member'), 'e2');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no licence valid on 2026-10-22');
  });

  it('disables Assign until someone is chosen', async () => {
    setup([]);
    await screen.findByText('No crew assigned yet.');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });
});
