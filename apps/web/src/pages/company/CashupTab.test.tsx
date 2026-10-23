import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CashupTab, amount } from './CashupTab';
import { DeskRefundDialog } from './DeskPaymentDialog';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {ui}
    </QueryClientProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe('amount', () => {
  it('keeps the currency code and two decimals', () => {
    expect(amount(25_000, 'SLE')).toBe('SLE 250.00');
  });
});

describe('CashupTab', () => {
  const data = {
    timezone: 'Africa/Freetown',
    byClerk: [
      {
        userId: 'u1',
        name: 'Fanta Jalloh',
        method: 'CASH',
        currency: 'SLE',
        payments: 2,
        amountMinor: 45_000,
      },
      {
        userId: 'u2',
        name: 'Musa Kamara',
        method: 'MOBILE_MONEY',
        currency: 'SLE',
        payments: 1,
        amountMinor: 25_000,
      },
    ],
    refunds: [{ method: 'MOBILE_MONEY', currency: 'SLE', refunds: 1, amountMinor: 25_000 }],
    net: [
      {
        method: 'CASH',
        currency: 'SLE',
        collectedMinor: 45_000,
        refundedMinor: 0,
        netMinor: 45_000,
      },
      {
        method: 'MOBILE_MONEY',
        currency: 'SLE',
        collectedMinor: 25_000,
        refundedMinor: 25_000,
        netMinor: 0,
      },
    ],
    refundsStillOwed: [{ currency: 'SLE', count: 2, amountMinor: 30_000 }],
  };

  it('shows each clerk, the totals by method, and warns about refunds still owed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, data));
    wrap(<CashupTab tenantId="t1" from="2026-10-01" to="2026-10-31" enabled />);
    expect(await screen.findByText('Fanta Jalloh')).toBeTruthy();
    expect(screen.getByText('Musa Kamara')).toBeTruthy();
    expect(screen.getAllByText('SLE 450.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toContain('2 refunds still owed (SLE 300.00)');
  });

  it('says so when there are no desk payments', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(200, { ...data, byClerk: [], refunds: [], net: [], refundsStillOwed: [] }),
    );
    wrap(<CashupTab tenantId="t1" from="2026-10-01" to="2026-10-31" enabled />);
    expect(await screen.findByText('No desk payments in this period.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('DeskRefundDialog', () => {
  const booking = { id: 'b9', reference: 'ZZ99', totalMinor: 25_000, currency: 'SLE' };

  it('shows the amount, sends only an optional reference, and reports success', async () => {
    document.cookie = 'csrf=abc; path=/';
    const user = userEvent.setup();
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return json(200, { id: 'p' });
    });
    const onDone = vi.fn();
    wrap(<DeskRefundDialog tenantId="t1" booking={booking} onClose={vi.fn()} onDone={onDone} />);
    expect(await screen.findByText('SLE 250.00')).toBeTruthy();
    await user.type(screen.getByLabelText(/Receipt or transaction number/), 'R-5');
    await user.click(screen.getByRole('button', { name: 'Money handed back' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]).toEqual({
      url: '/api/v1/tenants/t1/bookings/b9/desk-refund',
      body: { reference: 'R-5' },
    });
  });

  it('shows the refusal and does not report success', async () => {
    document.cookie = 'csrf=abc; path=/';
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(409, { error: { code: 'CONFLICT', message: 'This payment was already refunded' } }),
    );
    const onDone = vi.fn();
    wrap(<DeskRefundDialog tenantId="t1" booking={booking} onClose={vi.fn()} onDone={onDone} />);
    await user.click(await screen.findByRole('button', { name: 'Money handed back' }));
    expect(await screen.findByText(/already refunded/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
