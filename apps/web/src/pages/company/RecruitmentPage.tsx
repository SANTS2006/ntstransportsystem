import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTools } from '../../components/ui/ListTools';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { CvControl, SlotFileControl } from '../../components/files/FileControls';
import { FormBuilder } from '../../components/recruitment/FormBuilder';
import { cleanFields, formProblem, type FormField } from '../../lib/job-form';
import { useCompany } from './company-context';

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Received',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
const MODE_LABEL: Record<string, string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone call',
  VIDEO: 'Video call',
};
const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
const selectClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const areaClass =
  'w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900';

interface RoleOption {
  key: string;
  name: string;
}
interface JobRow {
  id: string;
  title: string;
  roleKey: string | null;
  roleName: string | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  closesOn: string | null;
  applications: number;
  formFields: FormField[];
}
interface AppRow {
  id: string;
  jobTitle: string;
  fullName: string;
  status: string;
  createdAt: string;
}
interface Interview {
  date: string;
  time: string;
  mode: string;
  location: string;
  contactPerson?: string;
  contactPhone?: string;
  instructions?: string;
}
interface AppDetail extends AppRow {
  phoneNumber: string;
  email: string | null;
  yearsExperience: number;
  experience: string;
  licenceNumber: string | null;
  allowedNext: string[];
  staffId: string | null;
  cv: string | null;
  licencePhoto: string | null;
  photo: string | null;
  formAnswers: {
    id: string;
    label: string;
    type: string;
    value: string | number | boolean | null;
  }[];
  interview: Interview | null;
  events: { id: string; from: string | null; to: string | null; note: string | null; at: string }[];
}

