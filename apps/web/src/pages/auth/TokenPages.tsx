import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { normalizePhone } from '@nts/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { MethodTabs, PHONE_HINT, type Method } from '../../components/auth/MethodTabs';
import { api } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import { forgotPhoneSchema, forgotSchema, resetSchema, type ResetValues } from '../../lib/schemas';

const linkClass = 'text-sm text-brand-700 underline dark:text-brand-500';

/**
 * The token is consumed only when the user presses the button (a POST). Auto-submitting on load
 * would let mail-scanner prefetches or React's double-invoked effects burn a single-use link.
 */
export function VerifyEmailPage() {
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
          <Link className={linkClass} to="/login">
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

/** Ask for a password-reset code by text message. */
function PhoneForgotForm({ tabs }: { tabs: React.ReactNode }) {
  const navigate = useNavigate();
  const form = useForm<{ phone: string }>({
    resolver: zodResolver(forgotPhoneSchema),
    defaultValues: { phone: '' },
  });
  const send = useMutation({
    mutationFn: (v: { phone: string }) =>
      api('/auth/forgot-password-phone', { method: 'POST', body: v }),
    onSuccess: (_r, v) =>
      void navigate(
        `/reset-password-phone?phone=${encodeURIComponent(normalizePhone(v.phone) ?? v.phone)}`,
      ),
  });
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your phone number and we will text you a code."
    >
      {tabs}
      {send.error && <ErrorAlert error={send.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => send.mutate(v))} className="space-y-4">
        <Field
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          hint={PHONE_HINT}
          error={form.formState.errors.phone?.message}
          {...form.register('phone')}
        />
        <Button type="submit" className="w-full" loading={send.isPending} loadingText="Sending…">
          Text me a code
        </Button>
      </form>
      <Link className={linkClass} to="/login">
        Back to sign in
      </Link>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const { phoneSignup } = useFeatures();
  const [method, setMethod] = useState<Method>('email');
  const tabs = phoneSignup ? (
    <MethodTabs label="Reset with" value={method} onChange={setMethod} />
  ) : null;
  const form = useForm<{ email: string }>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const send = useMutation({
    mutationFn: (v: { email: string }) => api('/auth/forgot-password', { method: 'POST', body: v }),
  });
  if (phoneSignup && method === 'phone') return <PhoneForgotForm tabs={tabs} />;
  if (send.isSuccess) {
    return (
      <AuthCard title="Check your email">
        <Alert tone="success">
          If an account exists for that address, a reset link is on its way. It expires in 30
          minutes.
        </Alert>
        <Link className={linkClass} to="/login">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we will send a link.">
      {tabs}
      {send.error && <ErrorAlert error={send.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => send.mutate(v))} className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" className="w-full" loading={send.isPending} loadingText="Sending…">
          Send reset link
        </Button>
      </form>
      <Link className={linkClass} to="/login">
        Back to sign in
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token');
  const navigate = useNavigate();
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (v: ResetValues) =>
      api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } }),
    onSuccess: () => void navigate('/login?reset=1', { replace: true }),
  });
  const { errors } = form.formState;
  if (!token) {
    return (
      <AuthCard title="Reset password">
        <Alert tone="error">This reset link is incomplete. Request a new one.</Alert>
        <Link className={linkClass} to="/forgot-password">
          Request a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="All your other sessions will be signed out.">
      {reset.error && <ErrorAlert error={reset.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => reset.mutate(v))} className="space-y-4">
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Field
          label="Confirm new password"
          type="password"
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
