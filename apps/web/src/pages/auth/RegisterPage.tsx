import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Mail, User } from 'lucide-react';
import { normalizePhone } from '@nts/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { GoogleButton } from '../../components/GoogleButton';
import { AuthCard } from '../../components/layout/Layouts';
import { ErrorAlert } from '../../components/ui/Alert';
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
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState<string | undefined>();
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
      void navigate(
        identifierKind(id) === 'phone'
          ? `/verify-phone?phone=${encodeURIComponent(normalizePhone(id) ?? id)}`
          : `/verify-email-code?email=${encodeURIComponent(id.toLowerCase())}`,
      );
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
    if (!agreed) setAgreeError('You must agree to continue.');
    if (Object.keys(next).length === 0 && agreed && !register.isPending) register.mutate(v);
  };

  return (
    <AuthCard
      title="Create an account"
      subtitle="Book trips, or join the company that invited you."
    >
      {(register.error ?? google.error) && <ErrorAlert error={register.error ?? google.error} />}
      <GoogleButton
        text="signup_with"
        onCredential={(c) => {
          if (!agreed) {
            setAgreeError('Tick the box to agree before creating an account.');
            return;
          }
          google.mutate(c);
        }}
      />
      <OrDivider />
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
          label="Email address / Phone number"
          icon={Mail}
          autoComplete="username"
          inputMode="text"
          placeholder="you@example.com or 076 123 456"
          hint={PHONE_HINT}
          error={errors.identifier}
          value={v.identifier}
          onChange={(e) => setV({ ...v, identifier: e.target.value })}
        />
        <PasswordField
          label="Password"
          placeholder="Enter your password"
          autoComplete="new-password"
          hint="At least 12 characters. A passphrase works well."
          error={errors.password}
          value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })}
        />
        <div>
          <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={agreed}
              aria-describedby={agreeError ? 'agree-err' : undefined}
              onChange={(e) => {
                setAgreed(e.target.checked);
                if (e.target.checked) setAgreeError(undefined);
              }}
              className="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-brand-600"
            />
            <span>I have read and agree to the NTS Transport terms of use and privacy policy.</span>
          </label>
          {agreeError && (
            <p id="agree-err" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {agreeError}
            </p>
          )}
        </div>
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
    </AuthCard>
  );
}