export function RecruitmentPage() {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const base = `/tenants/${tenantId}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'recruitment'] });
  const [tab, setTab] = useState<'jobs' | 'applications'>('applications');

  // ---- Postings ----------------------------------------------------------------------------------
  const jobs = useQuery({
    queryKey: ['company', tenantId, 'recruitment', 'jobs'],
    queryFn: ({ signal }) => api<{ jobs: JobRow[] }>(`${base}/jobs?limit=100`, { signal }),
  });
  // Only the roles registered in the system, never the company owner role.
  const roles = useQuery({
    queryKey: ['company', tenantId, 'recruitment', 'roles'],
    queryFn: ({ signal }) => api<{ roles: RoleOption[] }>(`${base}/jobs/roles`, { signal }),
  });
  const emptyDraft = { title: '', roleKey: '', description: '', location: '', closesOn: '' };
  const [draft, setDraft] = useState(emptyDraft);
  const [draftFields, setDraftFields] = useState<FormField[]>([]);
  const draftProblem = formProblem(draftFields);
  const createJob = useMutation({
    mutationFn: () =>
      api(`${base}/jobs`, {
        method: 'POST',
        body: {
          title: draft.title.trim(),
          roleKey: draft.roleKey,
          description: draft.description.trim(),
          ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
          ...(draft.closesOn ? { closesOn: draft.closesOn } : {}),
          formFields: cleanFields(draftFields),
        },
      }),
    onSuccess: async () => {
      toast('Saved as a draft. Publish it when it is ready.', 'success');
      setDraft(emptyDraft);
      setDraftFields([]);
      await refresh();
    },
  });
  const jobAction = useMutation({
    mutationFn: (v: { id: string; action: 'open' | 'close' }) =>
      api(`${base}/jobs/${v.id}/${v.action}`, { method: 'POST', body: {} }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const [editJob, setEditJob] = useState<JobRow | null>(null);
  const [editFields, setEditFields] = useState<FormField[]>([]);
  const saveForm = useMutation({
    mutationFn: () =>
      api(`${base}/jobs/${editJob!.id}`, {
        method: 'PATCH',
        body: { formFields: cleanFields(editFields) },
      }),
    onSuccess: async () => {
      toast('Application form saved', 'success');
      setEditJob(null);
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  // ---- Applications ------------------------------------------------------------------------------
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
  const [staffNo, setStaffNo] = useState('');
  const [dialog, setDialog] = useState<'interview' | 'reject' | 'hire' | null>(null);
  const done = (r: { emailed: boolean } | undefined, what: string) =>
    r?.emailed === false
      ? toast(
          `${what} The email could not be sent (the applicant may have no email). Contact them directly.`,
          'info',
        )
      : toast(`${what} The applicant has been emailed.`, 'success');

  const shortlist = useMutation({
    mutationFn: () =>
      api<{ emailed: boolean }>(`${base}/applications/${openId}/status`, {
        method: 'POST',
        body: { status: 'SHORTLISTED' },
      }),
    onSuccess: async (r) => {
      done(r, 'Shortlisted.');
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

  const d = detail.data;
  return (
    <div className="w-full space-y-5">
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
              className="mt-3 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  draft.title.trim().length >= 3 &&
                  draft.description.trim().length >= 20 &&
                  draft.roleKey &&
                  !draftProblem
                )
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
                  <label htmlFor="jb-role" className="mb-1 block text-sm font-semibold">
                    Role
                  </label>
                  <select
                    id="jb-role"
                    value={draft.roleKey}
                    onChange={(e) => setDraft((x) => ({ ...x, roleKey: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">Choose a role…</option>
                    {roles.data?.roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    The person hired gets this role in your company.
                  </p>
                </div>
                <Field
                  label="Closing date (optional)"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={draft.closesOn}
                  onChange={(e) => setDraft((x) => ({ ...x, closesOn: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="jb-desc" className="mb-1 block text-sm font-semibold">
                  Description (at least 20 characters)
                </label>
                <textarea
                  id="jb-desc"
                  rows={5}
                  maxLength={8000}
                  value={draft.description}
                  onChange={(e) => setDraft((x) => ({ ...x, description: e.target.value }))}
                  className={areaClass}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Application form</h3>
                <FormBuilder fields={draftFields} onChange={setDraftFields} />
                {draftProblem && (
                  <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
                    {draftProblem}
                  </p>
                )}
              </div>
              {createJob.error && <ErrorAlert error={createJob.error} />}
              <Button
                type="submit"
                disabled={!draft.roleKey || !!draftProblem}
                loading={createJob.isPending}
                loadingText="Saving…"
              >
                Save draft
              </Button>
            </form>
          </Card>
          <Card>
            {jobs.isPending && <PageLoader label="Loading postings" />}
            {jobs.error && <ErrorAlert error={jobs.error} onRetry={() => void jobs.refetch()} />}
            <ListTools title="Job postings">
              <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                {jobs.data?.jobs.length === 0 && (
                  <li className="py-2 text-slate-500">No postings yet.</li>
                )}
                {jobs.data?.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block font-medium">{j.title}</span>
                      <span className="text-xs text-slate-500">
                        {j.roleName ?? 'No role'} · {j.formFields.length} extra question(s) ·{' '}
                        {j.applications} application(s)
                        {j.closesOn ? ` · closes ${j.closesOn}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
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
                      {j.status !== 'CLOSED' && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditJob(j);
                            setEditFields(j.formFields);
                          }}
                        >
                          Edit form
                        </Button>
                      )}
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
            </ListTools>
          </Card>
          <Dialog
            open={editJob !== null}
            title={editJob ? `Application form: ${editJob.title}` : 'Application form'}
            onClose={() => setEditJob(null)}
          >
            <FormBuilder fields={editFields} onChange={setEditFields} />
            {formProblem(editFields) && (
              <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                {formProblem(editFields)}
              </p>
            )}
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Changing the questions affects people who apply from now on.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditJob(null)}>
                Cancel
              </Button>
              <Button
                disabled={formProblem(editFields) !== null}
                loading={saveForm.isPending}
                loadingText="Saving…"
                onClick={() => saveForm.mutate()}
              >
                Save form
              </Button>
            </div>
          </Dialog>
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
            <ListTools title="Applications">
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
            </ListTools>
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
                  {d.jobTitle} · {d.phoneNumber}
                  {d.email ? ` · ${d.email}` : ''}
                  {d.licenceNumber ? ` · licence ${d.licenceNumber}` : ''}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-medium">Years of experience:</span> {d.yearsExperience}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{d.experience}</p>
                <div className="mt-3 flex flex-col gap-2">
                  <SlotFileControl
                    label="Picture"
                    imageOnly
                    linkPath={`${base}/applications/${d.id}/files/photo/link`}
                    canUpload={false}
                    current={d.photo}
                  />
                  <SlotFileControl
                    label="Licence photo"
                    imageOnly
                    linkPath={`${base}/applications/${d.id}/files/licence/link`}
                    canUpload={false}
                    current={d.licencePhoto}
                  />
                  <CvControl
                    linkPath={`${base}/applications/${d.id}/cv`}
                    canUpload={false}
                    current={d.cv}
                  />
                </div>
                {d.formAnswers.length > 0 && (
                  <dl className="mt-3 space-y-2 text-sm">
                    {d.formAnswers.map((a) => (
                      <div key={a.id}>
                        <dt className="text-xs font-medium text-slate-500">{a.label}</dt>
                        <dd>
                          {a.type === 'file' ? (
                            <SlotFileControl
                              label={a.label}
                              linkPath={`${base}/applications/${d.id}/form-files/${a.id}/link`}
                              canUpload={false}
                              current={typeof a.value === 'string' ? a.value : null}
                            />
                          ) : a.type === 'checkbox' ? (
                            a.value === true ? (
                              'Yes'
                            ) : (
                              'No'
                            )
                          ) : a.value === null || a.value === '' ? (
                            <span className="text-slate-500">No answer</span>
                          ) : (
                            <span className="whitespace-pre-wrap">{String(a.value)}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-sm font-medium">
                  Status: {STATUS_LABEL[d.status] ?? d.status}
                </p>
                {d.interview && (
                  <p className="mt-1 text-sm">
                    Interview: {d.interview.date} at {d.interview.time} ·{' '}
                    {MODE_LABEL[d.interview.mode] ?? d.interview.mode} · {d.interview.location}
                  </p>
                )}
                {d.allowedNext.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.status === 'SUBMITTED' && (
                      <Button
                        variant="secondary"
                        loading={shortlist.isPending}
                        onClick={() => shortlist.mutate()}
                      >
                        Shortlist
                      </Button>
                    )}
                    {(d.status === 'SHORTLISTED' || d.status === 'INTERVIEW') && (
                      <Button variant="secondary" onClick={() => setDialog('interview')}>
                        {d.status === 'INTERVIEW' ? 'Update interview' : 'Invite to interview'}
                      </Button>
                    )}
                    {d.allowedNext.includes('REJECTED') && (
                      <Button variant="danger" onClick={() => setDialog('reject')}>
                        Reject
                      </Button>
                    )}
                  </div>
                )}
                {d.status === 'INTERVIEW' && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (staffNo.trim()) setDialog('hire');
                    }}
                  >
                    <div className="w-48">
                      <Field
                        label="Staff number"
                        value={staffNo}
                        onChange={(e) => setStaffNo(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={!staffNo.trim()}>
                      Hire
                    </Button>
                  </form>
                )}
                {d.status === 'HIRED' && (
                  <Alert tone="info">
                    Hired. Their staff profile is in the Staff list under People.
                  </Alert>
                )}
                <h3 className="mt-4 text-sm font-medium">History and private notes</h3>
                <ol className="mt-2 space-y-1 text-xs">
                  {d.events.map((e) => (
                    <li key={e.id}>
                      <span className="text-slate-500">{when(e.at)}</span> ·{' '}
                      {e.to
                        ? `${e.from ? `${STATUS_LABEL[e.from] ?? e.from} → ` : ''}${STATUS_LABEL[e.to] ?? e.to}`
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

      {d && openId && (
        <>
          <InterviewDialog
            key={`iv-${d.id}-${d.interview?.date ?? ''}`}
            open={dialog === 'interview'}
            base={base}
            application={d}
            onClose={() => setDialog(null)}
            onSent={async (r) => {
              setDialog(null);
              done(r, 'Interview invitation sent.');
              await refresh();
            }}
          />
          <RejectDialog
            key={`rj-${d.id}`}
            open={dialog === 'reject'}
            base={base}
            application={d}
            onClose={() => setDialog(null)}
            onSent={async (r) => {
              setDialog(null);
              done(r, 'Application rejected.');
              await refresh();
            }}
          />
          <HireDialog
            key={`hr-${d.id}`}
            open={dialog === 'hire'}
            base={base}
            application={d}
            staffNumber={staffNo.trim()}
            onClose={() => setDialog(null)}
            onHired={async (r) => {
              setDialog(null);
              setStaffNo('');
              toast(
                r.emailed
                  ? 'Hired. The staff profile was created and the employment details were emailed.'
                  : 'Hired. The staff profile was created, but the email could not be sent: tell them directly.',
                r.emailed ? 'success' : 'info',
              );
              await qc.invalidateQueries({ queryKey: ['company', tenantId] });
            }}
          />
        </>
      )}
    </div>
  );
}

/** Pop-up to type the interview details; Send emails them to the applicant. */
function InterviewDialog({
  open,
  base,
  application,
  onClose,
  onSent,
}: {
  open: boolean;
  base: string;
  application: AppDetail;
  onClose: () => void;
  onSent: (r: { emailed: boolean }) => Promise<void>;
}) {
  const prior = application.interview;
  const [f, setF] = useState({
    date: prior?.date ?? '',
    time: prior?.time ?? '',
    mode: prior?.mode ?? 'IN_PERSON',
    location: prior?.location ?? '',
    contactPerson: prior?.contactPerson ?? '',
    contactPhone: prior?.contactPhone ?? '',
    instructions: prior?.instructions ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const send = useMutation({
    mutationFn: () =>
      api<{ emailed: boolean }>(`${base}/applications/${application.id}/interview`, {
        method: 'POST',
        body: {
          date: f.date,
          time: f.time,
          mode: f.mode,
          location: f.location.trim(),
          ...(f.contactPerson.trim() ? { contactPerson: f.contactPerson.trim() } : {}),
          ...(f.contactPhone.trim() ? { contactPhone: f.contactPhone.trim() } : {}),
          ...(f.instructions.trim() ? { instructions: f.instructions.trim() } : {}),
        },
      }),
    onSuccess: onSent,
  });
  const valid = f.date !== '' && f.time !== '' && f.location.trim().length >= 2;
  return (
    <Dialog open={open} title={`Interview: ${application.fullName}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !send.isPending) send.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Date"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={f.date}
            onChange={(e) => set('date', e.target.value)}
          />
          <Field
            label="Time"
            type="time"
            value={f.time}
            onChange={(e) => set('time', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="iv-mode" className="mb-1 block text-sm font-semibold">
            Format
          </label>
          <select
            id="iv-mode"
            className={selectClass}
            value={f.mode}
            onChange={(e) => set('mode', e.target.value)}
          >
            {Object.entries(MODE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={f.mode === 'IN_PERSON' ? 'Address / venue' : 'Where (number or meeting link)'}
          value={f.location}
          onChange={(e) => set('location', e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Contact person (optional)"
            value={f.contactPerson}
            onChange={(e) => set('contactPerson', e.target.value)}
          />
          <Field
            label="Contact phone (optional)"
            type="tel"
            value={f.contactPhone}
            onChange={(e) => set('contactPhone', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="iv-notes" className="mb-1 block text-sm font-semibold">
            What to bring or know (optional)
          </label>
          <textarea
            id="iv-notes"
            rows={4}
            maxLength={2000}
            className={areaClass}
            value={f.instructions}
            onChange={(e) => set('instructions', e.target.value)}
          />
        </div>
        {send.error && <ErrorAlert error={send.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={send.isPending} loadingText="Sending…">
            Send
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Pop-up to reject an applicant at any open step; the email can carry a message. */
function RejectDialog({
  open,
  base,
  application,
  onClose,
  onSent,
}: {
  open: boolean;
  base: string;
  application: AppDetail;
  onClose: () => void;
  onSent: (r: { emailed: boolean }) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const reject = useMutation({
    mutationFn: () =>
      api<{ emailed: boolean }>(`${base}/applications/${application.id}/status`, {
        method: 'POST',
        body: { status: 'REJECTED', ...(message.trim() ? { note: message.trim() } : {}) },
      }),
    onSuccess: async (r) => {
      setMessage('');
      await onSent(r);
    },
  });
  return (
    <Dialog open={open} title={`Reject ${application.fullName}?`} onClose={onClose}>
      <p className="text-sm">
        They will be told by email that the company will not continue with their application.
      </p>
      <div>
        <label htmlFor="rj-msg" className="mb-1 block text-sm font-semibold">
          Message to include (optional)
        </label>
        <textarea
          id="rj-msg"
          rows={4}
          maxLength={2000}
          className={areaClass}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      {reject.error && <ErrorAlert error={reject.error} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={reject.isPending}
          loadingText="Rejecting…"
          onClick={() => reject.mutate()}
        >
          Reject and send email
        </Button>
      </div>
    </Dialog>
  );
}

/** Pop-up for the details of the employment; Hire creates the staff profile and emails them. */
function HireDialog({
  open,
  base,
  application,
  staffNumber,
  onClose,
  onHired,
}: {
  open: boolean;
  base: string;
  application: AppDetail;
  staffNumber: string;
  onClose: () => void;
  onHired: (r: { emailed: boolean }) => Promise<void>;
}) {
  const [f, setF] = useState({
    jobTitle: application.jobTitle,
    employmentType: 'FULL_TIME',
    startDate: '',
    reportingTo: '',
    workLocation: '',
    notes: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const hire = useMutation({
    mutationFn: () =>
      api<{ staffId: string; emailed: boolean }>(`${base}/applications/${application.id}/hire`, {
        method: 'POST',
        body: {
          staffNumber,
          jobTitle: f.jobTitle.trim(),
          employmentType: f.employmentType,
          startDate: f.startDate,
          ...(f.reportingTo.trim() ? { reportingTo: f.reportingTo.trim() } : {}),
          ...(f.workLocation.trim() ? { workLocation: f.workLocation.trim() } : {}),
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
        },
      }),
    onSuccess: onHired,
  });
  const valid = f.jobTitle.trim().length >= 2 && f.startDate !== '' && staffNumber !== '';
  return (
    <Dialog open={open} title={`Hire ${application.fullName}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !hire.isPending) hire.mutate();
        }}
      >
        <p className="text-sm">
          Staff number: <strong>{staffNumber}</strong>. A staff profile is created, and an email
          with these details and a default password (to change at first sign-in) is sent to them.
        </p>
        <Field
          label="Job title"
          value={f.jobTitle}
          onChange={(e) => set('jobTitle', e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="hr-type" className="mb-1 block text-sm font-semibold">
              Employment type
            </label>
            <select
              id="hr-type"
              className={selectClass}
              value={f.employmentType}
              onChange={(e) => set('employmentType', e.target.value)}
            >
              {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Start date"
            type="date"
            value={f.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Reports to (optional)"
            value={f.reportingTo}
            onChange={(e) => set('reportingTo', e.target.value)}
          />
          <Field
            label="Work location (optional)"
            value={f.workLocation}
            onChange={(e) => set('workLocation', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="hr-notes" className="mb-1 block text-sm font-semibold">
            Other details (optional)
          </label>
          <textarea
            id="hr-notes"
            rows={4}
            maxLength={2000}
            className={areaClass}
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
        {hire.error && <ErrorAlert error={hire.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={hire.isPending} loadingText="Hiring…">
            Hire and send email
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
