import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useRoutes, useVehicles } from './CatalogPages';
import { can, useCompany } from './company-context';

const selectClass =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const DAYS = [
  { label: 'Mon', bit: 1 },
  { label: 'Tue', bit: 2 },
  { label: 'Wed', bit: 4 },
  { label: 'Thu', bit: 8 },
  { label: 'Fri', bit: 16 },
  { label: 'Sat', bit: 32 },
  { label: 'Sun', bit: 64 },
];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

interface ScheduleRow {
  id: string;
  route: string;
  departureTime: string;
  daysOfWeek: number;
  validFrom: string;
  validTo: string | null;
  defaultVehicle: string | null;
  status: string;
}
interface TripRow {
  id: string;
  route: string;
  serviceDate: string;
  departureAt: string;
  arrivalAt: string;
  status: string;
  delayMinutes: number;
  vehicleId: string | null;
  vehicle: string | null;
}

const scheduleSchema = z
  .object({
    routeId: z.string().min(1, 'Choose a route'),
    departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time'),
    validFrom: z.string().min(1, 'Choose a start date'),
    validTo: z.string().optional(),
    defaultVehicleId: z.string().optional(),
  })
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, {
    path: ['validTo'],
    message: 'Must not be before the start date',
  });
type ScheduleValues = z.infer<typeof scheduleSchema>;

function formatDays(mask: number) {
  if (mask === 127) return 'Every day';
  return DAYS.filter((d) => mask & d.bit)
    .map((d) => d.label)
    .join(', ');
}

