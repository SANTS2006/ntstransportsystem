import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';

const ROLE_LABEL: Record<string, string> = {
  DRIVER: 'Driver',
  CONDUCTOR: 'Conductor',
  DISPATCHER: 'Dispatcher',
  MECHANIC: 'Mechanic',
  OTHER: 'Other',
};
const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Received',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  OFFERED: 'Offer made',
  HIRED: 'Hired',
  REJECTED: 'Not successful',
  WITHDRAWN: 'Withdrawn',
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

interface Job {
  id: string;
  tenantId: string;
  company: string;
  title: string;
  jobRole: string;
  description: string;
  location: string | null;
  closesOn: string | null;
}

export function JobBoardPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const jobs = useQuery({
    queryKey: ['public-jobs', search],
    queryFn: ({ signal }) =>
      api<{ jobs: Job[] }>(`/public/jobs${search ? `?q=${encodeURIComponent(search)}` : ''}`, {
        signal,
      }),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-3xl font-semibold text-brand-700 dark:text-brand-500">Jobs</h1>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {jobs.isPending && <Spinner label="Loading jobs" />}
      {jobs.error && <ErrorAlert error={jobs.error} onRetry={() => void jobs.refetch()} />}
      {jobs.data?.jobs.length === 0 && <Alert tone="info">No open jobs right now.</Alert>}
      <ul className="space-y-3">
        {jobs.data?.jobs.map((j) => (
          <li key={j.id}>
            <Link
              to={`/jobs/${j.tenantId}/${j.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-600 dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="block font-medium">{j.title}</span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {j.company} · {ROLE_LABEL[j.jobRole] ?? j.jobRole}
                {j.location ? ` · ${j.location}` : ''}
                {j.closesOn ? ` · apply by ${j.closesOn}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JobDetailPage() {
  const { tenantId, id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: user?.displayName ?? '',
    phone: '',
    experience: '',
    licenceNumber: '',
  });
  const job = useQuery({
    queryKey: ['public-job', tenantId, id],
    retry: false,
    queryFn: ({ signal }) => api<Job>(`/public/jobs/${tenantId}/${id}`, { signal }),
  });
  const apply = useMutation({
    mutationFn: () =>
      api('/applicant/applications', {
        method: 'POST',
        body: {
          tenantId,
          jobId: id,
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          experience: form.experience.trim(),
          ...(form.licenceNumber.trim() ? { licenceNumber: form.licenceNumber.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      toast('Application sent', 'success');
      await qc.invalidateQueries({ queryKey: ['my-applications'] });
      void nav('/app/applications');
    },
  });
  if (job.isPending) return <Spinner label="Loading" />;
  if (job.error || !job.data) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <Alert tone="error">This job is no longer open.</Alert>
        <Link className="text-brand-700 underline" to="/jobs">
          All jobs
        </Link>
      </div>
    );
  }
  const j = job.data;
  const valid =
    form.fullName.trim().length >= 2 &&
    form.phone.trim().length >= 6 &&
    form.experience.trim().length >= 10;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link className="text-sm text-brand-700 underline dark:text-brand-500" to="/jobs">
        All jobs
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{j.title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {j.company} · {ROLE_LABEL[j.jobRole] ?? j.jobRole}
          {j.location ? ` · ${j.location}` : ''}
          {j.closesOn ? ` · apply by ${j.closesOn}` : ''}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm">{j.description}</p>
      {user ? (
        <Card title="Apply">
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid && !apply.isPending) apply.mutate();
            }}
          >
            <Field
              label="Full name"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            />
            <Field
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            {(j.jobRole === 'DRIVER' || j.jobRole === 'CONDUCTOR') && (
              <Field
                label="Licence number (if you have one)"
                value={form.licenceNumber}
                onChange={(e) => setForm((f) => ({ ...f, licenceNumber: e.target.value }))}
              />
            )}
            <div>
              <label htmlFor="ap-exp" className="mb-1 block text-sm font-medium">
                Your experience
              </label>
              <textarea
                id="ap-exp"
                rows={5}
                maxLength={4000}
                value={form.experience}
                onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </div>
            <p className="text-xs text-slate-500">
              {j.company} will see your name, phone, email and these answers. Nobody else can.
            </p>
            {apply.error && <ErrorAlert error={apply.error} />}
            <Button
              type="submit"
              disabled={!valid}
              loading={apply.isPending}
              loadingText="Sending…"
            >
              Send application
            </Button>
          </form>
        </Card>
      ) : (
        <Alert tone="info">
          <Link
            className="font-medium underline"
            to={`/login?next=${encodeURIComponent(`/jobs/${tenantId}/${id}`)}`}
          >
            Sign in
          </Link>{' '}
          or{' '}
          <Link className="font-medium underline" to="/register">
            create an account
          </Link>{' '}
          to apply.
        </Alert>
      )}
    </div>
  );
}

interface MyApplication {
  id: string;
  company: string;
  jobTitle: string;
  status: string;
  createdAt: string;
  canWithdraw: boolean;
}

export function MyApplicationsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-applications'],
    queryFn: ({ signal }) =>
      api<{ applications: MyApplication[] }>('/applicant/applications', { signal }),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) =>
      api(`/applicant/applications/${id}/withdraw`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      toast('Application withdrawn', 'success');
      await qc.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My job applications</h1>
        <Link className="text-sm text-brand-700 underline dark:text-brand-500" to="/jobs">
          Find jobs
        </Link>
      </div>
      {q.isPending && <Spinner label="Loading" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.applications.length === 0 && (
        <Alert tone="info">You have not applied for any jobs.</Alert>
      )}
      <ul className="space-y-3">
        {q.data?.applications.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <span>
              <span className="block font-medium">{a.jobTitle}</span>
              <span className="text-xs text-slate-500">
                {a.company} · applied {new Date(a.createdAt).toLocaleDateString()}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <StatusBadge
                status={
                  a.status === 'HIRED'
                    ? 'ACTIVE'
                    : a.status === 'REJECTED' || a.status === 'WITHDRAWN'
                      ? 'REJECTED'
                      : 'PENDING'
                }
                label={STATUS_LABEL[a.status] ?? a.status}
              />
              {a.canWithdraw && (
                <Button
                  variant="ghost"
                  loading={withdraw.isPending && withdraw.variables === a.id}
                  onClick={() => {
                    if (window.confirm('Withdraw this application?')) withdraw.mutate(a.id);
                  }}
                >
                  Withdraw
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
