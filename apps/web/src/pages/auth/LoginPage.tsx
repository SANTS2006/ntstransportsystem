import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { normalizePhone } from '@nts/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { GoogleButton } from '../../components/GoogleButton';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, PasswordField } from '../../components/ui/Field';
import { ApiError, api, safeNext } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import { checkIdentifier, identifierKind } from '../../lib/identifier';
import { mfaCodeSchema, recoveryCodeSchema } from '../../lib/schemas';

type LoginResponse = { userId: string } | { mfaRequired: true; challengeToken: string };

/** Divider with a word in the middle, between Google and the form. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      or
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const { slug } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [challenge, setChallenge] = useState<string | null>(null);
  const { phoneSignup } = useFeatures();
  // Coming back from verifying or resetting by phone: the number is filled in.
  const [identifier, setIdentifier] = useState(params.get('phone') ?? params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ id?: string; pw?: string }>({});
  const next = safeNext(params.get('next'));

  const finish = async (res: LoginResponse) => {
    if ('mfaRequired' in res) {
      setChallenge(res.challengeToken);
      return;
    }
    await refresh();
    void navigate(next, { replace: true });
  };

  const login = useMutation({
    mutationFn: (v: { identifier: string; password: string }) => {
      const id = v.identifier.trim();
      const body =
        identifierKind(id) === 'email'
          ? { email: id, password: v.password, ...(slug ? { companySlug: slug } : {}) }
          : {
              phone: normalizePhone(id) ?? id,
              password: v.password,
              ...(slug ? { companySlug: slug } : {}),
            };
      return api<LoginResponse>('/auth/login', { method: 'POST', body });
    },
    onSuccess: finish,
    onError: (e, v) => {
      // The number is right but was never confirmed: go and get a code.
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') {
        void navigate(
          `/verify-email-code?email=${encodeURIComponent(v.identifier.trim())}&resend=1`,
        );
      }
      if (e instanceof ApiError && e.code === 'PHONE_NOT_VERIFIED') {
        const n = normalizePhone(v.identifier);
        if (n) void navigate(`/verify-phone?phone=${encodeURIComponent(n)}&resend=1`);
      }
    },
  });
  const google = useMutation({
    mutationFn: (credential: string) =>
      api<LoginResponse>('/auth/google', {
        method: 'POST',
        body: { credential, ...(slug ? { companySlug: slug } : {}) },
      }),
    onSuccess: finish,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = checkIdentifier(identifier, phoneSignup);
    const pw = password ? undefined : 'Enter your password';
    setFieldError({ ...(id ? { id } : {}), ...(pw ? { pw } : {}) });
    if (!id && !pw && !login.isPending) login.mutate({ identifier, password });
  };

  if (login.error instanceof ApiError && login.error.status === 429) {
    return (
      <AuthCard title="Account temporarily locked">
        <div className="flex flex-col items-center gap-3 rounded-xl bg-amber-50 p-6 text-center dark:bg-slate-800">
          <LockKeyhole aria-hidden="true" className="size-10 text-accent-600" strokeWidth={1.6} />
          <p className="text-sm text-slate-700 dark:text-slate-300">
            There have been too many sign-in attempts. To keep your account safe, sign-in is paused
            for a few minutes. Try again shortly, or reset your password if you have forgotten it.
          </p>
        </div>
        <Button className="w-full" onClick={() => login.reset()}>
          Back to sign in
        </Button>
        <Link
          className="block text-center text-sm font-semibold text-brand-600"
          to="/forgot-password"
        >
          Reset my password
        </Link>
      </AuthCard>
    );
  }
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
    <AuthCard
      title={slug ? 'Sign In' : 'Login'}
      {...(slug ? { subtitle: 'Enter your details to access your account.' } : {})}
    >
      {params.get('reset') && <Alert tone="success">Password updated. Please sign in.</Alert>}
      {params.get('verified') && (
        <Alert tone="success">Your account is confirmed. Please sign in.</Alert>
      )}
      {(login.error ?? google.error) && <ErrorAlert error={login.error ?? google.error} />}
      <form noValidate onSubmit={submit} className="space-y-4">
        <Field
          label="Email address / Phone number"
          icon={Mail}
          autoComplete="username"
          inputMode="text"
          placeholder="Enter your email or phone number"
          error={fieldError.id}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          error={fieldError.pw}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end text-sm">
          <Link className="font-medium text-brand-600" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <Button
          type="submit"
          className="w-full min-h-12 text-base"
          loading={login.isPending}
          loadingText="Signing in…"
        >
          Sign In
          <ArrowRight aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </Button>
      </form>
      {slug && (
        <>
          <p className="text-center text-sm text-slate-800 dark:text-slate-200">
            Don&apos;t have an account?{' '}
            <Link className="font-semibold text-brand-600" to={`/${slug}/register`}>
              Create an account
            </Link>
          </p>
        </>
      )}
      <OrDivider />
      <GoogleButton text="signin_with" onCredential={(c) => google.mutate(c)} />
    </AuthCard>
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
          className="text-brand-700 font-medium dark:text-brand-500"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <button
          type="button"
          className="text-slate-600 font-medium dark:text-slate-300"
          onClick={onCancel}
        >
          Back
        </button>
      </div>
    </AuthCard>
  );
}
