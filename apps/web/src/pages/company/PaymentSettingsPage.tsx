import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useCompany } from './company-context';
import { QmoneyCard } from './QmoneyCard';

interface Settings {
  configured: boolean;
  enabled: boolean;
  spaceId: string | null;
  webhookUrl: string;
}

const schema = z.object({
  spaceId: z
    .string()
    .trim()
    .regex(/^spc-[A-Za-z0-9_-]{1,60}$/, 'A Monime space id looks like spc-…'),
  apiToken: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^mon(_test)?_[A-Za-z0-9._-]{8,300}$/.test(v),
      'A token starts with mon_ or mon_test_',
    ),
  enabled: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function PaymentSettingsPage() {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['company', tenantId, 'payment-settings'],
    queryFn: ({ signal }) => api<Settings>(`/tenants/${tenantId}/payment-settings`, { signal }),
  });
  const [secret, setSecret] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: { spaceId: q.data?.spaceId ?? '', apiToken: '', enabled: q.data?.enabled ?? true },
  });
  const save = useMutation({
    mutationFn: (v: Values) =>
      api<{ webhookSecret: string | null }>(`/tenants/${tenantId}/payment-settings`, {
        method: 'PUT',
        body: {
          spaceId: v.spaceId,
          enabled: v.enabled,
          ...(v.apiToken ? { apiToken: v.apiToken } : {}),
        },
      }),
    onSuccess: async (r) => {
      toast('Payment settings saved', 'success');
      setSecret(r.webhookSecret);
      await qc.invalidateQueries({ queryKey: ['company', tenantId, 'payment-settings'] });
    },
  });
  const { errors } = form.formState;
  return (
    <div className="mx-auto w-[90%] space-y-6">
      <h1 className="text-2xl font-semibold">Online payments (Monime)</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Passengers pay through Monime hosted checkout, straight into your Monime account. Your
        credentials are encrypted and cannot be read back. Passengers can only book online once this
        is set up and enabled.
      </p>
      {q.isPending && <PageLoader label="Loading settings" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          {!q.data.configured && <Alert tone="info">Online payments are not set up yet.</Alert>}
          <Card title="Credentials">
            <form
              noValidate
              onSubmit={form.handleSubmit((v) => save.mutate(v))}
              className="mt-3 space-y-3"
            >
              <Field
                label="Monime space id"
                error={errors.spaceId?.message}
                {...form.register('spaceId')}
              />
              <Field
                label={
                  q.data.configured
                    ? 'Access token (leave blank to keep the current one)'
                    : 'Access token'
                }
                type="password"
                autoComplete="off"
                error={errors.apiToken?.message}
                {...form.register('apiToken')}
              />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" {...form.register('enabled')} /> Accept online payments
              </label>
              {save.error && <ErrorAlert error={save.error} />}
              <Button type="submit" loading={save.isPending} loadingText="Saving…">
                Save
              </Button>
            </form>
          </Card>
          {secret && (
            <Alert tone="success">
              <p className="font-medium">Webhook secret (shown once, copy it now)</p>
              <code className="mt-1 block break-all rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">
                {secret}
              </code>
            </Alert>
          )}
          <Card title="Register the webhook in Monime">
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              <li>
                In the Monime dashboard create a webhook with this URL:
                <code className="mt-1 block break-all rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">
                  {q.data.webhookUrl}
                </code>
              </li>
              <li>Choose HMAC (HS256) verification and paste the webhook secret above.</li>
              <li>
                Subscribe to the checkout session events (completed and expired). Payments are
                always re-checked with Monime before a booking is confirmed.
              </li>
            </ol>
          </Card>
        </>
      )}
      <QmoneyCard tenantId={tenantId} />
    </div>
  );
}
