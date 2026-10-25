import { zodResolver } from '@hookform/resolvers/zod';
import { useAuthBase } from '../../lib/company-page';
import { useMutation } from '@tanstack/react-query';
import { normalizePhone } from '@nts/shared';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Mail } from 'lucide-react';
import { Field, PasswordField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { ResendCode } from './PhonePages';
import { useFeatures } from '../../lib/features';
import { checkIdentifier, identifierKind } from '../../lib/identifier';
import { resetSchema, type ResetValues } from '../../lib/schemas';

const linkClass = 'text-sm text-brand-700 font-medium dark:text-brand-500';

/**
 * The token is consumed only when the user presses the button (a POST). Auto-submitting on load
 * would let mail-scanner prefetches or React's double-invoked effects burn a single-use link.
 */
export function VerifyEmailPage() {
  const base = useAuthBase();
  const token = useSearchParams()[0].get('token');
  const verify = useMutation({
    mutationFn: () => api('/auth/verify-email', { method: 'POST', body: { token } }),
  });
  if (!token) {
    return (
      <AuthCard title="Confirm email">
        <Alert tone="error">
          This confirmation link is incomplete. Open the link from your email again.
        </Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Confirm your email">
      {verify.isSuccess ? (
        <>
          <Alert tone="success">Your email is confirmed.</Alert>
          <Link className={linkClass} to={`${base}/login`}>
            Continue to sign in
          </Link>
        </>
      ) : (
        <>
          {verify.error && <ErrorAlert error={verify.error} />}
          <Button
            className="w-full"
            loading={verify.isPending}
            loadingText="Confirming…"
            onClick={() => verify.mutate()}
          >
            Confirm email address
          </Button>
        </>
      )}
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const base = useAuthBase();
  const navigate = useNavigate();
  const { phoneSignup } = useFeatures();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | undefined>();
  const send = useMutation({
    mutationFn: (raw: string) => {
      const id = raw.trim();
      return identifierKind(id) === 'email'
        ? api('/auth/forgot-password', {
            method: 'POST',
            body: { email: id, ...(base ? { companySlug: base.slice(1) } : {}) },
          })
        : api('/auth/forgot-password-phone', { method: 'POST', body: { phone: id } });
    },
    onSuccess: (_r, raw) => {
      const id = raw.trim();
      if (identifierKind(id) === 'phone') {
        void navigate(
          `${base}/reset-password-phone?phone=${encodeURIComponent(normalizePhone(id) ?? id)}`,
        );
      }
    },
  });
  if (send.isSuccess && identifierKind(identifier) === 'email') {
    return (
      <AuthCard title="Check your email">
        <Alert tone="success">
          If an account exists for that address, a reset link is on its way. It expires in 30
          minutes.
        </Alert>
        <Link className={linkClass} to={`${base}/login`}>
          Back to sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Reset your password"
      subtitle={
        phoneSignup
          ? 'Enter your email or phone number and we will send a link or a code.'
          : 'Enter your email and we will send a link.'
      }
    >
      {send.error && <ErrorAlert error={send.error} />}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const problem = checkIdentifier(identifier, phoneSignup);
          setError(problem ?? undefined);
          if (!problem && !send.isPending) send.mutate(identifier);
        }}
        className="space-y-4"
      >
        <Field
          label="Email address / Phone number"
          icon={Mail}
          autoComplete="username"
          placeholder="Enter your email or phone number"
          error={error}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={send.isPending} loadingText="Sending…">
          {phoneSignup ? 'Send reset link or code' : 'Send reset link'}
        </Button>
      </form>
      <Link className={linkClass} to={`${base}/login`}>
        Back to sign in
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const base = useAuthBase();
  const token = useSearchParams()[0].get('token');
  const navigate = useNavigate();
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (v: ResetValues) =>
      api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } }),
    onSuccess: () => void navigate(`${base}/login?reset=1`, { replace: true }),
  });
  const { errors } = form.formState;
  if (!token) {
    return (
      <AuthCard title="Reset password">
        <Alert tone="error">This reset link is incomplete. Request a new one.</Alert>
        <Link className={linkClass} to={`${base}/forgot-password`}>
          Request a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="All your other sessions will be signed out.">
      {reset.error && <ErrorAlert error={reset.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => reset.mutate(v))} className="space-y-4">
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint="At least 12 characters."
          error={errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" className="w-full" loading={reset.isPending} loadingText="Updating…">
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}

/** Rendered inside RequireAuth: acceptance needs a signed-in, verified account matching the invite. */
export function AcceptInvitationPage() {
  const token = useSearchParams()[0].get('token');
  const accept = useMutation({
    mutationFn: () =>
      api<{ tenantId: string; name: string }>('/invitations/accept', {
        method: 'POST',
        body: { token },
      }),
  });
  if (!token) {
    return (
      <AuthCard title="Invitation">
        <Alert tone="error">This invitation link is incomplete.</Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Join a company"
      subtitle="Accept this invitation with the account it was sent to."
    >
      {accept.isSuccess ? (
        <>
          <Alert tone="success">You have joined {accept.data.name}.</Alert>
          <Link className={linkClass} to={`/c/${accept.data.tenantId}`}>
            Open company workspace
          </Link>
        </>
      ) : (
        <>
          {accept.error && <ErrorAlert error={accept.error} />}
          <Button
            className="w-full"
            loading={accept.isPending}
            loadingText="Accepting…"
            onClick={() => accept.mutate()}
          >
            Accept invitation
          </Button>
        </>
      )}
    </AuthCard>
  );
}

const emailCodeShape = /^[A-Za-z0-9]{6}$/;

/** Step two of signing up with an email address: type the 6-character code that was mailed. */
export function VerifyEmailCodePage() {
  const base = useAuthBase();
  const [params] = useSearchParams();
  const email = params.get('email')?.trim().toLowerCase() ?? '';
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const verify = useMutation({
    mutationFn: () =>
      api('/auth/verify-email-code', { method: 'POST', body: { email, code: code.trim() } }),
    onSuccess: () =>
      void navigate(`${base}/login?email=${encodeURIComponent(email)}&verified=1`, {
        replace: true,
      }),
  });
  // Sent here from a sign-in that needs a code: ask for one straight away, once.
  const asked = useRef(false);
  const autoResend = useMutation({
    mutationFn: () => api('/auth/resend-email-code', { method: 'POST', body: { email } }),
  });
  const wantsResend = params.get('resend') === '1';
  useEffect(() => {
    if (email && wantsResend && !asked.current) {
      asked.current = true;
      autoResend.mutate();
    }
  }, [email, wantsResend, autoResend]);

  if (!email.includes('@')) {
    return (
      <AuthCard title="Confirm your email">
        <Alert tone="error">This page needs your email address. Please start again.</Alert>
        <Link className={linkClass} to={base ? `${base}/register` : '/login'}>
          Create an account
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Enter your code"
      subtitle={`We emailed a 6-character code to ${email}. It expires in 10 minutes.`}
    >
      {verify.error && <ErrorAlert error={verify.error} />}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!emailCodeShape.test(code.trim())) {
            setProblem('Enter the 6-character code from the email');
            return;
          }
          setProblem(undefined);
          if (!verify.isPending) verify.mutate();
        }}
        className="space-y-4"
      >
        <Field
          label="Code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={6}
          placeholder="ABC123"
          className="font-mono uppercase tracking-[0.4em]"
          error={problem}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button type="submit" className="w-full" loading={verify.isPending} loadingText="Checking…">
          Confirm email
        </Button>
      </form>
      <ResendCode path="/auth/resend-email-code" body={{ email }} startNow />
      <div className="flex justify-between">
        <Link className={linkClass} to={base ? `${base}/register` : '/login'}>
          Use a different email
        </Link>
        <Link className={linkClass} to={`${base}/login`}>
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
