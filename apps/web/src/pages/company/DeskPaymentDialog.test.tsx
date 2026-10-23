import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskPaymentDialog } from './DeskPaymentDialog';

const booking = { id: 'b1', reference: 'ABC1234567', totalMinor: 150_000, currency: 'SLE' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init?: RequestInit) => Response) {
  document.cookie = 'csrf=abc; path=/';
  const calls: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return handler(String(input), init);
  });
  const onPaid = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeskPaymentDialog tenantId="t1" booking={booking} onClose={onClose} onPaid={onPaid} />
    </QueryClientProvider>,
  );
  return { calls, onPaid, onClose };
}

afterEach(() => vi.restoreAllMocks());

describe('DeskPaymentDialog', () => {
  it('shows the amount from the booking and sends only the method and reference', async () => {
    const user = userEvent.setup();
    const { calls, onPaid } = setup(() => json(201, { id: 'p1' }));
    expect(await screen.findByText('SLE 1,500.00')).toBeTruthy();
    expect(screen.queryByRole('spinbutton')).toBeNull(); // there is no amount field to type in
    await user.selectOptions(screen.getByLabelText('How was it paid?'), 'BANK_TRANSFER');
    await user.type(screen.getByLabelText(/Receipt or transaction number/), ' TX-77 ');
    await user.click(screen.getByRole('button', { name: 'Payment received' }));
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
    expect(calls[0]!.url).toBe('/api/v1/tenants/t1/bookings/b1/desk-payment');
    expect(calls[0]!.body).toEqual({ method: 'BANK_TRANSFER', reference: 'TX-77' });
  });

  it('defaults to cash and leaves the reference out when empty', async () => {
    const user = userEvent.setup();
    const { calls, onPaid } = setup(() => json(201, { id: 'p1' }));
    await user.click(await screen.findByRole('button', { name: 'Payment received' }));
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    expect(calls[0]!.body).toEqual({ method: 'CASH' });
  });

  it('shows the server refusal and does not report success', async () => {
    const user = userEvent.setup();
    const { onPaid } = setup(() =>
      json(409, { error: { code: 'CONFLICT', message: 'This booking is already paid' } }),
    );
    await user.click(await screen.findByRole('button', { name: 'Payment received' }));
    expect(await screen.findByText(/already paid/)).toBeTruthy();
    expect(onPaid).not.toHaveBeenCalled();
  });
});
