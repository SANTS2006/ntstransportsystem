import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell, isAppPath } from './NotificationBell';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Booking confirmed',
  body: 'Freetown to Bo',
  link: '/app/bookings/abc',
  createdAt: '2026-10-24T10:00:00.000Z',
  read: false,
  ...over,
});

function setup(handler: (url: string, init?: RequestInit) => Response) {
  document.cookie = 'csrf=abc; path=/';
  const calls: { url: string; method: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    return handler(url, init);
  });
  const router = createMemoryRouter(
    [
      { path: '/', element: <NotificationBell /> },
      { path: '/app/bookings/:id', element: <p>BOOKING PAGE</p> },
    ],
    { initialEntries: ['/'] },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls };
}

afterEach(() => vi.restoreAllMocks());

describe('isAppPath', () => {
  it('accepts in-app paths only', () => {
    expect(isAppPath('/app/bookings/1')).toBe(true);
    expect(isAppPath(null)).toBe(false);
    expect(isAppPath('https://evil.example/x')).toBe(false);
    expect(isAppPath('//evil.example/x')).toBe(false);
    expect(isAppPath('javascript:alert(1)')).toBe(false);
  });
});

describe('NotificationBell', () => {
  it('shows the unread count on the bell', async () => {
    setup((url) => (url.includes('unread-count') ? json({ unread: 3 }) : json({})));
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
  });

  it('marks a notification read and follows its link', async () => {
    const user = userEvent.setup();
    const { calls } = setup((url, init) => {
      if (url.includes('unread-count')) return json({ unread: 1 });
      if (init?.method === 'POST') return new Response(null, { status: 204 });
      return json({ unread: 1, items: [item()] });
    });
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByText('Booking confirmed'));
    await waitFor(() => expect(screen.getByText('BOOKING PAGE')).toBeTruthy());
    expect(
      calls.some(
        (c) =>
          c.method === 'POST' &&
          c.url.endsWith('/me/notifications/11111111-1111-4111-8111-111111111111/read'),
      ),
    ).toBe(true);
  });

  it('does not follow a link that leaves the app', async () => {
    const user = userEvent.setup();
    setup((url, init) => {
      if (url.includes('unread-count')) return json({ unread: 1 });
      if (init?.method === 'POST') return new Response(null, { status: 204 });
      return json({ unread: 1, items: [item({ link: 'https://evil.example/phish' })] });
    });
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByText('Booking confirmed'));
    expect(screen.queryByText('BOOKING PAGE')).toBeNull();
  });

  it('says so when there is nothing, and survives an unexpected response shape', async () => {
    const user = userEvent.setup();
    setup(() => json({ id: 'u', email: 'a@example.com' }));
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
  });
});
