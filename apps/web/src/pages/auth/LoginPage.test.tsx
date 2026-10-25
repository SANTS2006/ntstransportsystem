import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import LoginPage from './LoginPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const signedOut = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
const me = (mfaEnabled: boolean) =>
  json(200, {
    id: 'u',
    email: 'a@example.com',
    displayName: 'A',
    emailVerifiedAt: 'x',
    mfaEnabled,
    identities: [],
    platformRoles: [],
  });

function renderLogin(url = '/login') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/app/dashboard" element={<p>DASHBOARD</p>} />
            <Route path="/app/security" element={<p>SECURITY</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** Routes fetch by URL so the AuthProvider's /auth/me probe and the form calls can coexist. */
function mockApi(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input).replace('/api/v1', '');
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected request: ${url}`);
    return handler();
  });
}
const callsTo = (spy: ReturnType<typeof mockApi>, path: string) =>
  spy.mock.calls.filter(([u]) => String(u).endsWith(path));

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText('Email address / Phone number'), 'a@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'whatever-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

afterEach(() => vi.restoreAllMocks());

describe('LoginPage', () => {
  it('validates locally and never calls the server with invalid input', async () => {
    const spy = mockApi({ '/auth/me': signedOut });
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Enter your email address or phone number')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(callsTo(spy, '/auth/login')).toHaveLength(0);
  });

  it('shows the generic server error', async () => {
    mockApi({
      '/auth/me': signedOut,
      '/auth/login': () =>
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' } }),
    });
    renderLogin();
    await fillCredentials();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('prevents double submission while the request is pending', async () => {
    let release: (r: Response) => void = () => undefined;
    const spy = mockApi({
      '/auth/me': signedOut,
      '/auth/login': () => new Promise<Response>((r) => (release = r)),
    });
    renderLogin();
    await fillCredentials();
    const busy = await screen.findByRole('button', { name: /Signing in/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(busy);
    expect(callsTo(spy, '/auth/login')).toHaveLength(1);
    release(signedOut());
  });

  it('walks through the MFA step and honours a safe ?next=', async () => {
    let signedIn = false;
    const spy = mockApi({
      '/auth/me': () => (signedIn ? me(true) : signedOut()),
      '/auth/login': () => json(200, { mfaRequired: true, challengeToken: 'c'.repeat(43) }),
      '/auth/mfa/verify': () => {
        signedIn = true;
        return json(200, { userId: 'u' });
      },
    });
    renderLogin('/login?next=%2Fapp%2Fsecurity');
    await fillCredentials();

    expect(await screen.findByText('Two-step verification')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByText('SECURITY')).toBeInTheDocument());
    const body = JSON.parse(String(callsTo(spy, '/auth/mfa/verify')[0]?.[1]?.body));
    expect(body).toEqual({ challengeToken: 'c'.repeat(43), code: '123456' });
  });

  it('ignores an unsafe ?next= and falls back to the dashboard', async () => {
    let signedIn = false;
    mockApi({
      '/auth/me': () => (signedIn ? me(false) : signedOut()),
      '/auth/login': () => {
        signedIn = true;
        return json(200, { userId: 'u' });
      },
    });
    renderLogin('/login?next=%2F%2Fevil.example');
    await fillCredentials();
    await waitFor(() => expect(screen.getByText('DASHBOARD')).toBeInTheDocument());
  });
});
