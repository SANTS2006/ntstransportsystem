import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useVehicles } from './CatalogPages';
import { can, useCompany } from './company-context';

const selectClass =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const Title = ({ children }: { children: string }) => (
  <h1 className="mb-2 text-2xl font-semibold">{children}</h1>
);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

// ---- Staff -------------------------------------------------------------------------------------

interface Employee {
  id: string;
  employeeNumber: string;
  fullName: string;
  role: string;
  status: string;
  phone: string | null;
  licenceExpiresOn: string | null;
}
const employeeSchema = z.object({
  employeeNumber: z.string().trim().min(1, 'Enter the staff number').max(30),
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  role: z.enum(['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER']),
});
type EmployeeValues = z.infer<typeof employeeSchema>;
const licenceSchema = z.object({
  licenceNumber: z.string().trim().min(3, 'Enter the licence number').max(40),
  category: z.string().trim().min(1, 'Category').max(20),
  expiresOn: z.string().min(1, 'Choose the expiry date'),
});
type LicenceValues = z.infer<typeof licenceSchema>;

export function StaffPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'employees'] });
  const manage = can(access, 'hr.manage');
  const [licenceFor, setLicenceFor] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['company', tenantId, 'employees'],
    queryFn: ({ signal }) =>
      api<{ employees: Employee[] }>(`/tenants/${tenantId}/employees?limit=100`, { signal }),
  });
  const form = useForm<EmployeeValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { employeeNumber: '', fullName: '', role: 'DRIVER' },
  });
  const create = useMutation({
    mutationFn: (v: EmployeeValues) =>
      api(`/tenants/${tenantId}/employees`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Employee added', 'success');
      form.reset();
      await refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/tenants/${tenantId}/employees/${v.id}`, {
        method: 'PATCH',
        body: { status: v.status },
      }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const licForm = useForm<LicenceValues>({
    resolver: zodResolver(licenceSchema),
    defaultValues: { licenceNumber: '', category: 'D', expiresOn: '' },
  });
  const addLicence = useMutation({
    mutationFn: (v: LicenceValues) =>
      api(`/tenants/${tenantId}/employees/${licenceFor}/licences`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Licence recorded', 'success');
      licForm.reset();
      setLicenceFor(null);
      await refresh();
    },
  });
  const { errors } = form.formState;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Title>Staff</Title>
      {manage && (
        <Card title="Add an employee">
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="flex flex-wrap items-start gap-3"
          >
            <div className="w-32">
              <Field
                label="Staff no."
                error={errors.employeeNumber?.message}
                {...form.register('employeeNumber')}
              />
            </div>
            <div className="min-w-48 flex-1">
              <Field
                label="Full name"
                error={errors.fullName?.message}
                {...form.register('fullName')}
              />
            </div>
            <div>
              <label htmlFor="emp-role" className="mb-1 block text-sm font-medium">
                Job
              </label>
              <select id="emp-role" className={selectClass} {...form.register('role')}>
                {['DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER'].map((r) => (
                  <option key={r} value={r}>
                    {title(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <Button type="submit" loading={create.isPending} loadingText="Adding…">
                Add
              </Button>
            </div>
            <div className="w-full">{create.error && <ErrorAlert error={create.error} />}</div>
          </form>
        </Card>
      )}
      <Card>
        {q.isPending && <PageLoader label="Loading staff" />}
        {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {q.data?.employees.length === 0 && <li className="py-2 text-slate-500">No staff yet.</li>}
          {q.data?.employees.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {e.fullName}{' '}
                    <span className="text-xs font-normal text-slate-500">#{e.employeeNumber}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {title(e.role)}
                    {e.role === 'DRIVER' &&
                      (e.licenceExpiresOn
                        ? ` · licence to ${e.licenceExpiresOn}${e.licenceExpiresOn < today ? ' (expired)' : ''}`
                        : ' · no licence recorded')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={
                      e.status === 'ON_LEAVE'
                        ? 'PENDING'
                        : e.status === 'TERMINATED'
                          ? 'DEACTIVATED'
                          : 'ACTIVE'
                    }
                    label={title(e.status)}
                  />
                  {manage && e.role === 'DRIVER' && e.status !== 'TERMINATED' && (
                    <Button
                      variant="ghost"
                      onClick={() => setLicenceFor(licenceFor === e.id ? null : e.id)}
                    >
                      Add licence
                    </Button>
                  )}
                  {manage && e.status !== 'TERMINATED' && (
                    <select
                      aria-label={`Status for ${e.fullName}`}
                      className={selectClass}
                      value={e.status}
                      disabled={setStatus.isPending}
                      onChange={(ev) => setStatus.mutate({ id: e.id, status: ev.target.value })}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="ON_LEAVE">On leave</option>
                      <option value="TERMINATED">Terminate…</option>
                    </select>
                  )}
                </div>
              </div>
              {licenceFor === e.id && (
                <form
                  noValidate
                  onSubmit={licForm.handleSubmit((v) => addLicence.mutate(v))}
                  className="mt-3 flex flex-wrap items-start gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"
                >
                  <div className="min-w-40 flex-1">
                    <Field
                      label="Licence number"
                      error={licForm.formState.errors.licenceNumber?.message}
                      {...licForm.register('licenceNumber')}
                    />
                  </div>
                  <div className="w-24">
                    <Field
                      label="Category"
                      error={licForm.formState.errors.category?.message}
                      {...licForm.register('category')}
                    />
                  </div>
                  <div className="w-44">
                    <Field
                      label="Expires on"
                      type="date"
                      error={licForm.formState.errors.expiresOn?.message}
                      {...licForm.register('expiresOn')}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="mt-6"
                    loading={addLicence.isPending}
                    loadingText="Saving…"
                  >
                    Save
                  </Button>
                  <div className="w-full">
                    {addLicence.error && <ErrorAlert error={addLicence.error} />}
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---- Maintenance, documents and alerts ---------------------------------------------------------

interface MaintenanceRow {
  id: string;
  vehicle: string;
  kind: string;
  status: string;
  scheduledFor: string;
  completedOn: string | null;
  description: string;
  costMinor: number | null;
}
interface Alerts {
  asOf: string;
  documents: {
    id: string;
    vehicle: string;
    kind: string;
    referenceNo: string;
    expiresOn: string;
    daysLeft: number;
    expired: boolean;
  }[];
  maintenance: {
    id: string;
    vehicle: string;
    kind: string;
    scheduledFor: string;
    daysLeft: number;
    overdue: boolean;
  }[];
  licences?: {
    id: string;
    employee: string;
    licenceNumber: string;
    expiresOn: string;
    daysLeft: number;
    expired: boolean;
  }[];
}
const jobSchema = z.object({
  vehicleId: z.string().min(1, 'Choose a vehicle'),
  kind: z.enum(['SERVICE', 'REPAIR', 'INSPECTION']),
  scheduledFor: z.string().min(1, 'Choose a date'),
  description: z.string().trim().min(2, 'Describe the job').max(500),
});
type JobValues = z.infer<typeof jobSchema>;
const docSchema = z.object({
  vehicleId: z.string().min(1, 'Choose a vehicle'),
  kind: z.enum(['INSURANCE', 'INSPECTION_CERTIFICATE', 'ROAD_LICENCE', 'OTHER']),
  referenceNo: z.string().trim().min(1, 'Enter the reference').max(60),
  expiresOn: z.string().min(1, 'Choose the expiry date'),
});
type DocValues = z.infer<typeof docSchema>;

const dueText = (daysLeft: number, past: boolean) =>
  past
    ? `${Math.abs(daysLeft)} day(s) overdue`
    : daysLeft === 0
      ? 'due today'
      : `in ${daysLeft} day(s)`;

export function MaintenancePage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const refreshAll = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });
  const manage = can(access, 'fleet.manage');
  const vehicles = useVehicles();
  const alerts = useQuery({
    queryKey: ['company', tenantId, 'alerts'],
    queryFn: ({ signal }) => api<Alerts>(`/tenants/${tenantId}/fleet/alerts?days=30`, { signal }),
  });
  const records = useQuery({
    queryKey: ['company', tenantId, 'maintenance'],
    queryFn: ({ signal }) =>
      api<{ records: MaintenanceRow[] }>(`/tenants/${tenantId}/maintenance?limit=100`, { signal }),
  });
  const jobForm = useForm<JobValues>({
    resolver: zodResolver(jobSchema),
    defaultValues: { vehicleId: '', kind: 'SERVICE', scheduledFor: '', description: '' },
  });
  const docForm = useForm<DocValues>({
    resolver: zodResolver(docSchema),
    defaultValues: { vehicleId: '', kind: 'INSURANCE', referenceNo: '', expiresOn: '' },
  });
  const createJob = useMutation({
    mutationFn: (v: JobValues) =>
      api(`/tenants/${tenantId}/maintenance`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Job scheduled', 'success');
      jobForm.reset();
      await refreshAll();
    },
  });
  const addDoc = useMutation({
    mutationFn: (v: DocValues) =>
      api(`/tenants/${tenantId}/vehicle-documents`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Document recorded', 'success');
      docForm.reset();
      await refreshAll();
    },
  });
  const [completing, setCompleting] = useState<string | null>(null);
  const [done, setDone] = useState({ odometerKm: '', cost: '' });
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'start' | 'cancel' | 'complete' }) =>
      api(`/tenants/${tenantId}/maintenance/${v.id}/${v.action}`, {
        method: 'POST',
        body:
          v.action === 'complete'
            ? {
                ...(done.odometerKm ? { odometerKm: Number(done.odometerKm) } : {}),
                ...(done.cost ? { costMinor: Math.round(Number(done.cost) * 100) } : {}),
              }
            : {},
      }),
    onSuccess: async () => {
      setCompleting(null);
      setDone({ odometerKm: '', cost: '' });
      await refreshAll();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const vehicleOptions = vehicles.data?.vehicles.filter((v) => v.status !== 'RETIRED') ?? [];
  const attention =
    (alerts.data?.documents.length ?? 0) +
    (alerts.data?.maintenance.length ?? 0) +
    (alerts.data?.licences?.length ?? 0);

  const vehicleSelect = (form: 'job' | 'doc', err?: string) => (
    <div>
      <label htmlFor={`${form}-veh`} className="mb-1 block text-sm font-medium">
        Vehicle
      </label>
      <select
        id={`${form}-veh`}
        className={`${selectClass} w-full`}
        {...(form === 'job' ? jobForm.register('vehicleId') : docForm.register('vehicleId'))}
      >
        <option value="">Choose…</option>
        {vehicleOptions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.registration}
          </option>
        ))}
      </select>
      {err && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {err}
        </p>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Title>Maintenance</Title>

      <Card
        title={`Needs attention${alerts.data ? ` (next 30 days${attention ? `: ${attention}` : ''})` : ''}`}
      >
        {alerts.isPending && <PageLoader label="Loading alerts" />}
        {alerts.error && <ErrorAlert error={alerts.error} onRetry={() => void alerts.refetch()} />}
        {alerts.data && attention === 0 && (
          <p className="text-sm text-slate-500">Nothing is expiring or overdue.</p>
        )}
        <ul className="space-y-1 text-sm">
          {alerts.data?.documents.map((d) => (
            <li
              key={d.id}
              className={d.expired ? 'font-medium text-red-700 dark:text-red-400' : ''}
            >
              {d.vehicle}: {title(d.kind)} {d.referenceNo} {d.expired ? 'expired' : 'expires'}{' '}
              {d.expiresOn} ({dueText(d.daysLeft, d.expired)})
            </li>
          ))}
          {alerts.data?.maintenance.map((m) => (
            <li
              key={m.id}
              className={m.overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}
            >
              {m.vehicle}: {title(m.kind)} scheduled {m.scheduledFor} (
              {dueText(m.daysLeft, m.overdue)})
            </li>
          ))}
          {alerts.data?.licences?.map((l) => (
            <li
              key={l.id}
              className={l.expired ? 'font-medium text-red-700 dark:text-red-400' : ''}
            >
              {l.employee}: licence {l.licenceNumber} {l.expired ? 'expired' : 'expires'}{' '}
              {l.expiresOn} ({dueText(l.daysLeft, l.expired)})
            </li>
          ))}
        </ul>
      </Card>

      {manage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Schedule a job">
            <form
              noValidate
              onSubmit={jobForm.handleSubmit((v) => createJob.mutate(v))}
              className="space-y-3"
            >
              {vehicleSelect('job', jobForm.formState.errors.vehicleId?.message)}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="job-kind" className="mb-1 block text-sm font-medium">
                    Type
                  </label>
                  <select
                    id="job-kind"
                    className={`${selectClass} w-full`}
                    {...jobForm.register('kind')}
                  >
                    <option value="SERVICE">Service</option>
                    <option value="REPAIR">Repair</option>
                    <option value="INSPECTION">Inspection</option>
                  </select>
                </div>
                <Field
                  label="Date"
                  type="date"
                  error={jobForm.formState.errors.scheduledFor?.message}
                  {...jobForm.register('scheduledFor')}
                />
              </div>
              <Field
                label="Description"
                error={jobForm.formState.errors.description?.message}
                {...jobForm.register('description')}
              />
              {createJob.error && <ErrorAlert error={createJob.error} />}
              <Button type="submit" loading={createJob.isPending} loadingText="Scheduling…">
                Schedule
              </Button>
            </form>
          </Card>
          <Card title="Record a vehicle document">
            <form
              noValidate
              onSubmit={docForm.handleSubmit((v) => addDoc.mutate(v))}
              className="space-y-3"
            >
              {vehicleSelect('doc', docForm.formState.errors.vehicleId?.message)}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="doc-kind" className="mb-1 block text-sm font-medium">
                    Type
                  </label>
                  <select
                    id="doc-kind"
                    className={`${selectClass} w-full`}
                    {...docForm.register('kind')}
                  >
                    <option value="INSURANCE">Insurance</option>
                    <option value="INSPECTION_CERTIFICATE">Inspection certificate</option>
                    <option value="ROAD_LICENCE">Road licence</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <Field
                  label="Expires on"
                  type="date"
                  error={docForm.formState.errors.expiresOn?.message}
                  {...docForm.register('expiresOn')}
                />
              </div>
              <Field
                label="Reference no."
                error={docForm.formState.errors.referenceNo?.message}
                {...docForm.register('referenceNo')}
              />
              {addDoc.error && <ErrorAlert error={addDoc.error} />}
              <Button type="submit" loading={addDoc.isPending} loadingText="Saving…">
                Save document
              </Button>
            </form>
          </Card>
        </div>
      )}

      <Card title="Jobs">
        {records.isPending && <PageLoader label="Loading jobs" />}
        {records.error && (
          <ErrorAlert error={records.error} onRetry={() => void records.refetch()} />
        )}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {records.data?.records.length === 0 && (
            <li className="py-2 text-slate-500">No maintenance jobs yet.</li>
          )}
          {records.data?.records.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {r.vehicle} · {title(r.kind)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.description} ·{' '}
                    {r.completedOn ? `done ${r.completedOn}` : `scheduled ${r.scheduledFor}`}
                    {r.costMinor !== null ? ` · cost ${(r.costMinor / 100).toFixed(2)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    status={
                      r.status === 'SCHEDULED'
                        ? 'PENDING'
                        : r.status === 'CANCELLED'
                          ? 'REJECTED'
                          : 'ACTIVE'
                    }
                    label={title(r.status)}
                  />
                  {manage && r.status === 'SCHEDULED' && (
                    <>
                      <Button
                        variant="secondary"
                        loading={
                          act.isPending &&
                          act.variables?.id === r.id &&
                          act.variables.action === 'start'
                        }
                        onClick={() => act.mutate({ id: r.id, action: 'start' })}
                      >
                        Start work
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => act.mutate({ id: r.id, action: 'cancel' })}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                  {manage && r.status === 'IN_PROGRESS' && (
                    <Button onClick={() => setCompleting(completing === r.id ? null : r.id)}>
                      Complete…
                    </Button>
                  )}
                </div>
              </div>
              {completing === r.id && (
                <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="w-40">
                    <Field
                      label="Odometer (km)"
                      type="number"
                      value={done.odometerKm}
                      onChange={(e) => setDone((d) => ({ ...d, odometerKm: e.target.value }))}
                    />
                  </div>
                  <div className="w-40">
                    <Field
                      label="Cost"
                      type="number"
                      step="0.01"
                      value={done.cost}
                      onChange={(e) => setDone((d) => ({ ...d, cost: e.target.value }))}
                    />
                  </div>
                  <Button
                    loading={
                      act.isPending &&
                      act.variables?.id === r.id &&
                      act.variables.action === 'complete'
                    }
                    loadingText="Saving…"
                    onClick={() => act.mutate({ id: r.id, action: 'complete' })}
                  >
                    Mark complete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {act.error && <Alert tone="error">{errMsg(act.error)}</Alert>}
      </Card>
    </div>
  );
}
