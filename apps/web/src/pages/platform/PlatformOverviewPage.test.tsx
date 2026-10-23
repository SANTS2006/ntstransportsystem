import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformOverviewPage, money } from './PlatformOverviewPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const overview = {
  range: { from: '2026-10-01', to: '2026-10-30' },
  tenants: { ACTIVE: 4, PENDING: 2, SUSPENDED: 1, REJECTED: 0, DEACTIVATED: 0 },
  users: { total: 120, createdInRange: 9 },
  sales: [
    { currency: 'SLE', bookings: 3, seats: 5, revenueMinor: 1_250_000 },
    { currency: 'USD', bookings: 1, seats: 1, revenueMinor: 2_500 },
  ],
  topCompanies: [
    { tenantId: 't1', name: 'Demo Coaches', currency: 'SLE', bookings: 1, revenueMinor: 50_000 },
  ],
  openComplaints: 2,
  outbox: { pending: 7, deadLettered: 1 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlatformOverviewPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('money', () => {
  it('always shows the currency and two decimals', () => {
    expect(money(1_250_000, 'SLE')).toBe('SLE 12,500.00');
    expect(money(5, 'USD')).toBe('USD 0.05');
  });
});

describe('PlatformOverviewPage', () => {
  it('shows each currency separately and flags failed notifications', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(overview));
    renderPage();
    expect(await screen.findByText('SLE 12,500.00')).toBeTruthy();
    expect(screen.getByText('USD 25.00')).toBeTruthy();
    expect(screen.getByText('1 failed for good: needs attention')).toBeTruthy();
    expect(screen.getByText('Demo Coaches')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy(); // active companies
  });

  it('says so when there were no sales', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ ...overview, sales: [], topCompanies: [], outbox: { pending: 0, deadLettered: 0 } }),
    );
    renderPage();
    expect(await screen.findByText('No confirmed bookings in this range.')).toBeTruthy();
    expect(screen.getByText('none failed for good')).toBeTruthy();
  });
});
