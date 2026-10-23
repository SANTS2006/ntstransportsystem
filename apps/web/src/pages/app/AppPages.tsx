import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { ME_KEY, useAuth } from '../../auth/AuthProvider';
import { GoogleButton, googleEnabled } from '../../components/GoogleButton';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { applySchema, mfaCodeSchema, type ApplyValues } from '../../lib/schemas';

interface MyTenant {
  tenantId: string;
  name: string;
  status: string;
  membershipStatus: string;
  role: { key: string; name: string };
}

const PageTitle = ({ children }: { children: string }) => (
  <h1 className="mb-6 text-2xl font-semibold">{children}</h1>
);

export function MyCompaniesPage() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['tenants', 'mine'],
    queryFn: ({ signal }) => api<{ tenants: MyTenant[] }>('/tenants/mine', { signal }),
  });
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle>My companies</PageTitle>
      {q.isPending && <Spinner label="Loading companies" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.tenants.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            You do not belong to a transport company yet. Register yours
            {user?.email ? `, or ask a company owner to invite ${user.email}` : ''}.
          </p>
          <Link
            className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            to="/app/apply"
          >
            Register a company
          </Link>
        </Card>
      )}
      <ul className="space-y-3">
        {q.data?.tenants.map((t) => (
          <li key={t.tenantId}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role.name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={t.status} />
                  <Link
                    className="text-sm font-medium text-brand-700 underline dark:text-brand-500"
                    to={`/c/${t.tenantId}`}
                  >
                    Open
                  </Link>
                </div>
              </div>
              {t.status === 'PENDING' && (
                <p className="mt-3 text-xs text-slate-500">
                  Awaiting platform review. You will be able to operate once approved.
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApplyCompanyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const form = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { name: '', timezone: defaultTz, defaultCurrency: 'SLE' },
  });
  const apply = useMutation({
    mutationFn: (v: ApplyValues) => api<{ id: string }>('/tenants', { method: 'POST', body: v }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['tenants'] });
      void navigate(`/c/${res.id}`);
    },
  });
  const { errors } = form.formState;
  return (
    <div className="mx-auto max-w-xl">
      <PageTitle>Register a company</PageTitle>
      <Card>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Your application is reviewed by the platform team before the company goes live. You become
          its owner.
        </p>
        {apply.error && <ErrorAlert error={apply.error} />}
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => apply.mutate(v))}
          className="mt-4 space-y-4"
        >
          <Field label="Company name" error={errors.name?.message} {...form.register('name')} />
          <Field
            label="Timezone"
            hint="IANA name, e.g. Africa/Freetown"
            error={errors.timezone?.message}
            {...form.register('timezone')}
          />
          <Field
            label="Currency"
            maxLength={3}
            hint="3-letter code, e.g. SLE"
            error={errors.defaultCurrency?.message}
            {...form.register('defaultCurrency')}
          />
          <Button type="submit" loading={apply.isPending} loadingText="Submitting…">
            Submit application
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ---- Security: MFA, sessions, Google linking -------------------------------------------------

interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export function SecurityPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => api<{ sessions: SessionRow[] }>('/auth/sessions', { signal }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Session signed out', 'success');
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: () => toast('Could not sign that session out', 'error'),
  });
  const [linkPassword, setLinkPassword] = useState('');
  const link = useMutation({
    mutationFn: (credential: string) =>
      api('/auth/google/link', {
        method: 'POST',
        body: { credential, ...(linkPassword ? { currentPassword: linkPassword } : {}) },
      }),
    onSuccess: async () => {
      toast('Google account linked', 'success');
      await refresh();
    },
  });
  const googleLinked = user?.identities.some((i) => i.provider === 'GOOGLE');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle>Account security</PageTitle>
      <Card title="Two-step verification">
        {user?.mfaEnabled ? (
          <MfaEnabled onChanged={() => void qc.invalidateQueries({ queryKey: ME_KEY })} />
        ) : (
          <MfaEnroll onEnabled={() => void qc.invalidateQueries({ queryKey: ME_KEY })} />
        )}
      </Card>
      {googleEnabled && (
        <Card title="Google sign-in">
          {googleLinked ? (
            <p className="text-sm">Your Google account is linked.</p>
          ) : (
            <>
              {link.error && <ErrorAlert error={link.error} />}
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                Link Google to sign in with it next time. Confirm your password first.
              </p>
              <div className="mb-3 max-w-sm">
                <Field
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                />
              </div>
              <GoogleButton onCredential={(c) => link.mutate(c)} />
            </>
          )}
        </Card>
      )}
      <Card title="Active sessions">
        {sessions.isPending && <Spinner label="Loading sessions" />}
        {sessions.error && (
          <ErrorAlert error={sessions.error} onRetry={() => void sessions.refetch()} />
        )}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{s.userAgent ?? 'Unknown device'}</p>
                <p className="text-xs text-slate-500">
                  Last active {new Date(s.lastUsedAt).toLocaleString()}
                </p>
              </div>
              {s.current ? (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  This device
                </span>
              ) : (
                <Button
                  variant="secondary"
                  loading={revoke.isPending && revoke.variables === s.id}
                  loadingText="Signing out…"
                  onClick={() => revoke.mutate(s.id)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function MfaEnroll({ onEnabled }: { onEnabled: () => void }) {
  const begin = useMutation({
    mutationFn: () =>
      api<{ secret: string; otpauthUri: string }>('/auth/mfa/enroll', { method: 'POST', body: {} }),
  });
  const confirm = useMutation({
    mutationFn: (code: string) =>
      api<{ recoveryCodes: string[] }>('/auth/mfa/enroll/confirm', {
        method: 'POST',
        body: { code },
      }),
  });
  const form = useForm<{ code: string }>({
    resolver: zodResolver(mfaCodeSchema),
    defaultValues: { code: '' },
  });
  const [qr, setQr] = useState<string>();

  // Rendered locally from the otpauth URI: the secret is never sent to a third-party QR service.
  useEffect(() => {
    if (!begin.data) return;
    void QRCode.toDataURL(begin.data.otpauthUri, { margin: 1, width: 192 }).then(setQr);
  }, [begin.data]);

  if (confirm.data) {
    return <RecoveryCodes codes={confirm.data.recoveryCodes} onDone={onEnabled} />;
  }
  if (!begin.data) {
    return (
      <>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Protect your account with a code from an authenticator app.
        </p>
        {begin.error && <ErrorAlert error={begin.error} />}
        <Button loading={begin.isPending} loadingText="Preparing…" onClick={() => begin.mutate()}>
          Set up two-step verification
        </Button>
      </>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Scan this code with your authenticator app, then enter the 6-digit code it shows.
      </p>
      {qr ? (
        <img
          src={qr}
          alt="QR code for your authenticator app"
          width={192}
          height={192}
          className="rounded bg-white p-1"
        />
      ) : (
        <Spinner label="Generating code" />
      )}
      <details className="text-xs">
        <summary className="cursor-pointer">Can't scan? Enter this key manually</summary>
        <code className="mt-2 block break-all rounded bg-slate-100 p-2 dark:bg-slate-800">
          {begin.data.secret}
        </code>
      </details>
      {confirm.error && <ErrorAlert error={confirm.error} />}
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => confirm.mutate(v.code))}
        className="flex items-start gap-3"
      >
        <div className="w-40">
          <Field
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
        </div>
        <Button type="submit" className="mt-6" loading={confirm.isPending} loadingText="Verifying…">
          Turn on
        </Button>
      </form>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <Alert tone="warning">
        Save these recovery codes now. Each works once if you lose your phone, and they will not be
        shown again.
      </Alert>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
            {c}
          </li>
        ))}
      </ul>
      <Button onClick={onDone}>I have saved them</Button>
    </div>
  );
}

function MfaEnabled({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const form = useForm<{ code: string }>({
    resolver: zodResolver(mfaCodeSchema),
    defaultValues: { code: '' },
  });
  const disable = useMutation({
    mutationFn: (code: string) =>
      api('/auth/mfa/disable', {
        method: 'POST',
        body: { code, ...(password ? { password } : {}) },
      }),
    onSuccess: () => {
      toast('Two-step verification turned off', 'success');
      onChanged();
    },
  });
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium text-emerald-700 dark:text-emerald-400">On.</span> You will be
        asked for a code when you sign in.
      </p>
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Turn off…
        </Button>
      ) : (
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => disable.mutate(v.code))}
          className="max-w-sm space-y-3"
        >
          {disable.error && <ErrorAlert error={disable.error} />}
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            label="Authentication code"
            inputMode="numeric"
            maxLength={6}
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
          <Button
            type="submit"
            variant="danger"
            loading={disable.isPending}
            loadingText="Turning off…"
          >
            Turn off two-step verification
          </Button>
        </form>
      )}
    </div>
  );
}
