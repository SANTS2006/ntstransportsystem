import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../components/ui/Confirm';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { CvControl } from '../../components/files/FileControls';
import { useCompany } from './company-context';

const ROLES = ['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER'];
const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Received',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  OFFERED: 'Offer made',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
const NEXT_LABEL: Record<string, string> = {
  SHORTLISTED: 'Shortlist',
  INTERVIEW: 'Invite to interview',
  OFFERED: 'Make offer',
  REJECTED: 'Reject',
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

interface JobRow {
  id: string;
  title: string;
  jobRole: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  closesOn: string | null;
  applications: number;
}
interface AppRow {
  id: string;
  jobTitle: string;
  fullName: string;
  status: string;
  createdAt: string;
}
interface AppDetail extends AppRow {
  phone: string;
  email: string | null;
  experience: string;
  licenceNumber: string | null;
  allowedNext: string[];
  employeeId: string | null;
  cv: string | null;
  events: { id: string; from: string | null; to: string | null; note: string | null; at: string }[];
}

export function RecruitmentPage() {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const base = `/tenants/${tenantId}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'recruitment'] });
  const [tab, setTab] = useState<'jobs' | 'applications'>('applications');

  // Jobs
  const jobs = useQuery({
    queryKey: ['company', tenantId, 'recruitment', 'jobs'],
    queryFn: ({ signal }) => api<{ jobs: JobRow[] }>(`${base}/jobs?limit=100`, { signal }),
  });
  const [draft, setDraft] = useState({
    title: '',
    jobRole: 'DRIVER',
    description: '',
    location: '',
  });
  const createJob = useMutation({
    mutationFn: () =>
      api(`${base}/jobs`, {
        method: 'POST',
        body: {
          title: draft.title.trim(),
          jobRole: draft.jobRole,
          description: draft.description.trim(),
          ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      toast('Saved as a draft', 'success');
      setDraft({ title: '', jobRole: 'DRIVER', description: '', location: '' });
      await refresh();
    },
  });
  const jobAction = useMutation({
    mutationFn: (v: { id: string; action: 'open' | 'close' }) =>
      api(`${base}/jobs/${v.id}/${v.action}`, { method: 'POST', body: {} }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });

  // Applications
  const [jobFilter, setJobFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const apps = useQuery({
    queryKey: ['company', tenantId, 'recruitment', 'apps', jobFilter, statusFilter],
    queryFn: ({ signal }) =>
      api<{ applications: AppRow[] }>(
        `${base}/applications?limit=50${jobFilter ? `&jobId=${jobFilter}` : ''}${statusFilter ? `&status=${statusFilter}` : ''}`,
        { signal },
      ),
  });
  const detail = useQuery({
    queryKey: ['company', tenantId, 'recruitment', 'app', openId],
    enabled: openId !== null,
    queryFn: ({ signal }) => api<AppDetail>(`${base}/applications/${openId}`, { signal }),
  });
  const [note, setNote] = useState('');
  const [empNo, setEmpNo] = useState('');
  const ask = useConfirm();
  const move = useMutation({
    mutationFn: (status: string) =>
      api(`${base}/applications/${openId}/status`, { method: 'POST', body: { status } }),
    onSuccess: async () => {
      toast('Updated. The applicant has been notified.', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const addNote = useMutation({
    mutationFn: () =>
      api(`${base}/applications/${openId}/notes`, { method: 'POST', body: { note: note.trim() } }),
    onSuccess: async () => {
      setNote('');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const hire = useMutation({
    mutationFn: () =>
      api(`${base}/applications/${openId}/hire`, {
        method: 'POST',
        body: { employeeNumber: empNo.trim() },
      }),
    onSuccess: async () => {
      toast('Hired: the employee record was created', 'success');
      setEmpNo('');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const d = detail.data;
  return (
    <div className="mx-auto w-[90%] space-y-5">
      <h1 className="text-2xl font-semibold">Recruitment</h1>
      <div role="tablist" aria-label="Recruitment" className="flex gap-2">
        {(['applications', 'jobs'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 rounded-lg px-4 text-sm font-medium ${tab === t ? 'bg-brand-600 text-white' : 'border border-slate-300 dark:border-slate-600'}`}
          >
            {t === 'jobs' ? 'Job postings' : 'Applications'}
          </button>
        ))}
      </div>

      {tab === 'jobs' && (
        <>
          <Card title="New posting">
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.title.trim().length >= 3 && draft.description.trim().length >= 20)
                  createJob.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Title"
                  value={draft.title}
                  onChange={(e) => setDraft((x) => ({ ...x, title: e.target.value }))}
                />
                <Field
                  label="Location (optional)"
                  value={draft.location}
                  onChange={(e) => setDraft((x) => ({ ...x, location: e.target.value }))}
                />
                <div>
                  <label htmlFor="jb-role" className="mb-1 block text-sm font-medium">
                    Role
                  </label>
                  <select
                    id="jb-role"
                    value={draft.jobRole}
                    onChange={(e) => setDraft((x) => ({ ...x, jobRole: e.target.value }))}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0) + r.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="jb-desc" className="mb-1 block text-sm font-medium">
                  Description (at least 20 characters)
                </label>
                <textarea
                  id="jb-desc"
                  rows={5}
                  maxLength={8000}
                  value={draft.description}
                  onChange={(e) => setDraft((x) => ({ ...x, description: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
              </div>
              {createJob.error && <ErrorAlert error={createJob.error} />}
              <Button type="submit" loading={createJob.isPending} loadingText="Saving…">
                Save draft
              </Button>
            </form>
          </Card>
          <Card>
            {jobs.isPending && <PageLoader label="Loading postings" />}
            {jobs.error && <ErrorAlert error={jobs.error} onRetry={() => void jobs.refetch()} />}
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {jobs.data?.jobs.length === 0 && (
                <li className="py-2 text-slate-500">No postings yet.</li>
              )}
              {jobs.data?.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-medium">{j.title}</span>
                    <span className="text-xs text-slate-500">
                      {j.jobRole.toLowerCase()} · {j.applications} application(s)
                      {j.closesOn ? ` · closes ${j.closesOn}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge
                      status={
                        j.status === 'OPEN'
                          ? 'ACTIVE'
                          : j.status === 'DRAFT'
                            ? 'PENDING'
                            : 'REJECTED'
                      }
                      label={j.status.charAt(0) + j.status.slice(1).toLowerCase()}
                    />
                    {j.status !== 'OPEN' && (
                      <Button
                        variant="secondary"
                        loading={jobAction.isPending && jobAction.variables?.id === j.id}
                        onClick={() => jobAction.mutate({ id: j.id, action: 'open' })}
                      >
                        {j.status === 'DRAFT' ? 'Publish' : 'Reopen'}
                      </Button>
                    )}
                    {j.status !== 'CLOSED' && (
                      <Button
                        variant="ghost"
                        onClick={() => jobAction.mutate({ id: j.id, action: 'close' })}
                      >
                        Close
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {tab === 'applications' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <select
                aria-label="Posting"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">All postings</option>
                {jobs.data?.jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">Any status</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {apps.isPending && <PageLoader label="Loading applications" />}
            {apps.error && <ErrorAlert error={apps.error} onRetry={() => void apps.refetch()} />}
            {apps.data?.applications.length === 0 && <Alert tone="info">No applications.</Alert>}
            <ul className="space-y-2">
              {apps.data?.applications.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-pressed={openId === a.id}
                    onClick={() => setOpenId(a.id)}
                    className={`w-full rounded-xl border p-3 text-left text-sm ${openId === a.id ? 'border-brand-600 bg-brand-50 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium">{a.fullName}</span>
                      <span className="text-xs">{STATUS_LABEL[a.status] ?? a.status}</span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      {a.jobTitle} · {when(a.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            {!openId && <Alert tone="info">Choose an application to review.</Alert>}
            {openId && detail.isPending && <PageLoader label="Loading" />}
            {detail.error && (
              <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} />
            )}
            {d && (
              <Card>
                <h2 className="font-semibold">{d.fullName}</h2>
                <p className="text-xs text-slate-500">
                  {d.jobTitle} · {d.phone}
                  {d.email ? ` · ${d.email}` : ''}
                  {d.licenceNumber ? ` · licence ${d.licenceNumber}` : ''}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm">{d.experience}</p>
                <div className="mt-3">
                  <CvControl
                    linkPath={`${base}/applications/${d.id}/cv`}
                    canUpload={false}
                    current={d.cv}
                  />
                </div>
                <p className="mt-3 text-sm font-medium">
                  Status: {STATUS_LABEL[d.status] ?? d.status}
                </p>
                {d.allowedNext.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.allowedNext.map((s) => (
                      <Button
                        key={s}
                        variant={s === 'REJECTED' ? 'danger' : 'secondary'}
                        loading={move.isPending && move.variables === s}
                        onClick={async () => {
                          if (
                            s !== 'REJECTED' ||
                            (await ask({
                              title: 'Reject this applicant?',
                              message: 'They will be told by email.',
                              confirmLabel: 'Reject applicant',
                              danger: true,
                            }))
                          )
                            move.mutate(s);
                        }}
                      >
                        {NEXT_LABEL[s] ?? s}
                      </Button>
                    ))}
                  </div>
                )}
                {d.status === 'OFFERED' && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (empNo.trim() && !hire.isPending) hire.mutate();
                    }}
                  >
                    <div className="w-48">
                      <Field
                        label="Employee number"
                        value={empNo}
                        onChange={(e) => setEmpNo(e.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={!empNo.trim()}
                      loading={hire.isPending}
                      loadingText="Hiring…"
                    >
                      Mark as hired
                    </Button>
                  </form>
                )}
                <h3 className="mt-4 text-sm font-medium">History and private notes</h3>
                <ol className="mt-2 space-y-1 text-xs">
                  {d.events.map((e) => (
                    <li key={e.id}>
                      <span className="text-slate-500">{when(e.at)}</span> ·{' '}
                      {e.to
                        ? `${e.from ? `${STATUS_LABEL[e.from]} → ` : ''}${STATUS_LABEL[e.to] ?? e.to}`
                        : `Note: ${e.note ?? ''}`}
                      {e.to && e.note ? ` (${e.note})` : ''}
                    </li>
                  ))}
                </ol>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (note.trim() && !addNote.isPending) addNote.mutate();
                  }}
                >
                  <input
                    aria-label="Private note"
                    value={note}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Private note (never sent to the applicant)"
                    className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={!note.trim()}
                    loading={addNote.isPending}
                  >
                    Add
                  </Button>
                </form>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
