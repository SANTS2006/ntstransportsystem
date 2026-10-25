import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import LoginPage from './LoginPage';
import { RESEND_SECONDS, ResetPhonePasswordPage, VerifyPhonePage } from './PhonePages';
import RegisterPage from './RegisterPage';
import { ForgotPasswordPage, VerifyEmailCodePage } from './TokenPages';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** Answers /features and /auth/me, and lets each test decide the rest. */
function mockApi(opts: { phoneSignup?: boolean; handler?: (c: Call) => Response | undefined }) {
  document.cookie = 'csrf=abc; path=/';
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace('/api/v1', '');
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    if (url === '/features') {
      return json(200, { fileUploads: false, phoneSignup: opts.phoneSignup === true });
    }
    if (url === '/auth/me') return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    return opts.handler?.(call) ?? json(200, {});
  });
  return calls;
}

/** Shows where the app navigated to. */
function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

function renderAt(url: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/:slug/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/verify-email-code" element={<VerifyEmailCodePage />} />
            <Route path="/:slug/verify-email-code" element={<VerifyEmailCodePage />} />
            <Route path="/:slug/verify-phone" element={<VerifyPhonePage />} />
            <Route path="/verify-phone" element={<VerifyPhonePage />} />
            <Route path="/reset-password-phone" element={<ResetPhonePasswordPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/app" element={<p>DASHBOARD</p>} />
          </Routes>
          <Where />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
const where = () => screen.getByTestId('where').textContent;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Sign up with a phone number', () => {
  it('refuses a phone number on the form when the server cannot send texts', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ phoneSignup: false });
    renderAt('/acme-coaches/register');
    await user.type(await screen.findByLabelText('Email address / Phone number'), '076 123 456');
    await user.type(screen.getByLabelText('Full name'), 'Fanta');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/cannot be used on this server yet/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/auth/register-phone')).toBe(false);
  });

  it('does not create the account until the agreement box is ticked', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ phoneSignup: false });
    renderAt('/acme-coaches/register');
    await user.type(
      await screen.findByLabelText('Email address / Phone number'),
      'ada@example.com',
    );
    await user.type(screen.getByLabelText('Full name'), 'Ada Kamara');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('You must agree to continue.')).toBeTruthy();
    expect(calls.some((c) => c.url === '/auth/register')).toBe(false);
  });

  it('registers by email, then goes to the code page', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ phoneSignup: false, handler: () => json(202, { message: 'ok' }) });
    renderAt('/acme-coaches/register');
    await user.type(
      await screen.findByLabelText('Email address / Phone number'),
      'Ada@Example.com',
    );
    await user.type(screen.getByLabelText('Full name'), 'Ada Kamara');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(where()).toContain('/verify-email-code'));
    expect(where()).toBe('/acme-coaches/verify-email-code?email=ada%40example.com');
    expect(calls.find((c) => c.url === '/auth/register')!.body).toMatchObject({
      companySlug: 'acme-coaches',
      email: 'Ada@Example.com',
    });
  });

  it('confirms the email with the mailed code and goes to sign in', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ handler: () => json(200, { message: 'ok' }) });
    renderAt('/verify-email-code?email=ada%40example.com');
    expect(await screen.findByText(/ada@example.com/)).toBeTruthy();
    await user.type(screen.getByLabelText('Code'), 'k7m2xq');
    await user.click(screen.getByRole('button', { name: 'Confirm email' }));
    await waitFor(() => expect(where()).toContain('/login'));
    expect(where()).toContain('verified=1');
    expect(calls.find((c) => c.url === '/auth/verify-email-code')!.body).toEqual({
      email: 'ada@example.com',
      code: 'K7M2XQ',
    });
  });

  it('sends someone whose email is not confirmed yet to the code page', async () => {
    const user = userEvent.setup();
    mockApi({
      handler: (c) =>
        c.url === '/auth/login'
          ? json(403, {
              error: {
                code: 'EMAIL_NOT_VERIFIED',
                message: 'Please verify your email address first',
              },
            })
          : json(202, {}),
    });
    renderAt('/login');
    await user.type(
      await screen.findByLabelText('Email address / Phone number'),
      'ada@example.com',
    );
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(where()).toContain('/verify-email-code'));
    expect(where()).toBe('/verify-email-code?email=ada%40example.com&resend=1');
  });

  it('sends the number as typed, then goes to the code screen with it in international form', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ phoneSignup: true, handler: () => json(202, { message: 'ok' }) });
    renderAt('/acme-coaches/register');
    await screen.findByLabelText('Email address / Phone number');
    await user.type(screen.getByLabelText('Full name'), 'Fanta Jalloh');
    await user.type(screen.getByLabelText('Email address / Phone number'), '076 123 456');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(where()).toContain('/verify-phone'));
    expect(where()).toBe(`/acme-coaches/verify-phone?phone=${encodeURIComponent('+23276123456')}`);
    const sent = calls.find((c) => c.url === '/auth/register-phone')!;
    expect(sent.body).toEqual({
      companySlug: 'acme-coaches',
      displayName: 'Fanta Jalloh',
      phone: '076 123 456',
      password: 'a-long-enough-password',
    });
  });

  it('says what is wrong with a number before sending anything', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ phoneSignup: true });
    renderAt('/acme-coaches/register');
    await screen.findByLabelText('Email address / Phone number');
    await user.type(screen.getByLabelText('Full name'), 'F');
    await user.type(screen.getByLabelText('Email address / Phone number'), '1234');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/Enter a valid phone number/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/auth/register-phone')).toBe(false);
  });
});

