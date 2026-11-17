import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { useConfirm } from '../../components/ui/Confirm';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { useCompany } from './company-context';

const selectClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** What a person types ("1,500.50") as whole minor units; null when it is not an amount. */
export function toMinor(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
const fromMinor = (minor: number) => (minor / 100).toFixed(2);
const bps = (v: number) => `${(v / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

interface Allowance {
  id?: string;
  name: string;
  amountMinor: number;
}
interface Structure {
  id: string;
  name: string;
  baseMinor: number;
  description: string | null;
  allowances: Allowance[];
  grossMinor: number;
  staffCount: number;
}
interface Deduction {
  id: string;
  name: string;
  kind: 'FIXED' | 'PERCENT';
  value: number;
  description: string | null;
  staffCount: number;
}
interface StaffRow {
  id: string;
  staffNumber: string;
  fullName: string;
  job: string;
  structure: { id: string; name: string } | null;
  deductionIds: string[];
  deductionNames: string[];
  grossMinor: number;
  netMinor: number;
}
export interface Breakdown {
  currency: string;
  structure: { id: string; name: string } | null;
  baseMinor: number;
  allowances: { id: string; name: string; amountMinor: number }[];
  totalAllowancesMinor: number;
  grossMinor: number;
  deductions: {
    id: string;
    name: string;
    kind: 'FIXED' | 'PERCENT';
    value: number;
    amountMinor: number;
  }[];
  totalDeductionsMinor: number;
  netMinor: number;
}

/** The pay slip: base, each allowance, gross, each deduction and the take-home. */
export function PayBreakdown({ b }: { b: Breakdown }) {
  const row = (label: string, minor: number, opts: { sign?: '-' | '+'; strong?: boolean } = {}) => (
    <tr key={label} className={opts.strong ? 'font-semibold' : ''}>
      <td className="py-1.5 pr-4">{label}</td>
      <td className="tabular py-1.5 text-right">
        {opts.sign === '-' ? '− ' : ''}
        {money(minor, b.currency)}
      </td>
    </tr>
  );
  return (
    <div className="space-y-4 text-sm">
      <table className="w-full">
        <caption className="pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          Earnings
        </caption>
        <tbody>
          {row('Base pay', b.baseMinor)}
          {b.allowances.map((a) => row(a.name, a.amountMinor))}
          {row('Gross pay', b.grossMinor, { strong: true })}
        </tbody>
      </table>
      <table className="w-full">
        <caption className="pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          Deductions
        </caption>
        <tbody>
          {b.deductions.length === 0 && (
            <tr>
              <td className="py-1.5 text-slate-500" colSpan={2}>
                No deductions.
              </td>
            </tr>
          )}
          {b.deductions.map((d) =>
            row(
              d.kind === 'PERCENT' ? `${d.name} (${bps(d.value)} of gross)` : d.name,
              d.amountMinor,
              {
                sign: '-',
              },
            ),
          )}
          {row('Total deductions', b.totalDeductionsMinor, { sign: '-', strong: true })}
        </tbody>
      </table>
      <p className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 text-base font-bold dark:bg-slate-800">
        <span>Net pay</span>
        <span className="tabular">{money(b.netMinor, b.currency)}</span>
      </p>
    </div>
  );
}

/** Every staff role sees this in the sidebar: their own pay, broken down. Nobody else's. */
export function MySalaryPage() {
  const { tenantId } = useCompany();
  const q = useQuery({
    queryKey: ['company', tenantId, 'salary', 'mine'],
    queryFn: ({ signal }) =>
      api<
        | { assigned: false; reason: 'no-profile' | 'no-structure' }
        | ({
            assigned: true;
            staff: { fullName: string; staffNumber: string; job: string };
          } & Breakdown)
      >(`/tenants/${tenantId}/salary/mine`, { signal }),
  });
  return (
    <div className="w-full max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">My salary</h1>
      {q.isPending && <PageLoader label="Loading your salary" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.assigned && (
        <Alert tone="info">
          {q.data.reason === 'no-profile'
            ? 'You do not have a staff profile yet, so there is no salary to show.'
            : 'No salary has been set for you yet. The finance officer will assign it.'}
        </Alert>
      )}
      {q.data?.assigned && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {q.data.staff.fullName} · staff number {q.data.staff.staffNumber} · salary structure{' '}
            <strong>{q.data.structure?.name}</strong>
          </p>
          <div className="mt-4">
            <PayBreakdown b={q.data} />
          </div>
        </Card>
      )}
    </div>
  );
}

/** The finance officer's salary desk: structures, deductions, and who gets what. */
export function SalariesPage() {
  const [tab, setTab] = useState<'staff' | 'structures' | 'deductions'>('staff');
  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Salaries</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Set up salary structures with allowances, create deductions, and assign them to staff.
          Each staff member sees their own breakdown under My salary.
        </p>
      </div>
      <div role="tablist" aria-label="Salaries" className="flex flex-wrap gap-2">
        {(
          [
            ['staff', 'Staff salaries'],
            ['structures', 'Salary structures'],
            ['deductions', 'Deductions'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-lg px-4 text-sm font-medium ${tab === k ? 'bg-brand-600 text-white' : 'border border-slate-300 dark:border-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'structures' && <StructuresTab />}
      {tab === 'deductions' && <DeductionsTab />}
      {tab === 'staff' && <StaffTab />}
    </div>
  );
}

// ---- Structures ----------------------------------------------------------------------------------

function StructuresTab() {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const ask = useConfirm();
  const base = `/tenants/${tenantId}/salary`;
  const q = useQuery({
    queryKey: ['company', tenantId, 'salary', 'structures'],
    queryFn: ({ signal }) =>
      api<{ currency: string; structures: Structure[] }>(`${base}/structures`, { signal }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'salary'] });
  const [editing, setEditing] = useState<Structure | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/structures/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Salary structure deleted', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const cur = q.data?.currency ?? '';
  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.8} />
          New salary structure
        </Button>
      </div>
      {q.isPending && <PageLoader label="Loading structures" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.structures.length === 0 && (
        <Alert tone="info">
          No salary structures yet. A structure is a base pay plus allowances, for example “Driver”
          or “Office staff”.
        </Alert>
      )}
      <ul className="space-y-3">
        {q.data?.structures.map((s) => (
          <li key={s.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{s.name}</h2>
                  {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
                  <p className="mt-1 text-sm">
                    Base {money(s.baseMinor, cur)}
                    {s.allowances.length > 0 &&
                      ` + ${s.allowances.map((a) => `${a.name} ${money(a.amountMinor, cur)}`).join(', ')}`}
                  </p>
                  <p className="text-sm font-medium">
                    Gross {money(s.grossMinor, cur)} · {s.staffCount} staff
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                  <Button
                    variant="dangerQuiet"
                    loading={remove.isPending && remove.variables === s.id}
                    onClick={async () => {
                      if (
                        await ask({
                          title: `Delete “${s.name}”?`,
                          message: 'This cannot be undone.',
                          confirmLabel: 'Delete',
                          danger: true,
                        })
                      )
                        remove.mutate(s.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <StructureDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        value={editing}
        currency={cur}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    </>
  );
}

function StructureDialog({
  value,
  currency,
  onClose,
  onSaved,
}: {
  value: Structure | 'new' | null;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const existing = value && value !== 'new' ? value : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [baseText, setBaseText] = useState(existing ? fromMinor(existing.baseMinor) : '');
  const [allowances, setAllowances] = useState<{ name: string; amount: string }[]>(
    existing?.allowances.map((a) => ({ name: a.name, amount: fromMinor(a.amountMinor) })) ?? [],
  );
  const base = toMinor(baseText);
  const parsed = allowances.map((a) => ({ name: a.name.trim(), amountMinor: toMinor(a.amount) }));
  const valid =
    name.trim().length >= 2 &&
    base !== null &&
    parsed.every((a) => a.name.length >= 2 && a.amountMinor !== null);
  const save = useMutation({
    mutationFn: () =>
      api(
        existing
          ? `/tenants/${tenantId}/salary/structures/${existing.id}`
          : `/tenants/${tenantId}/salary/structures`,
        {
          method: existing ? 'PUT' : 'POST',
          body: {
            name: name.trim(),
            baseMinor: base,
            ...(description.trim() ? { description: description.trim() } : {}),
            allowances: parsed,
          },
        },
      ),
    onSuccess: async () => {
      toast('Salary structure saved', 'success');
      await onSaved();
    },
  });
  return (
    <Dialog
      open={value !== null}
      title={existing ? 'Edit salary structure' : 'New salary structure'}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
      >
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label={`Base pay (${currency})`}
          inputMode="decimal"
          value={baseText}
          onChange={(e) => setBaseText(e.target.value)}
          error={baseText && base === null ? 'Enter an amount, e.g. 1500.00' : undefined}
        />
        <Field
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="space-y-2">
          <p className="text-sm font-semibold">Allowances</p>
          {allowances.map((a, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <Field
                  label={`Allowance ${i + 1}`}
                  placeholder="e.g. Transport"
                  value={a.name}
                  onChange={(e) =>
                    setAllowances((l) =>
                      l.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
              </div>
              <div className="w-36">
                <Field
                  label={`Amount (${currency})`}
                  inputMode="decimal"
                  value={a.amount}
                  onChange={(e) =>
                    setAllowances((l) =>
                      l.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                  error={a.amount && toMinor(a.amount) === null ? 'Invalid' : undefined}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove allowance ${i + 1}`}
                onClick={() => setAllowances((l) => l.filter((_, n) => n !== i))}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={allowances.length >= 30}
            onClick={() => setAllowances((l) => [...l, { name: '', amount: '' }])}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add allowance
          </Button>
        </div>
        {save.error && <ErrorAlert error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={save.isPending} loadingText="Saving…">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- Deductions ----------------------------------------------------------------------------------

function DeductionsTab() {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const ask = useConfirm();
  const base = `/tenants/${tenantId}/salary`;
  const q = useQuery({
    queryKey: ['company', tenantId, 'salary', 'deductions'],
    queryFn: ({ signal }) =>
      api<{ currency: string; deductions: Deduction[] }>(`${base}/deductions`, { signal }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'salary'] });
  const [editing, setEditing] = useState<Deduction | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/deductions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Deduction deleted', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const cur = q.data?.currency ?? '';
  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.8} />
          New deduction
        </Button>
      </div>
      {q.isPending && <PageLoader label="Loading deductions" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.deductions.length === 0 && (
        <Alert tone="info">
          No deductions yet. Create ones like “Pension” (a percentage) or “Loan repayment” (a fixed
          amount) and assign them to staff.
        </Alert>
      )}
      <ul className="space-y-3">
        {q.data?.deductions.map((d) => (
          <li key={d.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{d.name}</h2>
                  {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
                  <p className="text-sm">
                    {d.kind === 'PERCENT'
                      ? `${bps(d.value)} of gross pay`
                      : `${money(d.value, cur)} fixed`}{' '}
                    · assigned to {d.staffCount} staff
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(d)}>
                    Edit
                  </Button>
                  <Button
                    variant="dangerQuiet"
                    loading={remove.isPending && remove.variables === d.id}
                    onClick={async () => {
                      if (
                        await ask({
                          title: `Delete “${d.name}”?`,
                          message: 'It is also removed from every staff member it was assigned to.',
                          confirmLabel: 'Delete',
                          danger: true,
                        })
                      )
                        remove.mutate(d.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <DeductionDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        value={editing}
        currency={cur}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    </>
  );
}

function DeductionDialog({
  value,
  currency,
  onClose,
  onSaved,
}: {
  value: Deduction | 'new' | null;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const existing = value && value !== 'new' ? value : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [kind, setKind] = useState<'FIXED' | 'PERCENT'>(existing?.kind ?? 'PERCENT');
  const [amount, setAmount] = useState(
    existing
      ? existing.kind === 'FIXED'
        ? fromMinor(existing.value)
        : String(existing.value / 100)
      : '',
  );
  const num =
    kind === 'FIXED'
      ? toMinor(amount)
      : /^\d+(\.\d{1,2})?$/.test(amount.trim())
        ? Math.round(Number(amount) * 100)
        : null;
  const valid = name.trim().length >= 2 && num !== null && (kind === 'FIXED' || num <= 10_000);
  const save = useMutation({
    mutationFn: () =>
      api(
        existing
          ? `/tenants/${tenantId}/salary/deductions/${existing.id}`
          : `/tenants/${tenantId}/salary/deductions`,
        {
          method: existing ? 'PUT' : 'POST',
          body: {
            name: name.trim(),
            kind,
            value: num,
            ...(description.trim() ? { description: description.trim() } : {}),
          },
        },
      ),
    onSuccess: async () => {
      toast('Deduction saved', 'success');
      await onSaved();
    },
  });
  return (
    <Dialog
      open={value !== null}
      title={existing ? 'Edit deduction' : 'New deduction'}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
      >
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <label htmlFor="dd-kind" className="mb-1 block text-sm font-semibold">
            Type
          </label>
          <select
            id="dd-kind"
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'FIXED' | 'PERCENT')}
          >
            <option value="PERCENT">Percentage of gross pay</option>
            <option value="FIXED">Fixed amount</option>
          </select>
        </div>
        <Field
          label={kind === 'PERCENT' ? 'Percentage (%)' : `Amount (${currency})`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={
            amount && num === null
              ? 'Enter a number'
              : kind === 'PERCENT' && num !== null && num > 10_000
                ? 'At most 100%'
                : undefined
          }
        />
        <Field
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {save.error && <ErrorAlert error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={save.isPending} loadingText="Saving…">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- Staff ---------------------------------------------------------------------------------------

function StaffTab() {
  const { tenantId } = useCompany();
  const base = `/tenants/${tenantId}/salary`;
  const staff = useQuery({
    queryKey: ['company', tenantId, 'salary', 'staff'],
    queryFn: ({ signal }) =>
      api<{ currency: string; staff: StaffRow[] }>(`${base}/staff`, { signal }),
  });
  const [assignFor, setAssignFor] = useState<StaffRow | null>(null);
  const [viewFor, setViewFor] = useState<StaffRow | null>(null);
  const cur = staff.data?.currency ?? '';
  return (
    <>
      {staff.isPending && <PageLoader label="Loading staff" />}
      {staff.error && <ErrorAlert error={staff.error} onRetry={() => void staff.refetch()} />}
      {staff.data?.staff.length === 0 && (
        <Alert tone="info">No staff profiles yet. Staff appear here once they are hired.</Alert>
      )}
      <ul className="space-y-3">
        {staff.data?.staff.map((p) => (
          <li key={p.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{p.fullName}</h2>
                  <p className="text-xs text-slate-500">
                    Staff number {p.staffNumber} · {p.job.toLowerCase()}
                  </p>
                  <p className="mt-1 text-sm">
                    {p.structure ? (
                      <>
                        Structure <strong>{p.structure.name}</strong>
                        {p.deductionNames.length > 0 &&
                          ` · deductions: ${p.deductionNames.join(', ')}`}
                      </>
                    ) : (
                      <span className="text-slate-500">No salary structure assigned</span>
                    )}
                  </p>
                  {p.structure && (
                    <p className="text-sm font-medium">
                      Gross {money(p.grossMinor, cur)} · Net {money(p.netMinor, cur)}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {p.structure && (
                    <Button variant="ghost" onClick={() => setViewFor(p)}>
                      Breakdown
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setAssignFor(p)}>
                    Assign
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <AssignDialog
        key={assignFor?.id ?? 'none'}
        person={assignFor}
        onClose={() => setAssignFor(null)}
      />
      <BreakdownDialog person={viewFor} onClose={() => setViewFor(null)} />
    </>
  );
}

function AssignDialog({ person, onClose }: { person: StaffRow | null; onClose: () => void }) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const base = `/tenants/${tenantId}/salary`;
  const structures = useQuery({
    queryKey: ['company', tenantId, 'salary', 'structures'],
    queryFn: ({ signal }) =>
      api<{ currency: string; structures: Structure[] }>(`${base}/structures`, { signal }),
    enabled: person !== null,
  });
  const deductions = useQuery({
    queryKey: ['company', tenantId, 'salary', 'deductions'],
    queryFn: ({ signal }) =>
      api<{ currency: string; deductions: Deduction[] }>(`${base}/deductions`, { signal }),
    enabled: person !== null,
  });
  const [structureId, setStructureId] = useState(person?.structure?.id ?? '');
  const [picked, setPicked] = useState<string[]>(person?.deductionIds ?? []);
  const save = useMutation({
    mutationFn: () =>
      api(`${base}/staff/${person!.id}`, {
        method: 'PUT',
        body: { structureId: structureId || null, deductionIds: picked },
      }),
    onSuccess: async () => {
      toast('Salary assigned', 'success');
      await qc.invalidateQueries({ queryKey: ['company', tenantId, 'salary'] });
      onClose();
    },
  });
  const cur = deductions.data?.currency ?? '';
  return (
    <Dialog
      open={person !== null}
      title={person ? `Assign salary: ${person.fullName}` : 'Assign salary'}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <div>
          <label htmlFor="as-struct" className="mb-1 block text-sm font-semibold">
            Salary structure
          </label>
          <select
            id="as-struct"
            className={selectClass}
            value={structureId}
            onChange={(e) => setStructureId(e.target.value)}
          >
            <option value="">None</option>
            {structures.data?.structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (gross {money(s.grossMinor, structures.data.currency)})
              </option>
            ))}
          </select>
          {structures.data?.structures.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">Create a salary structure first.</p>
          )}
        </div>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-semibold">Deductions</legend>
          {deductions.data?.deductions.length === 0 && (
            <p className="text-xs text-slate-500">No deductions have been created.</p>
          )}
          {deductions.data?.deductions.map((d) => (
            <label key={d.id} className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(d.id)}
                onChange={(e) =>
                  setPicked((l) => (e.target.checked ? [...l, d.id] : l.filter((x) => x !== d.id)))
                }
              />
              {d.name} ({d.kind === 'PERCENT' ? bps(d.value) : money(d.value, cur)})
            </label>
          ))}
        </fieldset>
        {save.error && <ErrorAlert error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} loadingText="Saving…">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BreakdownDialog({ person, onClose }: { person: StaffRow | null; onClose: () => void }) {
  const { tenantId } = useCompany();
  const q = useQuery({
    queryKey: ['company', tenantId, 'salary', 'staff', person?.id],
    enabled: person !== null,
    queryFn: ({ signal }) =>
      api<Breakdown>(`/tenants/${tenantId}/salary/staff/${person!.id}`, { signal }),
  });
  return (
    <Dialog
      open={person !== null}
      title={person ? `Salary breakdown: ${person.fullName}` : 'Salary breakdown'}
      onClose={onClose}
    >
      {q.isPending && <PageLoader label="Loading" />}
      {q.error && <ErrorAlert error={q.error} />}
      {q.data && <PayBreakdown b={q.data} />}
    </Dialog>
  );
}
