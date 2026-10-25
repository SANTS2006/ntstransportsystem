import { zodResolver } from '@hookform/resolvers/zod';
import { DEFAULT_TENANT_ROLES } from '@nts/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, StatusBadge } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { ModalCard } from '../../components/ui/ModalCard';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { can, useCompany } from './company-context';

export interface StaffEmployee {
  id: string;
  employeeNumber: string;
  job: string;
  status: string;
  hiredOn: string | null;
  licenceExpiresOn: string | null;
}
export interface Member {
  id: string;
  userId: string;
  email: string;
  phone: string | null;
  displayName: string;
  status: string;
  createdAt: string;
  role: { id: string; key: string; name: string };
  roles: { id: string; key: string; name: string }[];
  passengerMode: boolean;
  employee: StaffEmployee | null;
}

const selectClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900';
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const DEFAULT_ROLE_OPTIONS = Object.entries(DEFAULT_TENANT_ROLES).map(([key, r]) => ({
  key,
  name: r.name,
}));

// ---- Add a staff member -------------------------------------------------------------------------

const addSchema = z.object({
  employeeNumber: z.string().trim().min(1, 'Enter the staff number').max(30),
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  roleKey: z.string().min(1, 'Choose a role'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === '' || /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a valid phone number'),
});
type AddValues = z.infer<typeof addSchema>;

/** Adds a person to the team: they get an account and an email with their details and first password. */
export function AddStaffButton({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // The company's own roles when the person may read them; the standard roles otherwise.
  const roles = useQuery({
    queryKey: ['company', tenantId, 'roles'],
    enabled: can(access, 'role.read'),
    queryFn: ({ signal }) =>
      api<{ roles: { id: string; key: string; name: string }[] }>(`/tenants/${tenantId}/roles`, {
        signal,
      }),
  });
  const options = roles.data?.roles ?? DEFAULT_ROLE_OPTIONS;
  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { employeeNumber: '', fullName: '', roleKey: '', email: '', phone: '' },
  });
  const create = useMutation({
    mutationFn: (v: AddValues) =>
      api(`/tenants/${tenantId}/employees`, {
        method: 'POST',
        body: { ...v, phone: v.phone.replace(/[ ()-]/g, '') || undefined },
      }),
    onSuccess: async () => {
      toast('Staff member added. They have been emailed their sign-in details.', 'success');
      form.reset();
      setOpen(false);
      await onAdded();
    },
  });
  const { errors } = form.formState;
  return (
    <ModalCard title="Add a staff member" open={open} onOpenChange={setOpen}>
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => create.mutate(v))}
        className="grid gap-4 sm:grid-cols-2"
      >
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-slate-700 sm:col-span-2 dark:bg-slate-800 dark:text-slate-200">
          We email the new team member their details, a first password and a link to your company
          page, where they sign in and choose their own password.
        </p>
        <Field label="Full name" error={errors.fullName?.message} {...form.register('fullName')} />
        <Field
          label="Staff number"
          error={errors.employeeNumber?.message}
          {...form.register('employeeNumber')}
        />
        <Field
          label="Email address"
          type="email"
          autoComplete="off"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <Field
          label="Phone number"
          type="tel"
          autoComplete="off"
          placeholder="+232 76 123456"
          error={errors.phone?.message}
          {...form.register('phone')}
        />
        <div className="sm:col-span-2">
          <label htmlFor="staff-role" className="mb-1 block text-sm font-semibold">
            Role
          </label>
          <select
            id="staff-role"
            className={selectClass}
            aria-invalid={errors.roleKey ? true : undefined}
            {...form.register('roleKey')}
          >
            <option value="">Choose…</option>
            {options.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          {errors.roleKey && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {errors.roleKey.message}
            </p>
          )}
        </div>
        {create.error && (
          <div className="sm:col-span-2">
            <ErrorAlert error={create.error} />
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} loadingText="Adding…">
            Add staff member
          </Button>
        </div>
      </form>
    </ModalCard>
  );
}

// ---- Details ------------------------------------------------------------------------------------

