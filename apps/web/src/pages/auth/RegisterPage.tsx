import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Mail, User } from 'lucide-react';
import { normalizePhone } from '@nts/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { GoogleButton, googleEnabled } from '../../components/GoogleButton';
import { AuthCard, AuthNotice } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, PasswordField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import { PHONE_HINT, checkIdentifier, identifierKind } from '../../lib/identifier';
import { registerSchema } from '../../lib/schemas';
import { OrDivider } from './LoginPage';

interface Values {
  displayName: string;
  identifier: string;
  password: string;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { phoneSignup } = useFeatures();
  const [v, setV] = useState<Values>({ displayName: '', identifier: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});

  const register = useMutation({
    mutationFn: (x: Values) => {
      const id = x.identifier.trim();
      if (identifierKind(id) === 'email') {
        return api('/auth/register', {
          method: 'POST',
          body: { displayName: x.displayName, email: id, password: x.password },
        });
      }
      return api('/auth/register-phone', {
        method: 'POST',
        body: { displayName: x.displayName, phone: id, password: x.password },
      });
    },
    onSuccess: (_r, x) => {
      const id = x.identifier.trim();
      if (identifierKind(id) === 'phone') {
        void navigate(`/verify-phone?phone=${encodeURIComponent(normalizePhone(id) ?? id)}`);
      }
    },
  });
  const google = useMutation({
    mutationFn: (credential: string) =>
      api<{ userId?: string; mfaRequired?: boolean }>('/auth/google', {
        method: 'POST',
        body: { credential },
      }),
    onSuccess: async (res) => {
      if (res.mfaRequired) return void navigate('/login');
      await refresh();
      void navigate('/app', { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = registerSchema.shape.displayName.safeParse(v.displayName);
    const pw = registerSchema.shape.password.safeParse(v.password);
    const next: Partial<Record<keyof Values, string>> = {};
    if (!name.success) next.displayName = name.error.issues[0]?.message ?? 'Enter your name';
    const idError = checkIdentifier(v.identifier, phoneSignup);
    if (idError) next.identifier = idError;
    if (!pw.success) next.password = pw.error.issues[0]?.message ?? 'Choose a stronger password';
    setErrors(next);
    if (Object.keys(next).length === 0 && !register.isPending) register.mutate(v);
  };

  // The server answers identically whether or not the address is already registered.
  if (register.isSuccess && identifierKind(v.identifier) === 'email') {
    return (
      <AuthCard title="Check your email">
        <Alert tone="success">
          If that address can be registered, we have sent a confirmation link. It expires in 24
          hours.
        </Alert>
        <Link className="text-sm font-semibold text-brand-600" to="/login">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Create an account"
      subtitle="Book trips, or join the company that invited you."
    >
      {(register.error ?? google.error) && <ErrorAlert error={register.error ?? google.error} />}
      {googleEnabled && (
        <>
          <GoogleButton text="signup_with" onCredential={(c) => google.mutate(c)} />
          <OrDivider />
        </>
      )}
      <form noValidate onSubmit={submit} className="space-y-4">
        <Field
          label="Full name"
          icon={User}
          autoComplete="name"
          error={errors.displayName}
          value={v.displayName}
          onChange={(e) => setV({ ...v, displayName: e.target.value })}
        />
        <Field
          label={phoneSignup ? 'Email or phone number' : 'Email address'}
          icon={Mail}
          autoComplete="username"
          inputMode={phoneSignup ? 'text' : 'email'}
          placeholder={phoneSignup ? 'you@example.com or 076 123 456' : 'you@example.com'}
          hint={phoneSignup ? PHONE_HINT : undefined}
          error={errors.identifier}
          value={v.identifier}
          onChange={(e) => setV({ ...v, identifier: e.target.value })}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint="At least 12 characters. A passphrase works well."
          error={errors.password}
          value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })}
        />
        <Button
          type="submit"
          className="min-h-12 w-full text-base"
          loading={register.isPending}
          loadingText="Creating account…"
        >
          Create account
          <ArrowRight aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </Button>
      </form>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Already registered?{' '}
        <Link className="font-semibold text-brand-600" to="/login">
          Sign in
        </Link>
      </p>
      <AuthNotice title="Joining a transport company?">
        Companies are registered by the NTS team. Ask your company owner to invite your email, then
        create your account with that same address.
      </AuthNotice>
    </AuthCard>
  );
}
