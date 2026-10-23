import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { AuthCard } from '../../components/layout/Layouts';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { registerSchema } from '../../lib/schemas';

/** The first sign-in of an account whose password someone else made: choose your own. */
export default function ChangePasswordPage() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const change = useMutation({
    mutationFn: () =>
      api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: async () => {
      await refresh();
      void navigate('/app', { replace: true });
    },
  });
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/app" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!current) found.current = 'Enter the temporary password from your email';
    const rule = registerSchema.shape.password.safeParse(next);
    if (!rule.success) found.next = rule.error.issues[0]?.message ?? 'Choose a stronger password';
    else if (next === current) found.next = 'Choose a password different from the temporary one';
    if (next !== confirm) found.confirm = 'Passwords do not match';
    setErrors(found);
    if (Object.keys(found).length === 0 && !change.isPending) change.mutate();
  };
  return (
    <AuthCard
      title="Choose your password"
      subtitle="You signed in with a temporary password. Choose your own to continue."
    >
      {change.error && <ErrorAlert error={change.error} />}
      <form noValidate onSubmit={submit} className="space-y-4">
        <PasswordField
          label="Temporary password"
          autoComplete="current-password"
          error={errors.current}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint="At least 12 characters. A passphrase works well."
          error={errors.next}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirm}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button
          type="submit"
          className="min-h-12 w-full"
          loading={change.isPending}
          loadingText="Saving…"
        >
          Save and continue
        </Button>
      </form>
    </AuthCard>
  );
}
