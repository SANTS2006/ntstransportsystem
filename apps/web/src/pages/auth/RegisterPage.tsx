import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { normalizePhone } from '@nts/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { GoogleButton, googleEnabled } from '../../components/GoogleButton';
import { AuthCard } from '../../components/layout/Layouts';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { MethodTabs, PHONE_HINT, type Method } from '../../components/auth/MethodTabs';
import { api } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import {
  registerPhoneSchema,
  registerSchema,
  type RegisterPhoneValues,
  type RegisterValues,
} from '../../lib/schemas';

/** Sign up with a phone number: the next step is typing the code that is texted to it. */
function PhoneRegisterForm() {
  const navigate = useNavigate();
  const form = useForm<RegisterPhoneValues>({
    resolver: zodResolver(registerPhoneSchema),
    defaultValues: { displayName: '', phone: '', password: '' },
  });
  const register = useMutation({
    mutationFn: (v: RegisterPhoneValues) =>
      api('/auth/register-phone', { method: 'POST', body: v }),
    onSuccess: (_r, v) =>
      void navigate(
        `/verify-phone?phone=${encodeURIComponent(normalizePhone(v.phone) ?? v.phone)}`,
      ),
  });
  const { errors } = form.formState;
  return (
    <>
      {register.error && <ErrorAlert error={register.error} />}
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => register.mutate(v))}
        className="space-y-4"
      >
        <Field
          label="Full name"
          autoComplete="name"
          error={errors.displayName?.message}
          {...form.register('displayName')}
        />
        <Field
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          hint={PHONE_HINT}
          error={errors.phone?.message}
          {...form.register('phone')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters. A passphrase works well."
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button
          type="submit"
          className="w-full"
          loading={register.isPending}
          loadingText="Sending code…"
        >
          Send me a code
        </Button>
      </form>
    </>
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { phoneSignup } = useFeatures();
  const [method, setMethod] = useState<Method>('email');
  const byPhone = phoneSignup && method === 'phone';
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });
  const register = useMutation({
    mutationFn: (v: RegisterValues) => api('/auth/register', { method: 'POST', body: v }),
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
  const { errors } = form.formState;

  // The server answers identically whether or not the address is already registered.
  if (register.isSuccess) {
    return (
      <AuthCard title="Check your email">
        <Alert tone="success">
          If that address can be registered, we have sent a confirmation link. It expires in 24
          hours.
        </Alert>
        <Link className="text-sm text-brand-700 underline dark:text-brand-500" to="/login">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Create your account"
      subtitle="Book trips, or register your transport company."
    >
      {phoneSignup && <MethodTabs label="Sign up with" value={method} onChange={setMethod} />}
      {byPhone ? (
        <PhoneRegisterForm />
      ) : (
        <>
          {(register.error ?? google.error) && (
            <ErrorAlert error={register.error ?? google.error} />
          )}
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => register.mutate(v))}
            className="space-y-4"
          >
            <Field
              label="Full name"
              autoComplete="name"
              error={errors.displayName?.message}
              {...form.register('displayName')}
            />
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...form.register('email')}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters. A passphrase works well."
              error={errors.password?.message}
              {...form.register('password')}
            />
            <Button
              type="submit"
              className="w-full"
              loading={register.isPending}
              loadingText="Creating account…"
            >
              Create account
            </Button>
          </form>
        </>
      )}
      {googleEnabled && !byPhone && (
        <>
          <p className="text-center text-xs text-slate-500">or</p>
          <GoogleButton text="signup_with" onCredential={(c) => google.mutate(c)} />
        </>
      )}
      <p className="text-sm">
        Already registered?{' '}
        <Link className="text-brand-700 underline dark:text-brand-500" to="/login">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