describe('Enter the code', () => {
  const url = `/verify-phone?phone=${encodeURIComponent('+23276123456')}`;

  it('shows the number nicely, sends the code, and goes to sign in', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ handler: () => json(200, { message: 'ok' }) });
    renderAt(url);
    expect(await screen.findByText(/\+232 76 123 456/)).toBeTruthy();
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm number' }));
    await waitFor(() => expect(where()).toContain('/login'));
    expect(where()).toContain('verified=1');
    expect(calls.find((c) => c.url === '/auth/verify-phone')!.body).toEqual({
      phone: '+23276123456',
      code: '123456',
    });
  });

  it('refuses a code that is not six digits, and shows the refusal for a wrong one', async () => {
    const user = userEvent.setup();
    mockApi({
      handler: (c) =>
        c.url === '/auth/verify-phone'
          ? json(400, {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'That code is not right, or it has expired',
              },
            })
          : undefined,
    });
    renderAt(url);
    await user.type(await screen.findByLabelText('Code'), '12');
    await user.click(screen.getByRole('button', { name: 'Confirm number' }));
    expect(await screen.findByText(/Enter the 6-digit code from the text message/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Code'));
    await user.type(screen.getByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm number' }));
    expect(await screen.findByText(/not right, or it has expired/)).toBeTruthy();
    expect(where()).toContain('/verify-phone'); // stays here
  });

  it('makes people wait a minute between texts, then lets them ask again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi({ handler: () => json(202, { message: 'ok' }) });
    renderAt(url);
    const button = await screen.findByRole('button', { name: new RegExp(`in ${RESEND_SECONDS}s`) });
    expect(button).toBeDisabled();
    // One second at a time: each tick re-renders and schedules the next.
    for (let i = 0; i < RESEND_SECONDS + 1; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    const again = screen.getByRole('button', { name: 'Send a new code' });
    expect(again).toBeEnabled();
    await act(async () => again.click());
    await waitFor(() => expect(calls.some((c) => c.url === '/auth/resend-phone-code')).toBe(true));
    expect(calls.find((c) => c.url === '/auth/resend-phone-code')!.body).toEqual({
      phone: '+23276123456',
    });
  });

  it('asks for a fresh code straight away when sent here from sign in', async () => {
    const calls = mockApi({ handler: () => json(202, { message: 'ok' }) });
    renderAt(`${url}&resend=1`);
    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/auth/resend-phone-code')).toHaveLength(1),
    );
  });

  it('does not work without a real number in the address', async () => {
    mockApi({});
    renderAt('/verify-phone?phone=nonsense');
    expect(await screen.findByText(/needs your phone number/)).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });
});

describe('Sign in with a phone number', () => {
  it('signs in with the number and goes to the dashboard', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      phoneSignup: true,
      handler: (c) => (c.url === '/auth/login' ? json(200, { userId: 'u1' }) : undefined),
    });
    renderAt('/login');
    await screen.findByLabelText('Email address / Phone number');
    await user.type(screen.getByLabelText('Email address / Phone number'), '+232 76 123 456');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/auth/login')).toBe(true));
    expect(calls.find((c) => c.url === '/auth/login')!.body).toEqual({
      phone: '+23276123456',
      password: 'a-long-enough-password',
    });
  });

  it('sends someone whose number is not confirmed yet to get a code', async () => {
    const user = userEvent.setup();
    mockApi({
      phoneSignup: true,
      handler: (c) =>
        c.url === '/auth/login'
          ? json(403, {
              error: {
                code: 'PHONE_NOT_VERIFIED',
                message: 'Please verify your phone number first',
              },
            })
          : json(202, {}),
    });
    renderAt('/login');
    await screen.findByLabelText('Email address / Phone number');
    await user.type(screen.getByLabelText('Email address / Phone number'), '076123456');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(where()).toContain('/verify-phone'));
    expect(where()).toBe(`/verify-phone?phone=${encodeURIComponent('+23276123456')}&resend=1`);
  });

  it('opens with the number filled in, after confirming the number', async () => {
    mockApi({ phoneSignup: true });
    renderAt(`/login?phone=${encodeURIComponent('+23276123456')}&verified=1`);
    expect(await screen.findByText(/Your account is confirmed/)).toBeTruthy();
    expect(await screen.findByLabelText('Email address / Phone number')).toHaveValue(
      '+23276123456',
    );
  });
});

describe('Forgotten password by phone', () => {
  it('texts a code, then sets a new password with it', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ phoneSignup: true, handler: () => json(200, { message: 'ok' }) });
    renderAt('/forgot-password');
    await screen.findByLabelText('Email address / Phone number');
    await user.type(screen.getByLabelText('Email address / Phone number'), '076123456');
    await user.click(screen.getByRole('button', { name: 'Send reset link or code' }));
    await waitFor(() => expect(where()).toContain('/reset-password-phone'));
    await user.type(await screen.findByLabelText('Code'), '246810');
    await user.type(screen.getByLabelText('New password'), 'brand-new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-password-1');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(where()).toContain('/login'));
    expect(where()).toContain('reset=1');
    expect(calls.find((c) => c.url === '/auth/forgot-password-phone')!.body).toEqual({
      phone: '076123456',
    });
    expect(calls.find((c) => c.url === '/auth/reset-password-phone')!.body).toEqual({
      phone: '+23276123456',
      code: '246810',
      password: 'brand-new-password-1',
    });
  });
});
