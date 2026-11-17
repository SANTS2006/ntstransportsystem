import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';

interface Enquiry {
  id: string;
  kind: 'CONTACT' | 'DEMO';
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  details: Record<string, string>;
  status: 'NEW' | 'HANDLED';
  createdAt: string;
}

const LABEL: Record<string, string> = {
  topic: 'Interested in',
  fleetSize: 'Fleet size',
  role: 'Role',
  preferredDate: 'Preferred date',
  preferredTime: 'Preferred time',
};
const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** Messages and demo requests that visitors sent from the public website. */
export function EnquiriesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'NEW' | 'HANDLED'>('NEW');
  const q = useQuery({
    queryKey: ['platform', 'enquiries', status],
    queryFn: ({ signal }) =>
      api<{ inquiries: Enquiry[] }>(`/platform/inquiries?limit=100&status=${status}`, { signal }),
  });
  const mark = useMutation({
    mutationFn: (v: { id: string; handled: boolean }) =>
      api(`/platform/inquiries/${v.id}/handled`, { method: 'POST', body: { handled: v.handled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'enquiries'] }),
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not update', 'error'),
  });
  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Website enquiries</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Contact messages and demo requests sent from the public website. A notice of each one is
          also e-mailed to the company inbox.
        </p>
      </div>
      <div role="tablist" aria-label="Enquiries" className="flex gap-2">
        {(['NEW', 'HANDLED'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-11 rounded-lg px-4 text-sm font-medium ${status === s ? 'bg-brand-600 text-white' : 'border border-slate-300 dark:border-slate-600'}`}
          >
            {s === 'NEW' ? 'New' : 'Handled'}
          </button>
        ))}
      </div>
      {q.isPending && <PageLoader label="Loading enquiries" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.inquiries.length === 0 && (
        <Alert tone="info">{status === 'NEW' ? 'No new enquiries.' : 'Nothing handled yet.'}</Alert>
      )}
      <ul className="space-y-3">
        {q.data?.inquiries.map((e) => (
          <li key={e.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {e.name}
                    <Badge tone={e.kind === 'DEMO' ? 'amber' : 'slate'} icon={null}>
                      {e.kind === 'DEMO' ? 'Demo request' : 'Message'}
                    </Badge>
                  </p>
                  <p className="text-xs text-slate-500">
                    {when(e.createdAt)}
                    {e.company ? ` · ${e.company}` : ''}
                  </p>
                  <p className="mt-1 text-sm">
                    <a
                      className="font-medium text-brand-700 dark:text-brand-500"
                      href={`mailto:${e.email}`}
                    >
                      {e.email}
                    </a>
                    {e.phone && (
                      <>
                        {' · '}
                        <a href={`tel:${e.phone}`}>{e.phone}</a>
                      </>
                    )}
                  </p>
                  {Object.entries(e.details).map(([k, v]) => (
                    <p key={k} className="text-sm">
                      <span className="text-slate-500">{LABEL[k] ?? k}:</span> {v}
                    </p>
                  ))}
                  {e.message && <p className="mt-2 whitespace-pre-wrap text-sm">{e.message}</p>}
                </div>
                <Button
                  variant={e.status === 'NEW' ? 'primary' : 'secondary'}
                  loading={mark.isPending && mark.variables?.id === e.id}
                  onClick={() => mark.mutate({ id: e.id, handled: e.status === 'NEW' })}
                >
                  {e.status === 'NEW' ? 'Mark handled' : 'Reopen'}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
