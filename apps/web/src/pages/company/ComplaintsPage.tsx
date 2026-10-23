import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useCompany } from './company-context';

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
const badge = (s: string) => (s === 'RESOLVED' || s === 'CLOSED' ? 'ACTIVE' : 'PENDING');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

interface Row {
  id: string;
  bookingReference: string;
  customer: string;
  category: string;
  subject: string;
  status: string;
  updatedAt: string;
}
interface Detail extends Row {
  customerPhone: string;
  messages: { id: string; from: 'STAFF' | 'CUSTOMER'; body: string; at: string }[];
}
interface Ratings {
  total: number;
  average: number | null;
  distribution: { rating: number; count: number }[];
  routes: { route: string; count: number; average: number }[];
}

export function ComplaintsPage() {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const base = `/tenants/${tenantId}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'complaints'] });

  const list = useQuery({
    queryKey: ['company', tenantId, 'complaints', 'list', status],
    queryFn: ({ signal }) =>
      api<{ complaints: Row[] }>(
        `${base}/complaints?limit=50${status ? `&status=${status}` : ''}`,
        { signal },
      ),
  });
  const detail = useQuery({
    queryKey: ['company', tenantId, 'complaints', 'detail', openId],
    enabled: openId !== null,
    queryFn: ({ signal }) => api<Detail>(`${base}/complaints/${openId}`, { signal }),
  });
  const ratings = useQuery({
    queryKey: ['company', tenantId, 'complaints', 'ratings'],
    queryFn: ({ signal }) => api<Ratings>(`${base}/ratings/summary`, { signal }),
  });
  const reply = useMutation({
    mutationFn: () =>
      api(`${base}/complaints/${openId}/messages`, { method: 'POST', body: { body: text.trim() } }),
    onSuccess: async () => {
      setText('');
      toast('Reply sent. The customer has been notified.', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const setState = useMutation({
    mutationFn: (s: string) =>
      api(`${base}/complaints/${openId}/status`, { method: 'POST', body: { status: s } }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const d = detail.data;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Complaints</h1>

      {ratings.data && ratings.data.total > 0 && (
        <Card title="Trip ratings">
          <p className="mt-2 text-sm">
            Average <strong>{ratings.data.average}</strong> / 5 from {ratings.data.total} rating(s)
          </p>
          <ul className="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            {ratings.data.routes.map((r) => (
              <li key={r.route}>
                {r.route}: {r.average} ({r.count})
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          <div>
            <label htmlFor="cm-status" className="mb-1 block text-sm font-medium">
              Show
            </label>
            <select
              id="cm-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {list.isPending && <Spinner label="Loading complaints" />}
          {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
          {list.data?.complaints.length === 0 && <Alert tone="info">No complaints.</Alert>}
          <ul className="space-y-2">
            {list.data?.complaints.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={openId === c.id}
                  onClick={() => setOpenId(c.id)}
                  className={`w-full rounded-xl border p-3 text-left text-sm ${
                    openId === c.id
                      ? 'border-brand-600 bg-brand-50 dark:bg-slate-800'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium">{c.subject}</span>
                    <StatusBadge
                      status={badge(c.status)}
                      label={STATUS_LABEL[c.status] ?? c.status}
                    />
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {c.customer} · {c.bookingReference} ·{' '}
                    {c.category.toLowerCase().replace('_', ' ')} · {when(c.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {!openId && <Alert tone="info">Choose a complaint to read and reply.</Alert>}
          {openId && detail.isPending && <Spinner label="Loading" />}
          {detail.error && (
            <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} />
          )}
          {d && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{d.subject}</h2>
                  <p className="text-xs text-slate-500">
                    {d.customer} · {d.customerPhone} · booking {d.bookingReference}
                  </p>
                </div>
                <StatusBadge status={badge(d.status)} label={STATUS_LABEL[d.status] ?? d.status} />
              </div>
              <ol className="mt-3 space-y-2" aria-label="Conversation">
                {d.messages.map((m) => (
                  <li
                    key={m.id}
                    className={`max-w-[90%] rounded-xl p-3 text-sm ${
                      m.from === 'STAFF'
                        ? 'ml-auto bg-brand-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-800'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-xs opacity-80">
                      {m.from === 'STAFF' ? 'Staff' : 'Customer'} · {when(m.at)}
                    </p>
                  </li>
                ))}
              </ol>
              {d.status !== 'CLOSED' && (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim() && !reply.isPending) reply.mutate();
                  }}
                >
                  <label htmlFor="cm-reply" className="block text-sm font-medium">
                    Reply
                  </label>
                  <textarea
                    id="cm-reply"
                    rows={3}
                    maxLength={4000}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={!text.trim()}
                      loading={reply.isPending}
                      loadingText="Sending…"
                    >
                      Send reply
                    </Button>
                    {d.status !== 'RESOLVED' && (
                      <Button
                        variant="secondary"
                        loading={setState.isPending}
                        onClick={() => setState.mutate('RESOLVED')}
                      >
                        Mark resolved
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm('Close this complaint? It cannot be reopened.'))
                          setState.mutate('CLOSED');
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
