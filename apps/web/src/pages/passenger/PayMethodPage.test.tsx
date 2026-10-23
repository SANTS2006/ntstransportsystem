import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayMethodPage, looksLikeTransactionNumber, type PayOption } from './PayMethodPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  reference: 'ABC1234567',
  status: 'PENDING_PAYMENT',
  company: 'Demo Coaches',
  totalMinor: 150_000,
  currency: 'SLE',
  holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  claim: null,
  ...over,
});
const online = (method: PayOption['method'], label: string): PayOption => ({
  method,
  label,
  kind: 'ONLINE',
});
const qmoneyManual: PayOption = {
  method: 'QMONEY',
  label: 'QMoney',
  kind: 'MANUAL',
  manual: { number: '+23233123456', accountName: 'Demo Coaches Ltd' },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}
function setup(
  data: { booking?: object; options: PayOption[] },
  extra?: (c: Call) => Response | undefined,
) {
  document.cookie = 'csrf=abc; path=/';
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const c: Call = {
      url: String(input).replace('/api/v1', ''),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(c);
    const custom = extra?.(c);
    if (custom) return custom;
    if (c.url.endsWith('/payment-options')) {
      return json(200, { booking: data.booking ?? booking(), options: data.options });
    }
    return json(200, {});
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app/bookings/b1/pay']}>
        <Routes>
          <Route path="/app/bookings/:id/pay" element={<PayMethodPage />} />
          <Route path="/app/bookings" element={<p>MY BOOKINGS</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('looksLikeTransactionNumber', () => {
  it('accepts what QMoney shows and refuses the obviously wrong', () => {
    for (const ok of ['QM123456', 'AB-12.34_56', ' 12345678 '])
      expect(looksLikeTransactionNumber(ok)).toBe(true);
    for (const bad of ['', 'abc', '-abcd', 'a'.repeat(41), 'abc<script>']) {
      expect(looksLikeTransactionNumber(bad)).toBe(false);
    }
  });
});

describe('PayMethodPage', () => {
  it('lists Orange Money, AfriMoney and QMoney, with the total', async () => {
    setup({
      options: [
        online('ORANGE_MONEY', 'Orange Money'),
        online('AFRIMONEY', 'AfriMoney'),
        qmoneyManual,
      ],
    });
    expect(await screen.findByText('SLE 1,500.00')).toBeTruthy();
    for (const label of ['Orange Money', 'AfriMoney', 'QMoney']) {
      expect(screen.getByRole('radio', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /Pay with/ })).toBeNull(); // nothing chosen yet
  });

  it('sends the chosen wallet to the server and follows the checkout address', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const calls = setup(
      { options: [online('ORANGE_MONEY', 'Orange Money'), online('AFRIMONEY', 'AfriMoney')] },
      (c) =>
        c.url.endsWith('/pay') ? json(201, { redirectUrl: 'https://pay.monime.io/s1' }) : undefined,
    );
    await user.click(await screen.findByRole('radio', { name: /AfriMoney/ }));
    await user.click(screen.getByRole('button', { name: 'Pay with AfriMoney' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.monime.io/s1'));
    expect(calls.find((c) => c.url.endsWith('/pay'))!.body).toEqual({ method: 'AFRIMONEY' });
    vi.unstubAllGlobals();
  });

  it('never follows a payment address that is not https', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    setup({ options: [online('ORANGE_MONEY', 'Orange Money')] }, (c) =>
      c.url.endsWith('/pay') ? json(201, { redirectUrl: 'http://evil.example/x' }) : undefined,
    );
    await user.click(await screen.findByRole('radio', { name: /Orange Money/ }));
    await user.click(screen.getByRole('button', { name: 'Pay with Orange Money' }));
    expect(await screen.findByText(/payment page address was not valid/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows how to pay QMoney, and only sends a sensible transaction number', async () => {
    const user = userEvent.setup();
    const calls = setup({ options: [online('ORANGE_MONEY', 'Orange Money'), qmoneyManual] });
    await user.click(await screen.findByRole('radio', { name: /QMoney/ }));
    expect(screen.getByText('+232 33 123 456')).toBeTruthy();
    expect(screen.getByText(/Demo Coaches Ltd/)).toBeTruthy();
    expect(screen.getAllByText(/SLE 1,500.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ABC1234567', { selector: 'strong' }).length).toBeGreaterThan(1); // also in the steps

    const send = screen.getByRole('button', { name: 'I have paid' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('QMoney transaction number'), 'ab');
    expect(send).toBeDisabled();
    await user.clear(screen.getByLabelText('QMoney transaction number'));
    await user.type(screen.getByLabelText('QMoney transaction number'), 'QM-889900');
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/manual-payment'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/manual-payment'))!.body).toEqual({
      method: 'QMONEY',
      reference: 'QM-889900',
    });
    // It never asked Monime for anything.
    expect(calls.some((c) => c.url.endsWith('/pay'))).toBe(false);
  });

  it('tells the passenger their notice was received and the seats are held', async () => {
    setup({
      booking: booking({ claim: { method: 'QMONEY', reference: 'QM-889900', createdAt: 'x' } }),
      options: [qmoneyManual],
    });
    expect(await screen.findByText(/QM-889900/)).toBeTruthy();
    expect(screen.getByText(/will confirm it once they see the payment/)).toBeTruthy();
  });

  it('says so when the company has no way to pay', async () => {
    setup({ options: [] });
    expect(await screen.findByText(/has not set up a way to pay/)).toBeTruthy();
  });

  it('shows the server refusal for a transaction number that was already used', async () => {
    const user = userEvent.setup();
    setup({ options: [qmoneyManual] }, (c) =>
      c.url.endsWith('/manual-payment')
        ? json(409, {
            error: {
              code: 'CONFLICT',
              message: 'That transaction number has already been used for a booking',
            },
          })
        : undefined,
    );
    await user.click(await screen.findByRole('radio', { name: /QMoney/ }));
    await user.type(screen.getByLabelText('QMoney transaction number'), 'QM-889900');
    await user.click(screen.getByRole('button', { name: 'I have paid' }));
    expect(await screen.findByText(/already been used/)).toBeTruthy();
  });

  it('does not offer to pay a booking that is already paid or gone', async () => {
    setup({ booking: booking({ status: 'CONFIRMED' }), options: [] });
    expect(await screen.findByText(/paid and confirmed/)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