export function TripsPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const refreshAll = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });
  const manageRoutes = can(access, 'route.manage');
  const manageTrips = can(access, 'trip.manage');
  const routes = useRoutes();
  const vehicles = useVehicles();
  const published = routes.data?.routes.filter((r) => r.status === 'PUBLISHED') ?? [];
  const activeVehicles = vehicles.data?.vehicles.filter((v) => v.status === 'ACTIVE') ?? [];

  const profile = useQuery({
    queryKey: ['company', tenantId, 'profile'],
    queryFn: ({ signal }) => api<{ timezone: string }>(`/tenants/${tenantId}/profile`, { signal }),
  });
  const tz = profile.data?.timezone ?? 'UTC';
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const schedules = useQuery({
    queryKey: ['company', tenantId, 'schedules'],
    enabled: can(access, 'route.read'),
    queryFn: ({ signal }) =>
      api<{ schedules: ScheduleRow[] }>(`/tenants/${tenantId}/schedules?limit=100`, { signal }),
  });
  const [range, setRange] = useState({ from: today(), to: plusDays(7) });
  const trips = useQuery({
    queryKey: ['company', tenantId, 'trips', range],
    queryFn: ({ signal }) =>
      api<{ trips: TripRow[] }>(
        `/tenants/${tenantId}/trips?from=${range.from}&to=${range.to}&limit=100`,
        { signal },
      ),
  });

  const [days, setDays] = useState(31); // Mon-Fri by default
  const form = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      routeId: '',
      departureTime: '07:00',
      validFrom: today(),
      validTo: '',
      defaultVehicleId: '',
    },
  });
  const createSchedule = useMutation({
    mutationFn: (v: ScheduleValues) =>
      api(`/tenants/${tenantId}/schedules`, {
        method: 'POST',
        body: {
          routeId: v.routeId,
          departureTime: v.departureTime,
          daysOfWeek: days,
          validFrom: v.validFrom,
          ...(v.validTo ? { validTo: v.validTo } : {}),
          ...(v.defaultVehicleId ? { defaultVehicleId: v.defaultVehicleId } : {}),
        },
      }),
    onSuccess: async () => {
      toast('Schedule created', 'success');
      await refreshAll();
    },
  });
  const setSchedule = useMutation({
    mutationFn: (v: { id: string; action: 'pause' | 'resume' }) =>
      api(`/tenants/${tenantId}/schedules/${v.id}/${v.action}`, { method: 'POST', body: {} }),
    onSuccess: refreshAll,
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const generate = useMutation({
    mutationFn: (id: string) =>
      api<{ created: number; skippedExisting: number; unassignedVehicle: string[] }>(
        `/tenants/${tenantId}/schedules/${id}/generate`,
        { method: 'POST', body: range },
      ),
    onSuccess: async (r) => {
      toast(
        `${r.created} trip(s) created${r.unassignedVehicle.length ? `, ${r.unassignedVehicle.length} without a free vehicle` : ''}`,
        r.unassignedVehicle.length ? 'info' : 'success',
      );
      await refreshAll();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const assign = useMutation({
    mutationFn: (v: { id: string; vehicleId: string | null }) =>
      api(`/tenants/${tenantId}/trips/${v.id}/vehicle`, {
        method: 'POST',
        body: { vehicleId: v.vehicleId },
      }),
    onSuccess: async () => {
      toast('Vehicle updated', 'success');
      await refreshAll();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/tenants/${tenantId}/trips/${v.id}/status`, {
        method: 'POST',
        body: { status: v.status },
      }),
    onSuccess: refreshAll,
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const { errors } = form.formState;

  const nextActions = (s: string): { label: string; to: string; danger?: boolean }[] =>
    s === 'SCHEDULED'
      ? [
          { label: 'Start boarding', to: 'BOARDING' },
          { label: 'Cancel', to: 'CANCELLED', danger: true },
        ]
      : s === 'BOARDING'
        ? [
            { label: 'Depart', to: 'IN_TRANSIT' },
            { label: 'Cancel', to: 'CANCELLED', danger: true },
          ]
        : s === 'IN_TRANSIT'
          ? [{ label: 'Complete', to: 'COMPLETED' }]
          : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Trips</h1>
      <p className="text-xs text-slate-500">Times shown in {tz}.</p>

      {manageRoutes && (
        <Card title="New schedule">
          {published.length === 0 && routes.data && (
            <Alert tone="info">Publish a route first: schedules run on published routes.</Alert>
          )}

          <form
            noValidate
            onSubmit={form.handleSubmit((v) => createSchedule.mutate(v))}
            className="mt-3 space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="sch-route" className="mb-1 block text-sm font-medium">
                  Route
                </label>
                <select
                  id="sch-route"
                  className={`${selectClass} w-full`}
                  {...form.register('routeId')}
                >
                  <option value="">Choose…</option>
                  {published.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {errors.routeId && (
                  <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
                    {errors.routeId.message}
                  </p>
                )}
              </div>
              <Field
                label="Departure (local time)"
                type="time"
                error={errors.departureTime?.message}
                {...form.register('departureTime')}
              />
              <Field
                label="Valid from"
                type="date"
                error={errors.validFrom?.message}
                {...form.register('validFrom')}
              />
              <Field
                label="Valid until (optional)"
                type="date"
                error={errors.validTo?.message}
                {...form.register('validTo')}
              />
              <div>
                <label htmlFor="sch-veh" className="mb-1 block text-sm font-medium">
                  Default vehicle (optional)
                </label>
                <select
                  id="sch-veh"
                  className={`${selectClass} w-full`}
                  {...form.register('defaultVehicleId')}
                >
                  <option value="">None</option>
                  {activeVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registration}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Runs on</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <label
                    key={d.bit}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600"
                  >
                    <input
                      type="checkbox"
                      checked={(days & d.bit) !== 0}
                      onChange={(e) => setDays((m) => (e.target.checked ? m | d.bit : m & ~d.bit))}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
              {days === 0 && (
                <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
                  Pick at least one day.
                </p>
              )}
            </fieldset>
            {createSchedule.error && <ErrorAlert error={createSchedule.error} />}
            <Button
              type="submit"
              disabled={days === 0}
              loading={createSchedule.isPending}
              loadingText="Creating…"
            >
              Create schedule
            </Button>
          </form>
        </Card>
      )}

      <Card title="Schedules">
        {schedules.isPending && <Spinner label="Loading schedules" />}
        {schedules.error && (
          <ErrorAlert error={schedules.error} onRetry={() => void schedules.refetch()} />
        )}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {schedules.data?.schedules.length === 0 && (
            <li className="py-2 text-slate-500">No schedules yet.</li>
          )}
          {schedules.data?.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {s.route} · {s.departureTime}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDays(s.daysOfWeek)} · from {s.validFrom}
                  {s.validTo ? ` to ${s.validTo}` : ''}
                  {s.defaultVehicle ? ` · ${s.defaultVehicle}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={s.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED'}
                  label={s.status === 'ACTIVE' ? 'Active' : 'Paused'}
                />
                {manageTrips && s.status === 'ACTIVE' && (
                  <Button
                    variant="secondary"
                    loading={generate.isPending && generate.variables === s.id}
                    loadingText="Generating…"
                    onClick={() => generate.mutate(s.id)}
                  >
                    Generate {range.from} → {range.to}
                  </Button>
                )}
                {manageRoutes && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setSchedule.mutate({
                        id: s.id,
                        action: s.status === 'ACTIVE' ? 'pause' : 'resume',
                      })
                    }
                  >
                    {s.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Trips">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field
              label="From"
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </div>
          <div className="w-44">
            <Field
              label="To"
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
        </div>
        {trips.isPending && <Spinner label="Loading trips" />}
        {trips.error && <ErrorAlert error={trips.error} onRetry={() => void trips.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {trips.data?.trips.length === 0 && (
            <li className="py-2 text-slate-500">
              No trips in this range. Generate them from a schedule.
            </li>
          )}
          {trips.data?.trips.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{t.route}</p>
                <p className="text-xs text-slate-500">
                  {fmt(t.departureAt)} → {fmt(t.arrivalAt)}
                  {t.delayMinutes ? ` · delayed ${t.delayMinutes} min` : ''}
                </p>
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
                  label={t.status.charAt(0) + t.status.slice(1).toLowerCase().replace('_', ' ')}
                />

                {manageTrips && (t.status === 'SCHEDULED' || t.status === 'BOARDING') && (
                  <select
                    aria-label={`Vehicle for ${t.route} on ${t.serviceDate}`}
                    className={selectClass}
                    value={t.vehicleId ?? ''}
                    disabled={assign.isPending}
                    onChange={(e) => assign.mutate({ id: t.id, vehicleId: e.target.value || null })}
                  >
                    <option value="">No vehicle</option>
                    {activeVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.registration}
                      </option>
                    ))}
                  </select>
                )}
                {!manageTrips && t.vehicle && <span className="text-xs">{t.vehicle}</span>}
                {manageTrips &&
                  nextActions(t.status).map((a) => (
                    <Button
                      key={a.to}
                      variant={a.danger ? 'danger' : 'secondary'}
                      loading={
                        setStatus.isPending &&
                        setStatus.variables?.id === t.id &&
                        setStatus.variables.status === a.to
                      }
                      onClick={() => setStatus.mutate({ id: t.id, status: a.to })}
                    >
                      {a.label}
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
