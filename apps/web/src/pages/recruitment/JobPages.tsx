import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companyPath } from '../../lib/company-page';
import { ListTools } from '../../components/ui/ListTools';
import { useCompanyPublic } from '../../lib/company-public';
import { useCompanyLinks } from '../../lib/company-links';
import { useConfirm } from '../../components/ui/Confirm';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import {
  CvControl,
  SlotFileControl,
  useFileUploadsEnabled,
} from '../../components/files/FileControls';
import {
  ApplicationFields,
  IMAGE_ACCEPT,
  PendingFile,
  answersProblem,
  pictureProblem,
  type AnswerValue,
} from '../../components/recruitment/ApplicationFields';
import type { FormField } from '../../lib/job-form';
import { appRoot } from '../../lib/app-path';

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Received',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
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
  roleName: string | null;
  formFields: FormField[];
  description: string;
  location: string | null;
  closesOn: string | null;
}

export function JobBoardPage() {
  const company = useCompanyPublic();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const jobs = useQuery({
    queryKey: ['public-jobs', company?.id ?? null, search],
    queryFn: ({ signal }) =>
      api<{ jobs: Job[] }>(
        `/public/jobs?${new URLSearchParams({
          ...(search ? { q: search } : {}),
          ...(company ? { tenantId: company.id } : {}),
        }).toString()}`,
        { signal },
      ),
  });
  return (
    <div className="w-full space-y-5">
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
      {jobs.isPending && <PageLoader label="Loading jobs" />}
      {jobs.error && <ErrorAlert error={jobs.error} onRetry={() => void jobs.refetch()} />}
      {jobs.data?.jobs.length === 0 && <Alert tone="info">No open jobs right now.</Alert>}
      <ListTools title="Jobs">
        <ul className="space-y-3">
          {jobs.data?.jobs.map((j) => (
            <li key={j.id}>
              <Link
                to={company ? `/${company.slug}/jobs/${j.id}` : `/jobs/${j.tenantId}/${j.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-600 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className="block font-medium">{j.title}</span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {j.company}
                  {j.roleName ? ` · ${j.roleName}` : ''}
                  {j.location ? ` · ${j.location}` : ''}
                  {j.closesOn ? ` · apply by ${j.closesOn}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </ListTools>
    </div>
  );
}

export function JobDetailPage() {
  const { tenantId: tenantParam, id } = useParams();
  const company = useCompanyPublic();
  const tenantId = company?.id ?? tenantParam;
  const links = useCompanyLinks(tenantId);
  const { user } = useAuth();
  const jobsHome = company ? `/${company.slug}/jobs` : companyPath(user, '/jobs');
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const uploadsOn = useFileUploadsEnabled();
  const [form, setForm] = useState({
    fullName: user?.displayName ?? '',
    phoneNumber: '',
    yearsExperience: '',
    experience: '',
    licenceNumber: '',
  });
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [licence, setLicence] = useState<File | null>(null);
  const job = useQuery({
    queryKey: ['public-job', tenantId, id],
    retry: false,
    queryFn: ({ signal }) => api<Job>(`/public/jobs/${tenantId}/${id}`, { signal }),
  });
  const apply = useMutation({
    mutationFn: async () => {
      const qs = job.data?.formFields ?? [];
      const created = await api<{ id: string }>('/applicant/applications', {
        method: 'POST',
        body: {
          tenantId,
          jobId: id,
          fullName: form.fullName.trim(),
          phoneNumber: form.phoneNumber.trim(),
          yearsExperience: Number(form.yearsExperience),
          experience: form.experience.trim(),
          ...(form.licenceNumber.trim() ? { licenceNumber: form.licenceNumber.trim() } : {}),
          answers: Object.fromEntries(
            qs
              .filter(
                (f) => f.type !== 'file' && answers[f.id] !== undefined && answers[f.id] !== '',
              )
              .map((f) => [f.id, answers[f.id]!]),
          ),
        },
      });
      // The files follow once the application exists. One that fails does not undo the application.
      const uploads: [string, string, File | null][] = [
        ['picture', `/applicant/applications/${created.id}/files/photo`, photo],
        ['licence photo', `/applicant/applications/${created.id}/files/licence`, licence],
        ...qs
          .filter((f) => f.type === 'file')
          .map((f): [string, string, File | null] => [
            f.label,
            `/applicant/applications/${created.id}/form-files/${f.id}`,
            files[f.id] ?? null,
          ]),
      ];
      const failed: string[] = [];
      for (const [label, path, file] of uploads) {
        if (!file) continue;
        try {
          await api(path, { method: 'POST', file });
        } catch {
          failed.push(label);
        }
      }
      return failed;
    },
    onSuccess: async (failed) => {
      if (failed.length > 0) {
        toast(
          `Application sent, but these did not upload: ${failed.join(', ')}. Add them again from My applications.`,
          'info',
        );
      } else toast('Application sent', 'success');
      await qc.invalidateQueries({ queryKey: ['my-applications'] });
      void nav(`${appRoot()}/applications`);
    },
  });
  if (job.isPending) return <PageLoader label="Loading" />;
  if (job.error || !job.data) {
    return (
      <div className="w-full space-y-3">
        <Alert tone="error">This job is no longer open.</Alert>
        <Link className="text-brand-700 font-medium" to={jobsHome}>
          All jobs
        </Link>
      </div>
    );
  }
  const j = job.data;
  const qs = j.formFields ?? [];
  const customProblem = answersProblem(
    uploadsOn ? qs : qs.filter((f) => f.type !== 'file'),
    answers,
    files,
  );
  const years = Number(form.yearsExperience);
  const valid =
    form.fullName.trim().length >= 2 &&
    form.phoneNumber.trim().length >= 6 &&
    form.yearsExperience !== '' &&
    Number.isInteger(years) &&
    years >= 0 &&
    years <= 70 &&
    form.experience.trim().length >= 10 &&
    customProblem === null &&
    pictureProblem(photo) === null &&
    pictureProblem(licence) === null;
  return (
    <div className="w-full space-y-5">
      <Link className="text-sm text-brand-700 font-medium dark:text-brand-500" to={jobsHome}>
        All jobs
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{j.title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {j.company}
          {j.roleName ? ` · ${j.roleName}` : ''}
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
              label="Phone number"
              type="tel"
              value={form.phoneNumber}
              onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
            />
            <Field
              label="Years of experience"
              type="number"
              inputMode="numeric"
              min={0}
              max={70}
              step={1}
              value={form.yearsExperience}
              onChange={(e) => setForm((f) => ({ ...f, yearsExperience: e.target.value }))}
            />
            {uploadsOn && (
              <PendingFile
                label="Your picture"
                hint="A clear photo of your face (PNG, JPEG or WebP, up to 5 MB)."
                accept={IMAGE_ACCEPT}
                file={photo}
                onPick={setPhoto}
                problem={pictureProblem(photo)}
              />
            )}
            <Field
              label="Licence number (if you have one)"
              value={form.licenceNumber}
              onChange={(e) => setForm((f) => ({ ...f, licenceNumber: e.target.value }))}
            />
            {uploadsOn && (
              <PendingFile
                label="Picture of your licence"
                hint="Both sides if you can (PNG, JPEG or WebP, up to 5 MB). Leave empty if you have none."
                accept={IMAGE_ACCEPT}
                file={licence}
                onPick={setLicence}
                problem={pictureProblem(licence)}
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
            <ApplicationFields
              fields={uploadsOn ? qs : qs.filter((f) => f.type !== 'file')}
              answers={answers}
              files={files}
              onAnswer={(fid, v) => setAnswers((a) => ({ ...a, [fid]: v }))}
              onFile={(fid, f) => setFiles((x) => ({ ...x, [fid]: f }))}
            />
            {customProblem && (
              <p className="text-xs text-red-700 dark:text-red-400">{customProblem}</p>
            )}
            <p className="text-xs text-slate-500">
              {j.company} will see your name, phone number, email, pictures and these answers.
              Nobody else can.
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
            className="font-medium font-medium"
            to={links.signIn(company ? `/${company.slug}/jobs/${id}` : `/jobs/${tenantId}/${id}`)}
          >
            Sign in
          </Link>{' '}
          or{' '}
          <Link className="font-medium font-medium" to={links.signUp}>
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
  cv: string | null;
  licencePhoto: string | null;
  photo: string | null;
  interview: {
    date: string;
    time: string;
    mode: string;
    location: string;
    contactPerson?: string;
    contactPhone?: string;
    instructions?: string;
  } | null;
}

const MODE_LABEL: Record<string, string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone call',
  VIDEO: 'Video call',
};

export function MyApplicationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-applications'],
    queryFn: ({ signal }) =>
      api<{ applications: MyApplication[] }>('/applicant/applications', { signal }),
  });
  const ask = useConfirm();
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
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My job applications</h1>
        <Link
          className="text-sm text-brand-700 font-medium dark:text-brand-500"
          to={companyPath(user, '/jobs')}
        >
          Find jobs
        </Link>
      </div>
      {q.isPending && <PageLoader label="Loading" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.applications.length === 0 && (
        <Alert tone="info">You have not applied for any jobs.</Alert>
      )}
      <ListTools title="Applications">
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
              {a.interview && (
                <div className="w-full rounded-xl bg-brand-50 p-3 text-sm dark:bg-slate-800">
                  <p className="font-semibold">Your interview</p>
                  <p>
                    {a.interview.date} at {a.interview.time} ·{' '}
                    {MODE_LABEL[a.interview.mode] ?? a.interview.mode}
                  </p>
                  <p>{a.interview.location}</p>
                  {(a.interview.contactPerson || a.interview.contactPhone) && (
                    <p>
                      Contact: {a.interview.contactPerson}
                      {a.interview.contactPhone ? ` (${a.interview.contactPhone})` : ''}
                    </p>
                  )}
                  {a.interview.instructions && (
                    <p className="mt-1 whitespace-pre-wrap">{a.interview.instructions}</p>
                  )}
                </div>
              )}
              <span className="flex flex-wrap items-center gap-3">
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
                {a.status !== 'WITHDRAWN' && (
                  <SlotFileControl
                    label="Picture"
                    imageOnly
                    uploadPath={`/applicant/applications/${a.id}/files/photo`}
                    linkPath={`/applicant/applications/${a.id}/files/photo/link`}
                    canUpload={a.canWithdraw}
                    current={a.photo}
                  />
                )}
                {a.status !== 'WITHDRAWN' && (
                  <SlotFileControl
                    label="Licence photo"
                    imageOnly
                    uploadPath={`/applicant/applications/${a.id}/files/licence`}
                    linkPath={`/applicant/applications/${a.id}/files/licence/link`}
                    canUpload={a.canWithdraw}
                    current={a.licencePhoto}
                  />
                )}
                {a.status !== 'WITHDRAWN' && (
                  <CvControl
                    uploadPath={`/applicant/applications/${a.id}/cv`}
                    linkPath={`/applicant/applications/${a.id}/cv`}
                    canUpload={a.canWithdraw}
                    current={a.cv}
                  />
                )}
                {a.canWithdraw && (
                  <Button
                    variant="ghost"
                    loading={withdraw.isPending && withdraw.variables === a.id}
                    onClick={async () => {
                      if (
                        await ask({
                          title: 'Withdraw this application?',
                          message: 'The company will no longer consider it.',
                          confirmLabel: 'Withdraw',
                          danger: true,
                        })
                      )
                        withdraw.mutate(a.id);
                    }}
                  >
                    Withdraw
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </ListTools>
    </div>
  );
}
