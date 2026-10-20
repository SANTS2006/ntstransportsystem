import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { GoogleButton, googleEnabled } from '../../components/GoogleButton';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { api, safeNext } from '../../lib/api';
import {
  loginSchema,
  mfaCodeSchema,
  recoveryCodeSchema,
  type LoginValues,
} from '../../lib/schemas';

type LoginResponse = { userId: string } | { mfaRequired: true; challengeToken: string };

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [challenge, setChallenge] = useState<string | null>(null);
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
      {(password.error ?? google.error) && <ErrorAlert error={password.error ?? google.error} />}
      <PasswordForm onSubmit={(v) => password.mutate(v)} pending={password.isPending} />
      {googleEnabled && (
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
