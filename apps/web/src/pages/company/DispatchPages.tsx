import { zodResolver } from '@hookform/resolvers/zod';
import { ModalCard } from '../../components/ui/ModalCard';
import { useConfirm } from '../../components/ui/Confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useRoutes, useSeatLayouts, useVehicles } from './CatalogPages';
import { can, useCompany } from './company-context';

const selectClass =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const today = () => new Date().toISOString().slice(0, 10);

const FLAG_TEXT: Record<string, string> = {
  NO_VEHICLE: 'No vehicle',
  NO_DRIVER: 'No driver',
  DELAYED: 'Delayed',
  VEHICLE_DOCUMENT_EXPIRED: 'Vehicle document expired',
};
const EVENT_TEXT: Record<string, string> = {
  STATUS_CHANGED: 'Status changed',
  DELAY_SET: 'Delay updated',
  VEHICLE_ASSIGNED: 'Vehicle assigned',
  VEHICLE_REPLACED: 'Vehicle replaced',
  CREW_ASSIGNED: 'Crew assigned',
  CREW_RELEASED: 'Crew released',
  NOTE: 'Note',
};

interface BoardTrip {
  id: string;
  route: string;
  departureAt: string;
  arrivalAt: string;
  status: string;
  delayMinutes: number;
  vehicle: { id: string; registration: string; seats: number } | null;
  crew: { employeeId: string; fullName: string; role: string }[];
  flags: string[];
}
interface Board {
  date: string;
  summary: { total: number; byStatus: Record<string, number>; needingAttention: number };
  trips: BoardTrip[];
}
interface TripEvent {
  id: string;
  kind: string;
  details: Record<string, unknown>;
  at: string;
}

const replaceSchema = z.object({
  vehicleId: z.string().min(1, 'Choose the replacement vehicle'),
  reason: z.string().trim().min(2, 'Say why').max(300),
  markOldOutOfService: z.boolean(),
});
type ReplaceValues = z.infer<typeof replaceSchema>;

function Timeline({ tripId, fmt }: { tripId: string; fmt: (iso: string) => string }) {
  const { tenantId } = useCompany();
  const q = useQuery({
    queryKey: ['company', tenantId, 'trip-events', tripId],
    queryFn: ({ signal }) =>
      api<{ items: TripEvent[] }>(`/tenants/${tenantId}/trips/${tripId}/events`, { signal }),
  });
  if (q.isPending) return <PageLoader label="Loading timeline" />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0) return <p className="text-xs text-slate-500">No events yet.</p>;
  return (
    <ol className="space-y-1 text-xs">
      {q.data.items.map((e) => (
        <li key={e.id}>
          <span className="text-slate-500">{fmt(e.at)}</span> · {EVENT_TEXT[e.kind] ?? e.kind}
          {e.details.reason ? ` — ${String(e.details.reason)}` : ''}
          {e.kind === 'DELAY_SET' ? ` (${String(e.details.to)} min)` : ''}
        </li>
      ))}
    </ol>
  );
}

