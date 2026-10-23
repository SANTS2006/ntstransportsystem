import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { normalizePhone } from '@nts/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { GoogleButton, googleEnabled } from '../../components/GoogleButton';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { MethodTabs, PHONE_HINT, type Method } from '../../components/auth/MethodTabs';
import { ApiError, api, safeNext } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import {
  loginSchema,
  mfaCodeSchema,
  phoneLoginSchema,
  recoveryCodeSchema,
  type LoginValues,
  type PhoneLoginValues,
} from '../../lib/schemas';

type LoginResponse = { userId: string } | { mfaRequired: true; challengeToken: string };

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [challenge, setChallenge] = useState<string | null>(null);
  const { phoneSignup } = useFeatures();
  const [chosen, setChosen] = useState<Method | null>(null);
  // Coming back from verifying or resetting by phone: start on the phone tab with the number filled in.
  const cameByPhone = params.get('phone') !== null;
  const method: Method =
    phoneSignup && (chosen ?? (cameByPhone ? 'phone' : 'email')) === 'phone' ? 'phone' : 'email';
  const next = safeNext(params.get('next'));

  const finish = async (res: LoginResponse) => {
    if ('mfaRequired' in res) {
      setChallenge(res.challengeToken);
      return;
    }
    await refresh();
    void navigate(next, { replace: true });
  };

  const password = useMutation({
    mutationFn: (v: LoginValues) => api<LoginResponse>('/auth/login', { method: 'POST', body: v }),
    onSuccess: finish,
  });
  const byPhone = useMutation({
    mutationFn: (v: PhoneLoginValues) =>
      api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { phone: normalizePhone(v.phone) ?? v.phone, password: v.password },
      }),
    onSuccess: finish,
    onError: (e, v) => {
      // The number is right but was never confirmed: go and get a code.
      if (e instanceof ApiError && e.code === 'PHONE_NOT_VERIFIED') {
        const n = normalizePhone(v.phone);
        if (n) void navigate(`/verify-phone?phone=${encodeURIComponent(n)}&resend=1`);
      }
    },
  });
  const google = useMutation({
    mutationFn: (credential: string) =>
      api<LoginResponse>('/auth/google', { method: 'POST', body: { credential } }),
    onSuccess: finish,
  });

  if (challenge) {
    return (
      <MfaStep
        challengeToken={challenge}
        onDone={() => finish({ userId: '' })}
        onCancel={() => setChallenge(null)}
      />
    );
  }
  return (
    <AuthCard title="Sign in" subtitle="Welcome back.">
      {params.get('reset') && <Alert tone="success">Password updated. Please sign in.</Alert>}
      {params.get('verified') && (
        <Alert tone="success">Phone number confirmed. Please sign in.</Alert>
      )}
      {phoneSignup && <MethodTabs label="Sign in with" value={method} onChange={setChosen} />}
      {method === 'phone' ? (
        <>
          {(byPhone.error ?? google.error) && <ErrorAlert error={byPhone.error ?? google.error} />}
          <PhonePasswordForm
            initialPhone={params.get('phone') ?? ''}
            onSubmit={(v) => byPhone.mutate(v)}
            pending={byPhone.isPending}
          />
        </>
      ) : (
        <>
          {(password.error ?? google.error) && (
            <ErrorAlert error={password.error ?? google.error} />
          )}
          <PasswordForm onSubmit={(v) => password.mutate(v)} pending={password.isPending} />
        </>
      )}
      {googleEnabled && method === 'email' && (
        <>
          <p className="text-center text-xs text-slate-500">or</p>
          <GoogleButton text="signin_with" onCredential={(c) => google.mutate(c)} />
        </>
      )}
      <div className="flex justify-between text-sm">
        <Link className="text-brand-700 underline dark:text-brand-500" to="/forgot-password">
          Forgot password?
        </Link>
        <Link className="text-brand-700 underline dark:text-brand-500" to="/register">
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}

function PhonePasswordForm({
  initialPhone,
  onSubmit,
  pending,
}: {
  initialPhone: string;
  onSubmit: (v: PhoneLoginValues) => void;
  pending: boolean;
}) {
  const form = useForm<PhoneLoginValues>({
    resolver: zodResolver(phoneLoginSchema),
    defaultValues: { phone: initialPhone, password: '' },
  });
  const { errors } = form.formState;
  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Field
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="username"
        hint={PHONE_HINT}
        error={errors.phone?.message}
        {...form.register('phone')}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" className="w-full" loading={pending} loadingText="Signing in…">
        Sign in
      </Button>
    </form>
  );
}

function PasswordForm({
  onSubmit,
  pending,
}: {
  onSubmit: (v: LoginValues) => void;
  pending: boolean;
}) {
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;
  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Field
        label="Email"
        type="email"
        autoComplete="username"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" className="w-full" loading={pending} loadingText="Signing in…">
        Sign in
      </Button>
    </form>
  );
}

function MfaStep({
  challengeToken,
  onDone,
  onCancel,
}: {
  challengeToken: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const verify = useMutation({
    mutationFn: (body: { code?: string; recoveryCode?: string }) =>
      api<{ userId: string }>('/auth/mfa/verify', {
        method: 'POST',
        body: { challengeToken, ...body },
      }),
    onSuccess: () => onDone(),
  });
  const codeForm = useForm<{ code: string }>({
    resolver: zodResolver(mfaCodeSchema),
    defaultValues: { code: '' },
  });
  const recForm = useForm<{ recoveryCode: string }>({
    resolver: zodResolver(recoveryCodeSchema),
    defaultValues: { recoveryCode: '' },
  });

  return (
    <AuthCard
      title="Two-step verification"
      subtitle={
        useRecovery
          ? 'Enter one of your recovery codes.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      {verify.error && <ErrorAlert error={verify.error} />}
      {useRecovery ? (
        <form
          noValidate
          onSubmit={recForm.handleSubmit((v) => verify.mutate(v))}
          className="space-y-4"
        >
          <Field
            label="Recovery code"
            autoComplete="off"
            error={recForm.formState.errors.recoveryCode?.message}
            {...recForm.register('recoveryCode')}
          />
          <Button
            type="submit"
            className="w-full"
            loading={verify.isPending}
            loadingText="Verifying…"
          >
            Verify
          </Button>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={codeForm.handleSubmit((v) => verify.mutate(v))}
          className="space-y-4"
        >
          <Field
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={codeForm.formState.errors.code?.message}
            {...codeForm.register('code')}
          />
          <Button
            type="submit"
            className="w-full"
            loading={verify.isPending}
            loadingText="Verifying…"
          >
            Verify
          </Button>
        </form>
      )}
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-brand-700 underline dark:text-brand-500"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <button
          type="button"
          className="text-slate-600 underline dark:text-slate-300"
          onClick={onCancel}
        >
          Back
        </button>
      </div>
    </AuthCard>
  );
}