const licenceSchema = z.object({
  licenceNumber: z.string().trim().min(3, 'Enter the licence number').max(40),
  category: z.string().trim().min(1, 'Category').max(20),
  expiresOn: z.string().min(1, 'Choose the expiry date'),
});
type LicenceValues = z.infer<typeof licenceSchema>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Everything known about one staff member, in a pop-up. HR can also update their job record here. */
export function StaffDetailsDialog({
  member,
  onClose,
  onChanged,
}: {
  member: Member | null;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const manage = can(access, 'hr.manage');
  const [licence, setLicence] = useState(false);
  const e = member?.employee ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<LicenceValues>({
    resolver: zodResolver(licenceSchema),
    defaultValues: { licenceNumber: '', category: 'D', expiresOn: '' },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) =>
      api(`/tenants/${tenantId}/employees/${e!.id}`, { method: 'PATCH', body: { status } }),
    onSuccess: async () => {
      toast('Status updated', 'success');
      await onChanged();
      await qc.invalidateQueries({ queryKey: ['company', tenantId] });
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Could not update', 'error'),
  });
  const addLicence = useMutation({
    mutationFn: (v: LicenceValues) =>
      api(`/tenants/${tenantId}/employees/${e!.id}/licences`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Licence recorded', 'success');
      form.reset();
      setLicence(false);
      await onChanged();
    },
  });
  return (
    <Dialog open={member !== null} title="Staff details" onClose={onClose}>
      {member && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-600 text-xl font-bold text-white"
            >
              {member.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="break-words text-lg font-semibold [overflow-wrap:anywhere]">
                {member.displayName}
              </p>
              <StatusBadge status={member.status === 'ACTIVE' ? 'ACTIVE' : 'DEACTIVATED'} />
            </div>
          </div>
          <dl className="space-y-3">
            <Row label="Email">{member.email}</Row>
            <Row label="Phone">
              {member.phone ?? <span className="text-slate-500">Not provided</span>}
            </Row>
            <Row label="Roles">
              <span className="flex flex-wrap gap-1.5">
                {member.roles.map((r) => (
                  <Badge
                    key={r.id}
                    tone={r.id === member.role.id && !member.passengerMode ? 'green' : 'slate'}
                    icon={null}
                  >
                    {r.name}
                  </Badge>
                ))}
                {member.passengerMode && (
                  <Badge tone="amber" icon={null}>
                    Acting as passenger
                  </Badge>
                )}
              </span>
            </Row>
            <Row label="Joined">{new Date(member.createdAt).toLocaleDateString()}</Row>
            {e && (
              <>
                <Row label="Staff number">{e.employeeNumber}</Row>
                <Row label="Job">{title(e.job)}</Row>
                <Row label="Employment">
                  {manage && e.status !== 'TERMINATED' ? (
                    <select
                      aria-label={`Status for ${member.displayName}`}
                      className={selectClass}
                      value={e.status}
                      disabled={setStatus.isPending}
                      onChange={(ev) => setStatus.mutate(ev.target.value)}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="ON_LEAVE">On leave</option>
                      <option value="TERMINATED">Terminate…</option>
                    </select>
                  ) : (
                    title(e.status)
                  )}
                </Row>
                <Row label="Hired on">{e.hiredOn ?? '—'}</Row>
                {e.job === 'DRIVER' && (
                  <Row label="Licence">
                    {e.licenceExpiresOn
                      ? `Valid to ${e.licenceExpiresOn}${e.licenceExpiresOn < today ? ' (expired)' : ''}`
                      : 'No licence recorded'}
                  </Row>
                )}
              </>
            )}
          </dl>
          {manage && e && e.job === 'DRIVER' && e.status !== 'TERMINATED' && (
            <div className="space-y-3">
              {!licence ? (
                <Button variant="secondary" onClick={() => setLicence(true)}>
                  Add licence
                </Button>
              ) : (
                <form
                  noValidate
                  onSubmit={form.handleSubmit((v) => addLicence.mutate(v))}
                  className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 dark:bg-slate-800"
                >
                  <Field
                    label="Licence number"
                    error={form.formState.errors.licenceNumber?.message}
                    {...form.register('licenceNumber')}
                  />
                  <Field
                    label="Category"
                    error={form.formState.errors.category?.message}
                    {...form.register('category')}
                  />
                  <div className="sm:col-span-2">
                    <Field
                      label="Expires on"
                      type="date"
                      error={form.formState.errors.expiresOn?.message}
                      {...form.register('expiresOn')}
                    />
                  </div>
                  {addLicence.error && (
                    <div className="sm:col-span-2">
                      <ErrorAlert error={addLicence.error} />
                    </div>
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={() => setLicence(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={addLicence.isPending} loadingText="Saving…">
                      Save licence
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
