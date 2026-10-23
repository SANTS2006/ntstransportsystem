import { zodResolver } from '@hookform/resolvers/zod';
import { formatPhone, normalizePhone } from '@nts/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { resetPhoneSchema, verifyCodeSchema, type ResetPhoneValues } from '../../lib/schemas';

const linkClass = 'text-sm text-brand-700 font-medium dark:text-brand-500';
export const RESEND_SECONDS = 60;

/** The number in the address bar, only if it really is one (otherwise the page asks to start over). */
function useNumber(): string | null {
  const raw = useSearchParams()[0].get('phone');
  return raw ? normalizePhone(raw) : null;
}

/** A "send again" button that waits a minute between texts, matching what the server allows. */
function ResendCode({ phone, startNow }: { phone: string; startNow: boolean }) {
  const [wait, setWait] = useState(startNow ? RESEND_SECONDS : 0);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);
  const resend = useMutation({
    mutationFn: () => api('/auth/resend-phone-code', { method: 'POST', body: { phone } }),
    onSuccess: () => {
      setWait(RESEND_SECONDS);
      setNote('If the number is waiting to be verified, a new code is on its way.');
    },
  });
  return (
    <div className="space-y-1 text-sm">
      <button
        type="button"
        className={`${linkClass} disabled:text-slate-500`}
        disabled={wait > 0 || resend.isPending}
        onClick={() => resend.mutate()}
      >
        {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
      </button>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      {resend.error && <ErrorAlert error={resend.error} />}
    </div>
  );
}

/** Step two of signing up with a phone number: type the code from the text message. */
export function VerifyPhonePage() {
  const phone = useNumber();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const form = useForm<{ code: string }>({
    resolver: zodResolver(verifyCodeSchema),
    defaultValues: { code: '' },
  });
  const verify = useMutation({
    mutationFn: (v: { code: string }) =>
      api('/auth/verify-phone', { method: 'POST', body: { phone, code: v.code } }),
    onSuccess: () =>
      void navigate(`/login?phone=${encodeURIComponent(phone as string)}&verified=1`, {
        replace: true,
      }),
  });
  // Coming back from a sign-in that needs a code: ask for one straight away, once.
  const asked = useRef(false);
  const autoResend = useMutation({
    mutationFn: () => api('/auth/resend-phone-code', { method: 'POST', body: { phone } }),
  });
  const wantsResend = params.get('resend') === '1';
  useEffect(() => {
    if (phone && wantsResend && !asked.current) {
      asked.current = true;
      autoResend.mutate();
    }
  }, [phone, wantsResend, autoResend]);

  if (!phone) {
    return (
      <AuthCard title="Confirm your phone number">
        <Alert tone="error">This page needs your phone number. Please start again.</Alert>
        <Link className={linkClass} to="/register">
          Create an account
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Enter your code"
      subtitle={`We texted a 6-digit code to ${formatPhone(phone)}. It expires in 10 minutes.`}
    >
      {verify.error && <ErrorAlert error={verify.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => verify.mutate(v))} className="space-y-4">
        <Field
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={form.formState.errors.code?.message}
          {...form.register('code')}
        />
        <Button type="submit" className="w-full" loading={verify.isPending} loadingText="Checking…">
          Confirm number
        </Button>
      </form>
      <ResendCode phone={phone} startNow />
      <div className="flex justify-between">
        <Link className={linkClass} to="/register">
          Use a different number
        </Link>
        <Link className={linkClass} to="/login">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}

/** Choose a new password with the code from a text message. */
export function ResetPhonePasswordPage() {
  const phone = useNumber();
  const navigate = useNavigate();
  const form = useForm<ResetPhoneValues>({
    resolver: zodResolver(resetPhoneSchema),
    defaultValues: { code: '', password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (v: ResetPhoneValues) =>
      api('/auth/reset-password-phone', {
        method: 'POST',
        body: { phone, code: v.code, password: v.password },
      }),
    onSuccess: () =>
      void navigate(`/login?phone=${encodeURIComponent(phone as string)}&reset=1`, {
        replace: true,
      }),
  });
  const { errors } = form.formState;
  if (!phone) {
    return (
      <AuthCard title="Reset password">
        <Alert tone="error">This page needs your phone number. Please start again.</Alert>
        <Link className={linkClass} to="/forgot-password">
          Reset my password
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Choose a new password"
      subtitle={`Enter the code we texted to ${formatPhone(phone)}. All your other sessions will be signed out.`}
    >
      {reset.error && <ErrorAlert error={reset.error} />}
      <form noValidate onSubmit={form.handleSubmit((v) => reset.mutate(v))} className="space-y-4">
        <Field
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={errors.code?.message}
          {...form.register('code')}
        />
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
        <Button type="submit" className="w-full" loading={reset.isPending} loadingText="Saving…">
          Save password
        </Button>
      </form>
      <Link className={linkClass} to="/forgot-password">
        Send a new code
      </Link>
    </AuthCard>
  );
}
