import { zodResolver } from '@hookform/resolvers/zod';
import { useConfirm } from '../../components/ui/Confirm';
import { ListTools } from '../../components/ui/ListTools';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ME_KEY, useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { mfaCodeSchema } from '../../lib/schemas';

const PageTitle = ({ children }: { children: string }) => (
  <h1 className="mb-6 text-2xl font-semibold">{children}</h1>
);

// ---- Security: MFA and sessions -------------------------------------------------

interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export function SecurityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => api<{ sessions: SessionRow[] }>('/auth/sessions', { signal }),
  });
  const ask = useConfirm();
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Session signed out', 'success');
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: () => toast('Could not sign that session out', 'error'),
  });
  return (
    <div className="w-full space-y-6">
      <PageTitle>Account security</PageTitle>
      <Card title="Two-step verification">
        {user?.mfaEnabled ? (
          <MfaEnabled onChanged={() => void qc.invalidateQueries({ queryKey: ME_KEY })} />
        ) : (
          <MfaEnroll onEnabled={() => void qc.invalidateQueries({ queryKey: ME_KEY })} />
        )}
      </Card>
      <Card title="Active sessions">
        {sessions.isPending && <PageLoader label="Loading sessions" />}
        {sessions.error && (
          <ErrorAlert error={sessions.error} onRetry={() => void sessions.refetch()} />
        )}
        <ListTools title="Sessions">
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {sessions.data?.sessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words [overflow-wrap:anywhere] line-clamp-2">
                    {s.userAgent ?? 'Unknown device'}
                  </p>
                  <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">
                    Last active {new Date(s.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                {s.current ? (
                  <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    This device
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    className="w-full shrink-0 sm:w-auto"
                    loading={revoke.isPending && revoke.variables === s.id}
                    loadingText="Signing out…"
                    onClick={async () => {
                      if (
                        await ask({
                          title: 'Sign out this device?',
                          message: 'That session is signed out straight away.',
                          confirmLabel: 'Sign out device',
                          danger: true,
                        })
                      )
                        revoke.mutate(s.id);
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </ListTools>
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
          className="mx-auto h-auto w-full max-w-48 rounded bg-white p-1 sm:mx-0"
        />
      ) : (
        <PageLoader label="Generating code" />
      )}
      <details className="text-xs">
        <summary className="cursor-pointer [overflow-wrap:anywhere]">
          Can't scan? Enter this key manually
        </summary>
        <code className="mt-2 block break-all rounded bg-slate-100 p-2 dark:bg-slate-800">
          {begin.data.secret}
        </code>
      </details>
      {confirm.error && <ErrorAlert error={confirm.error} />}
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => confirm.mutate(v.code))}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="w-full sm:w-40">
          <Field
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
        </div>
        <Button
          type="submit"
          className="w-full sm:mt-6 sm:w-auto"
          loading={confirm.isPending}
          loadingText="Verifying…"
        >
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
      <ul className="grid gap-2 font-mono text-sm min-[420px]:grid-cols-2">
        {codes.map((c) => (
          <li key={c} className="break-all rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
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
          className="w-full max-w-sm space-y-3"
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
            className="w-full sm:w-auto"
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