export function DispatchPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const manage = can(access, 'trip.manage');
  const [date, setDate] = useState(today());
  const [openTimeline, setOpenTimeline] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<BoardTrip | null>(null);
  const vehicles = useVehicles();
  const active = vehicles.data?.vehicles.filter((v) => v.status === 'ACTIVE') ?? [];

  const profile = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<{ timezone: string }>(`/tenants/${tenantId}/profile`, { signal }),
  });
  const tz = profile.data?.timezone ?? 'UTC';
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: tz, timeStyle: 'short' }).format(new Date(iso));

  const board = useQuery({
    queryKey: ['company', tenantId, 'board', date],
    queryFn: ({ signal }) =>
      api<Board>(`/tenants/${tenantId}/dispatch/board?date=${date}`, { signal }),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });

  const delay = useMutation({
    mutationFn: (v: { id: string; delayMinutes: number }) =>
      api(`/tenants/${tenantId}/trips/${v.id}/delay`, {
        method: 'POST',
        body: { delayMinutes: v.delayMinutes },
      }),
    onSuccess: async () => {
      toast('Delay recorded', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const form = useForm<ReplaceValues>({
    resolver: zodResolver(replaceSchema),
    defaultValues: { vehicleId: '', reason: '', markOldOutOfService: true },
  });
  const replace = useMutation({
    mutationFn: (v: ReplaceValues) =>
      api<{ capacityReduced: boolean; oldVehicleOtherTrips: number }>(
        `/tenants/${tenantId}/trips/${replacing?.id}/replace-vehicle`,
        { method: 'POST', body: v },
      ),
    onSuccess: async (r) => {
      toast(
        r.capacityReduced
          ? 'Vehicle replaced. The new vehicle has fewer seats.'
          : 'Vehicle replaced',
        r.capacityReduced ? 'info' : 'success',
      );
      if (r.oldVehicleOtherTrips > 0) {
        toast(`The old vehicle is still on ${r.oldVehicleOtherTrips} upcoming trip(s).`, 'info');
      }
      setReplacing(null);
      form.reset();
      await refresh();
    },
  });
  const { errors } = form.formState;

  return (
    <div className="mx-auto w-[90%] space-y-6">
      <h1 className="text-2xl font-semibold">Dispatch board</h1>
      <p className="text-xs text-slate-500">Times shown in {tz}. Updates every minute.</p>
      <div className="w-48">
        <Field
          label="Service date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {board.isPending && <PageLoader label="Loading the board" />}
      {board.error && <ErrorAlert error={board.error} onRetry={() => void board.refetch()} />}
      {board.data && (
        <>
          <p className="text-sm" aria-live="polite">
            {board.data.summary.total} trip(s)
            {board.data.summary.needingAttention > 0
              ? ` · ${board.data.summary.needingAttention} need attention`
              : ' · nothing needs attention'}
          </p>
          <Card>
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {board.data.trips.length === 0 && (
                <li className="py-2 text-slate-500">No trips on this date.</li>
              )}
              {board.data.trips.map((t) => (
                <li key={t.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {time(t.departureAt)} · {t.route}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t.vehicle
                          ? `${t.vehicle.registration} (${t.vehicle.seats} seats)`
                          : 'No vehicle'}
                        {' · '}
                        {t.crew.length
                          ? t.crew.map((c) => `${c.fullName} (${c.role.toLowerCase()})`).join(', ')
                          : 'No crew'}
                        {t.delayMinutes ? ` · delayed ${t.delayMinutes} min` : ''}
                      </p>
                      {t.flags.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {t.flags.map((f) => (
                            <span
                              key={f}
                              className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                            >
                              {FLAG_TEXT[f] ?? f}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        status={
                          t.status === 'SCHEDULED'
                            ? 'PENDING'
                            : t.status === 'CANCELLED'
                              ? 'REJECTED'
                              : 'ACTIVE'
                        }
                        label={
                          t.status.charAt(0) + t.status.slice(1).toLowerCase().replace('_', ' ')
                        }
                      />
                      {manage && ['SCHEDULED', 'BOARDING', 'IN_TRANSIT'].includes(t.status) && (
                        <>
                          <select
                            aria-label={`Delay for ${t.route} at ${time(t.departureAt)}`}
                            className={selectClass}
                            value={t.delayMinutes}
                            disabled={delay.isPending}
                            onChange={(e) =>
                              delay.mutate({ id: t.id, delayMinutes: Number(e.target.value) })
                            }
                          >
                            {[...new Set([0, 10, 15, 30, 45, 60, 90, 120, t.delayMinutes])]
                              .sort((a, b) => a - b)
                              .map((m) => (
                                <option key={m} value={m}>
                                  {m === 0 ? 'On time' : `Delay ${m} min`}
                                </option>
                              ))}
                          </select>
                          <Button variant="secondary" onClick={() => setReplacing(t)}>
                            Replace vehicle
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => setOpenTimeline(openTimeline === t.id ? null : t.id)}
                      >
                        Timeline
                      </Button>
                    </div>
                  </div>
                  {openTimeline === t.id && <Timeline tripId={t.id} fmt={fmt} />}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Dialog
        open={replacing !== null}
        title="Replace vehicle"
        onClose={() => {
          setReplacing(null);
          replace.reset();
        }}
      >
        {replacing && (
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => replace.mutate(v))}
            className="space-y-3"
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {replacing.route} at {time(replacing.departureAt)}
              {replacing.vehicle ? ` — currently ${replacing.vehicle.registration}` : ''}
            </p>
            <div>
              <label htmlFor="rep-veh" className="mb-1 block text-sm font-medium">
                New vehicle
              </label>
              <select
                id="rep-veh"
                className={`${selectClass} w-full`}
                {...form.register('vehicleId')}
              >
                <option value="">Choose…</option>
                {active
                  .filter((v) => v.id !== replacing.vehicle?.id)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registration} ({v.seatingCapacity} seats)
                    </option>
                  ))}
              </select>
              {errors.vehicleId && (
                <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
                  {errors.vehicleId.message}
                </p>
              )}
            </div>
            <Field label="Reason" error={errors.reason?.message} {...form.register('reason')} />
            {replacing.vehicle && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" {...form.register('markOldOutOfService')} />
                Take {replacing.vehicle.registration} out of service
              </label>
            )}
            {replace.error && <ErrorAlert error={replace.error} />}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReplacing(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={replace.isPending} loadingText="Replacing…">
                Replace
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

// ---- Service calendar ------------------------------------------------------------------------

interface Blackout {
  id: string;
  routeId: string | null;
  route: string | null;
  startsOn: string;
  endsOn: string;
  reason: string;
}
const blackoutSchema = z
  .object({
    routeId: z.string().optional(),
    startsOn: z.string().min(1, 'Choose a start date'),
    endsOn: z.string().min(1, 'Choose an end date'),
    reason: z.string().trim().min(2, 'Say why').max(200),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    path: ['endsOn'],
    message: 'Must not be before the start date',
  });
type BlackoutValues = z.infer<typeof blackoutSchema>;

export function CalendarPage() {
  const [adding376, setAdding376] = useState(false);
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const manage = can(access, 'route.manage');
  const routes = useRoutes();
  const list = useQuery({
    queryKey: ['company', tenantId, 'blackouts'],
    queryFn: ({ signal }) =>
      api<{ items: Blackout[] }>(`/tenants/${tenantId}/calendar/blackouts?from=${today()}`, {
        signal,
      }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'blackouts'] });
  const [notice, setNotice] = useState<string | null>(null);
  const form = useForm<BlackoutValues>({
    resolver: zodResolver(blackoutSchema),
    defaultValues: { routeId: '', startsOn: today(), endsOn: today(), reason: '' },
  });
  const create = useMutation({
    mutationFn: (v: BlackoutValues) =>
      api<{ id: string; openTripsAffected: number }>(`/tenants/${tenantId}/calendar/blackouts`, {
        method: 'POST',
        body: { ...v, routeId: v.routeId || undefined },
      }),
    onSuccess: async (r) => {
      toast('Blackout added', 'success');
      setNotice(
        r.openTripsAffected > 0
          ? `${r.openTripsAffected} open trip(s) fall inside these dates. They were not cancelled: review them on the dispatch board.`
          : null,
      );
      form.reset();
      setAdding376(false);
      await refresh();
    },
  });
  const ask = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/tenants/${tenantId}/calendar/blackouts/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Blackout removed', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const { errors } = form.formState;
  return (
    <div className="mx-auto w-[90%] space-y-6">
      <h1 className="text-2xl font-semibold">Service calendar</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Dates on which no trips are generated, for every route or just one. Holidays, strikes, road
        works.
      </p>
      {manage && (
        <ModalCard title="Add a blackout" open={adding376} onOpenChange={setAdding376}>
          {notice && <Alert tone="info">{notice}</Alert>}
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="mt-3 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="From"
                type="date"
                error={errors.startsOn?.message}
                {...form.register('startsOn')}
              />
              <Field
                label="To"
                type="date"
                error={errors.endsOn?.message}
                {...form.register('endsOn')}
              />
              <div>
                <label htmlFor="bo-route" className="mb-1 block text-sm font-medium">
                  Applies to
                </label>
                <select
                  id="bo-route"
                  className={`${selectClass} w-full`}
                  {...form.register('routeId')}
                >
                  <option value="">All routes</option>
                  {routes.data?.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <Field label="Reason" error={errors.reason?.message} {...form.register('reason')} />
            </div>
            {create.error && <ErrorAlert error={create.error} />}
            <Button type="submit" loading={create.isPending} loadingText="Adding…">
              Add blackout
            </Button>
          </form>
        </ModalCard>
      )}
      <Card title="Upcoming blackouts">
        {list.isPending && <PageLoader label="Loading blackouts" />}
        {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {list.data?.items.length === 0 && (
            <li className="py-2 text-slate-500">None scheduled.</li>
          )}
          {list.data?.items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {b.startsOn === b.endsOn ? b.startsOn : `${b.startsOn} → ${b.endsOn}`}
                </p>
                <p className="text-xs text-slate-500">
                  {b.reason} · {b.route ?? 'All routes'}
                </p>
              </div>
              {manage && (
                <Button
                  variant="ghost"
                  loading={remove.isPending && remove.variables === b.id}
                  onClick={async () => {
                    if (
                      await ask({
                        title: 'Remove this blackout?',
                        message: 'Trips can be scheduled on those days again.',
                        confirmLabel: 'Remove',
                        danger: true,
                      })
                    )
                      remove.mutate(b.id);
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---- Seat layouts ----------------------------------------------------------------------------

const layoutSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  rows: z.number({ error: 'Enter the rows' }).int().min(1).max(60),
  columns: z.number({ error: 'Enter the columns' }).int().min(1).max(6),
  accessible: z.string().optional(),
});
type LayoutValues = z.infer<typeof layoutSchema>;

export function SeatLayoutsPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const manage = can(access, 'fleet.manage');
  const list = useSeatLayouts();
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'seat-layouts'] });
  const form = useForm<LayoutValues>({
    resolver: zodResolver(layoutSchema),
    defaultValues: { name: '', rows: 10, columns: 4, accessible: '' },
  });
  const create = useMutation({
    mutationFn: (v: LayoutValues) =>
      api(`/tenants/${tenantId}/seat-layouts`, {
        method: 'POST',
        body: {
          name: v.name,
          rows: v.rows,
          columns: v.columns,
          accessible: (v.accessible ?? '')
            .split(/[\s,]+/)
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean),
        },
      }),
    onSuccess: async () => {
      toast('Seat layout created', 'success');
      form.reset();
      await refresh();
    },
  });
  const ask = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/tenants/${tenantId}/seat-layouts/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Seat layout deleted', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const [preview, setPreview] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['company', tenantId, 'seat-layouts', preview],
    enabled: preview !== null,
    queryFn: ({ signal }) =>
      api<{ seats: { label: string; row: number; col: number; accessible: boolean }[] }>(
        `/tenants/${tenantId}/seat-layouts/${preview}`,
        { signal },
      ),
  });
  const { errors } = form.formState;
  const cols = detail.data ? Math.max(...detail.data.seats.map((s) => s.col)) : 0;
  return (
    <div className="mx-auto w-[90%] space-y-6">
      <h1 className="text-2xl font-semibold">Seat layouts</h1>
      {manage && (
        <Card title="New layout">
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="mt-3 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" error={errors.name?.message} {...form.register('name')} />
              <Field
                label="Rows"
                type="number"
                inputMode="numeric"
                error={errors.rows?.message}
                {...form.register('rows', { valueAsNumber: true })}
              />
              <Field
                label="Seats per row (1-6)"
                type="number"
                inputMode="numeric"
                error={errors.columns?.message}
                {...form.register('columns', { valueAsNumber: true })}
              />
            </div>
            <Field
              label="Wheelchair-accessible seats (optional, e.g. 1A, 1B)"
              error={errors.accessible?.message}
              {...form.register('accessible')}
            />
            {create.error && <ErrorAlert error={create.error} />}
            <Button type="submit" loading={create.isPending} loadingText="Creating…">
              Create layout
            </Button>
          </form>
        </Card>
      )}
      <Card>
        {list.isPending && <PageLoader label="Loading layouts" />}
        {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {list.data?.items.length === 0 && (
            <li className="py-2 text-slate-500">No layouts yet.</li>
          )}
          {list.data?.items.map((l) => (
            <li key={l.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-slate-500">
                    {l.seats} seats · used by {l.vehicles} vehicle(s)
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setPreview(preview === l.id ? null : l.id)}
                  >
                    {preview === l.id ? 'Hide' : 'Preview'}
                  </Button>
                  {manage && l.vehicles === 0 && (
                    <Button
                      variant="danger"
                      loading={remove.isPending && remove.variables === l.id}
                      onClick={async () => {
                        if (
                          await ask({
                            title: `Delete ${l.name}?`,
                            message: 'A layout in use by a vehicle cannot be deleted.',
                            confirmLabel: 'Delete layout',
                            danger: true,
                          })
                        )
                          remove.mutate(l.id);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              {preview === l.id && detail.data && (
                <div
                  role="img"
                  aria-label={`${l.name}: ${l.seats} seats`}
                  className="grid max-w-xs gap-1"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {detail.data.seats.map((s) => (
                    <span
                      key={s.label}
                      title={s.accessible ? `${s.label} (accessible)` : s.label}
                      className={`rounded border px-1 py-1 text-center text-xs ${
                        s.accessible
                          ? 'border-blue-600 bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
