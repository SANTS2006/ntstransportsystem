import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardingPage } from './BoardingPage';
import { AccessContext } from './company-context';

// The real camera needs a device; this stand-in "reads" whatever its buttons say.
vi.mock('../../components/ui/CameraScanner', () => ({
  CameraScanner: ({ onDetect }: { onDetect: (t: string) => void }) => (
    <div>
      <button type="button" onClick={() => onDetect('t1.qr-token-of-seat-3')}>
        camera sees QR
      </button>
      <button type="button" onClick={() => onDetect('AB12CD34EF')}>
        camera sees barcode
      </button>
    </div>
  ),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TENANT = '11111111-1111-4111-8111-111111111111';
const TRIP = '22222222-2222-4222-8222-222222222222';

function setup() {
  document.cookie = 'csrf=abc; path=/';
  const scans: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace('/api/v1', '');
    if (url.includes('/tickets/scan')) {
      scans.push(JSON.parse(String(init?.body)));
      return json(200, { ticket: { seat: '3', passengerName: 'Mariama Kanu' } });
    }
    if (url.includes('/manifest')) {
      return json(200, {
        trip: {
          id: TRIP,
          route: 'Freetown - Bo',
          status: 'BOARDING',
          departureAt: '2031-01-01T07:00:00Z',
        },
        counts: { total: 1, boarded: 0 },
        passengers: [],
      });
    }
    if (url.includes('/trips?')) {
      return json(200, {
        trips: [
          {
            id: TRIP,
            route: 'Freetown - Bo',
            departureAt: '2031-01-01T07:00:00Z',
            status: 'BOARDING',
          },
        ],
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccessContext.Provider
        value={{
          tenantId: TENANT,
          access: {
            role: { key: 'driver' },
            tenantStatus: 'ACTIVE',
            permissions: ['ticket.validate'],
          },
        }}
      >
        <BoardingPage />
      </AccessContext.Provider>
    </QueryClientProvider>,
  );
  return scans;
}

afterEach(() => vi.restoreAllMocks());

describe('boarding with the camera', () => {
  it('checks a scanned QR code or barcode at once, and ignores the same ticket held in view', async () => {
    const scans = setup();
    await screen.findByRole('option', { name: /Freetown - Bo/ });
    await userEvent.selectOptions(screen.getByLabelText('Trip'), TRIP);
    await userEvent.click(
      await screen.findByRole('button', { name: /scan tickets with the camera/i }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'camera sees QR' }));
    expect(await screen.findByText(/Welcome aboard: Mariama Kanu, seat 3/)).toBeInTheDocument();
    expect(scans).toEqual([{ token: 't1.qr-token-of-seat-3', tripId: TRIP }]);

    // The same QR code still in front of the camera is not sent again.
    await userEvent.click(screen.getByRole('button', { name: 'camera sees QR' }));
    // A barcode carries the ticket code.
    await userEvent.click(screen.getByRole('button', { name: 'camera sees barcode' }));
    await waitFor(() => expect(scans).toHaveLength(2));
    expect(scans[1]).toEqual({ code: 'AB12CD34EF', tripId: TRIP });
  });
});
