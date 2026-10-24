import { zodResolver } from '@hookform/resolvers/zod';
import { StopFaresDialog } from './StopFaresDialog';
import { ModalCard } from '../../components/ui/ModalCard';
import { useConfirm } from '../../components/ui/Confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { can, useCompany } from './company-context';

const selectClass =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';
const Title = ({ children }: { children: string }) => (
  <h1 className="mb-2 text-2xl font-semibold">{children}</h1>
);

function useRefresh(key: string) {
  const { tenantId } = useCompany();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['company', tenantId, key] });
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

// ---- Locations -------------------------------------------------------------------------------

interface Location {
  id: string;
  name: string;
  kind: string;
  city: string;
  active: boolean;
}
const locationSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  city: z.string().trim().min(1, 'Enter a city').max(80),
  kind: z.enum(['TERMINAL', 'STATION', 'STOP', 'DEPOT']),
});
type LocationValues = z.infer<typeof locationSchema>;

export function useLocations() {
  const { tenantId } = useCompany();
  return useQuery({
    queryKey: ['company', tenantId, 'locations'],
    queryFn: ({ signal }) =>
      api<{ locations: Location[] }>(`/tenants/${tenantId}/locations?limit=100`, { signal }),
  });
}

export function LocationsPage() {
  const [adding400, setAdding400] = useState(false);
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const refresh = useRefresh('locations');
  const q = useLocations();
  const manage = can(access, 'route.manage');
  const form = useForm<LocationValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: '', city: '', kind: 'TERMINAL' },
  });
  const create = useMutation({
    mutationFn: (v: LocationValues) =>
      api(`/tenants/${tenantId}/locations`, { method: 'POST', body: v }),
    onSuccess: async () => {
      toast('Location added', 'success');
      form.reset();
      setAdding400(false);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (l: Location) =>
      api(`/tenants/${tenantId}/locations/${l.id}`, {
        method: 'PATCH',
        body: { active: !l.active },
      }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const ask = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/locations/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Location deleted', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const { errors } = form.formState;
  return (
    <div className="w-full space-y-6">
      <Title>Locations</Title>
      {manage && (
        <ModalCard title="Add a location" open={adding400} onOpenChange={setAdding400}>
          {create.error && <ErrorAlert error={create.error} />}
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="flex flex-wrap items-start gap-3"
          >
            <div className="min-w-48 flex-1">
              <Field label="Name" error={errors.name?.message} {...form.register('name')} />
            </div>
            <div className="min-w-36">
              <Field label="City" error={errors.city?.message} {...form.register('city')} />
            </div>
            <div>
              <label htmlFor="loc-kind" className="mb-1 block text-sm font-medium">
                Type
              </label>
              <select id="loc-kind" className={selectClass} {...form.register('kind')}>
                <option value="TERMINAL">Terminal</option>
                <option value="STATION">Station</option>
                <option value="STOP">Stop</option>
                <option value="DEPOT">Depot</option>
              </select>
            </div>
            <Button type="submit" className="mt-6" loading={create.isPending} loadingText="Adding…">
              Add
            </Button>
          </form>
        </ModalCard>
      )}
      <Card>
        {q.isPending && <PageLoader label="Loading locations" />}
        {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {q.data?.locations.length === 0 && (
            <li className="py-2 text-slate-500">No locations yet.</li>
          )}
          {q.data?.locations.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{l.name}</p>
                <p className="text-xs text-slate-500">
                  {l.city} · {l.kind.toLowerCase()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={l.active ? 'ACTIVE' : 'DEACTIVATED'}
                  label={l.active ? 'Active' : 'Inactive'}
                />
                {manage && (
                  <>
                    <Button
                      variant="secondary"
                      loading={toggle.isPending && toggle.variables?.id === l.id}
                      onClick={() => toggle.mutate(l)}
                    >
                      {l.active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      variant="danger"
                      loading={remove.isPending && remove.variables === l.id}
                      onClick={async () => {
                        if (
                          await ask({
                            title: `Delete ${l.name}?`,
                            message:
                              'This location is removed. It cannot be deleted while a route uses it.',
                            confirmLabel: 'Delete location',
                            danger: true,
                          })
                        )
                          remove.mutate(l.id);
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---- Vehicles --------------------------------------------------------------------------------

interface Vehicle {
  id: string;
  registration: string;
  type: string;
  seatingCapacity: number;
  status: string;
  odometerKm: number;
}
const VEHICLE_TYPES = [
  { value: 'BUS', label: 'Bus' },
  { value: 'MINIBUS', label: 'Minibus' },
  { value: 'SHARED_TAXI', label: 'Shared taxi' },
  { value: 'TAXI', label: 'Taxi' },
  { value: 'SHUTTLE', label: 'Shuttle' },
  { value: 'OTHER', label: 'Other' },
];
const vehicleSchema = z.object({
  seatLayoutId: z.string().optional(),
  registration: z.string().trim().min(2, 'Enter the registration').max(20),
  type: z.enum(['BUS', 'MINIBUS', 'SHARED_TAXI', 'TAXI', 'SHUTTLE', 'OTHER']),
  seatingCapacity: z
    .number({ error: 'Enter the seat count' })
    .int()
    .min(1, 'At least 1')
    .max(200, 'At most 200'),
});
type VehicleValues = z.infer<typeof vehicleSchema>;

export function useSeatLayouts() {
  const { tenantId, access } = useCompany();
  return useQuery({
    queryKey: ['company', tenantId, 'seat-layouts'],
    enabled: can(access, 'fleet.read'),
    queryFn: ({ signal }) =>
      api<{ items: { id: string; name: string; seats: number; vehicles: number }[] }>(
        `/tenants/${tenantId}/seat-layouts`,
        { signal },
      ),
  });
}

export function useVehicles() {
  const { tenantId, access } = useCompany();
  return useQuery({
    queryKey: ['company', tenantId, 'vehicles'],
    enabled: can(access, 'fleet.read'),
    queryFn: ({ signal }) =>
      api<{ vehicles: Vehicle[] }>(`/tenants/${tenantId}/vehicles?limit=100`, { signal }),
  });
}

export function VehiclesPage() {
  const [adding112, setAdding112] = useState(false);
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const refresh = useRefresh('vehicles');
  const q = useVehicles();
  const manage = can(access, 'fleet.manage');
  const layouts = useSeatLayouts();
  const form = useForm<VehicleValues>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { registration: '', type: 'BUS', seatingCapacity: 50, seatLayoutId: '' },
  });
  const create = useMutation({
    mutationFn: (v: VehicleValues) =>
      api(`/tenants/${tenantId}/vehicles`, {
        method: 'POST',
        body: { ...v, seatLayoutId: v.seatLayoutId || undefined },
      }),
    onSuccess: async () => {
      toast('Vehicle added', 'success');
      form.reset();
      setAdding112(false);
      await refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/tenants/${tenantId}/vehicles/${v.id}`, { method: 'PATCH', body: { status: v.status } }),
    onSuccess: async () => {
      toast('Vehicle updated', 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const { errors } = form.formState;
  return (
    <div className="w-full space-y-6">
      <Title>Vehicles</Title>
      {manage && (
        <ModalCard title="Add a vehicle" open={adding112} onOpenChange={setAdding112}>
          {create.error && <ErrorAlert error={create.error} />}
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="flex flex-wrap items-start gap-3"
          >
            <div className="min-w-40 flex-1">
              <Field
                label="Registration"
                error={errors.registration?.message}
                {...form.register('registration')}
              />
            </div>
            <div>
              <label htmlFor="veh-type" className="mb-1 block text-sm font-medium">
                Type
              </label>
              <select id="veh-type" className={selectClass} {...form.register('type')}>
                <option value="BUS">Bus</option>
                <option value="MINIBUS">Minibus</option>
                <option value="SHARED_TAXI">Shared taxi</option>
                <option value="TAXI">Taxi</option>
                <option value="SHUTTLE">Shuttle</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="w-28">
              <Field
                label="Seats"
                type="number"
                inputMode="numeric"
                error={errors.seatingCapacity?.message}
                {...form.register('seatingCapacity', { valueAsNumber: true })}
              />
            </div>
            {layouts.data && layouts.data.items.length > 0 && (
              <div>
                <label htmlFor="veh-layout" className="mb-1 block text-sm font-medium">
                  Seat layout
                </label>
                <select id="veh-layout" className={selectClass} {...form.register('seatLayoutId')}>
                  <option value="">None</option>
                  {layouts.data.items.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.seats} seats)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit" className="mt-6" loading={create.isPending} loadingText="Adding…">
              Add
            </Button>
          </form>
        </ModalCard>
      )}
      <Card>
        {q.isPending && <PageLoader label="Loading vehicles" />}
        {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {q.data?.vehicles.length === 0 && (
            <li className="py-2 text-slate-500">No vehicles yet.</li>
          )}
          {q.data?.vehicles.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{v.registration}</p>
                <p className="text-xs text-slate-500">
                  {v.type.replace('_', ' ').toLowerCase()} · {v.seatingCapacity} seats ·{' '}
                  {v.odometerKm.toLocaleString()} km
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={v.status === 'MAINTENANCE' ? 'PENDING' : v.status}
                  label={
                    v.status === 'MAINTENANCE'
                      ? 'Maintenance'
                      : v.status === 'RETIRED'
                        ? 'Retired'
                        : 'Active'
                  }
                />
                {manage && v.status !== 'RETIRED' && (
                  <select
                    aria-label={`Status for ${v.registration}`}
                    className={selectClass}
                    value={v.status}
                    disabled={setStatus.isPending}
                    onChange={(e) => setStatus.mutate({ id: v.id, status: e.target.value })}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="RETIRED">Retire…</option>
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---- Routes ----------------------------------------------------------------------------------

interface RouteRow {
  id: string;
  name: string;
  status: string;
  origin: string;
  destination: string;
  distanceM: number;
  durationMin: number;
  stopCount: number;
  minSeats?: number;
  allowedVehicleTypes?: string[];
}
const routeSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  originId: z.string().min(1, 'Choose the origin'),
  destinationId: z.string().min(1, 'Choose the destination'),
  distanceKm: z.number({ error: 'Enter the distance' }).min(0.1, 'Must be positive').max(5000),
  durationMin: z.number({ error: 'Enter the duration' }).int().min(1).max(2880),
  minSeats: z.number({ error: 'Enter the minimum seats' }).int().min(1, 'At least 1').max(200),
  stops: z.array(
    z.object({
      locationId: z.string().min(1, 'Choose a stop'),
      offsetMin: z.number({ error: 'Minutes' }).int().min(1),
    }),
  ),
});
type RouteValues = z.infer<typeof routeSchema>;

export function useRoutes() {
  const { tenantId } = useCompany();
  return useQuery({
    queryKey: ['company', tenantId, 'routes'],
    queryFn: ({ signal }) =>
      api<{ routes: RouteRow[] }>(`/tenants/${tenantId}/routes?limit=100`, { signal }),
  });
}

function FareEditor({ routeId, canEdit }: { routeId: string; canEdit: boolean }) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['company', tenantId, 'fares', routeId],
    queryFn: ({ signal }) =>
      api<{ fares: { serviceClass: string; amountMinor: number; currency: string }[] }>(
        `/tenants/${tenantId}/routes/${routeId}/fares`,
        { signal },
      ),
  });
  const [amount, setAmount] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/tenants/${tenantId}/routes/${routeId}/fares/STANDARD`, {
        method: 'PUT',
        body: { amountMinor: Math.round(Number(amount) * 100) },
      }),
    onSuccess: async () => {
      toast('Fare saved. New bookings use it; existing ones keep their price.', 'success');
      setAmount('');
      await qc.invalidateQueries({ queryKey: ['company', tenantId, 'fares', routeId] });
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const current = q.data?.fares.find((f) => f.serviceClass === 'STANDARD');
  const [stopsOpen, setStopsOpen] = useState(false);
  return (
    <div className="flex w-full flex-wrap items-end gap-3 pt-2 text-xs">
      <StopFaresDialog
        routeId={routeId}
        open={stopsOpen}
        canEdit={canEdit}
        onClose={() => setStopsOpen(false)}
      />
      <Button variant="ghost" onClick={() => setStopsOpen(true)}>
        Prices by stop
      </Button>
      <span>
        Fare:{' '}
        {current
          ? `${current.currency} ${(current.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          : 'not set (cannot be booked)'}
      </span>
      {canEdit && (
        <>
          <div className="w-32">
            <Field
              label="New fare"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            disabled={amount === '' || Number(amount) < 0 || Number.isNaN(Number(amount))}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Set fare
          </Button>
        </>
      )}
    </div>
  );
}

export function RoutesPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const refresh = useRefresh('routes');
  const q = useRoutes();
  const locations = useLocations();
  const manage = can(access, 'route.manage');
  const form = useForm<RouteValues>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: '',
      originId: '',
      destinationId: '',
      distanceKm: 100,
      durationMin: 120,
      minSeats: 1,
      stops: [],
    },
  });
  const stops = useFieldArray({ control: form.control, name: 'stops' });
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: (v: RouteValues) =>
      api(`/tenants/${tenantId}/routes`, {
        method: 'POST',
        body: {
          name: v.name,
          originId: v.originId,
          destinationId: v.destinationId,
          distanceM: Math.round(v.distanceKm * 1000),
          durationMin: v.durationMin,
          minSeats: v.minSeats,
          allowedVehicleTypes: allowedTypes,
          stops: v.stops,
        },
      }),
    onSuccess: async () => {
      toast('Route saved as a draft', 'success');
      form.reset();
      setAllowedTypes([]);
      await refresh();
    },
  });
  const ask = useConfirm();
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'publish' | 'archive' | 'delete' }) =>
      v.action === 'delete'
        ? api(`/tenants/${tenantId}/routes/${v.id}`, { method: 'DELETE' })
        : api(`/tenants/${tenantId}/routes/${v.id}/${v.action}`, { method: 'POST', body: {} }),
    onSuccess: async (_d, v) => {
      toast(`Route ${v.action === 'delete' ? 'deleted' : v.action + 'ed'}`, 'success');
      await refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const { errors } = form.formState;
  const locs = locations.data?.locations.filter((l) => l.active) ?? [];
  const locationSelect = (
    name: `stops.${number}.locationId` | 'originId' | 'destinationId',
    label: string,
    err?: string,
  ) => (
    <div>
      <label htmlFor={`rt-${name}`} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select id={`rt-${name}`} className={`${selectClass} w-full`} {...form.register(name)}>
        <option value="">Choose…</option>
        {locs.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
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
    <div className="w-full space-y-6">
      <Title>Routes</Title>
      {manage && (
        <Card title="New route">
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="space-y-4"
          >
            <Field label="Route name" error={errors.name?.message} {...form.register('name')} />
            <div className="grid gap-3 sm:grid-cols-2">
              {locationSelect('originId', 'From', errors.originId?.message)}
              {locationSelect('destinationId', 'To', errors.destinationId?.message)}
              <Field
                label="Distance (km)"
                type="number"
                step="0.1"
                error={errors.distanceKm?.message}
                {...form.register('distanceKm', { valueAsNumber: true })}
              />
              <Field
                label="Duration (minutes)"
                type="number"
                error={errors.durationMin?.message}
                {...form.register('durationMin', { valueAsNumber: true })}
              />
              <Field
                label="Minimum seats"
                type="number"
                inputMode="numeric"
                error={errors.minSeats?.message}
                {...form.register('minSeats', { valueAsNumber: true })}
              />
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">
                Vehicle types allowed (none ticked = any)
              </legend>
              <div className="flex flex-wrap gap-2">
                {VEHICLE_TYPES.map((t) => (
                  <label
                    key={t.value}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600"
                  >
                    <input
                      type="checkbox"
                      checked={allowedTypes.includes(t.value)}
                      onChange={(e) =>
                        setAllowedTypes((cur) =>
                          e.target.checked ? [...cur, t.value] : cur.filter((x) => x !== t.value),
                        )
                      }
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Intermediate stops (in order)</legend>
              {stops.fields.map((f, i) => (
                <div key={f.id} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-48 flex-1">
                    {locationSelect(
                      `stops.${i}.locationId`,
                      `Stop ${i + 1}`,
                      errors.stops?.[i]?.locationId?.message,
                    )}
                  </div>
                  <div className="w-36">
                    <Field
                      label="Minutes after departure"
                      type="number"
                      error={errors.stops?.[i]?.offsetMin?.message}
                      {...form.register(`stops.${i}.offsetMin`, { valueAsNumber: true })}
                    />
                  </div>
                  <Button variant="ghost" onClick={() => stops.remove(i)}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() => stops.append({ locationId: '', offsetMin: 30 })}
              >
                Add a stop
              </Button>
            </fieldset>
            {create.error && <ErrorAlert error={create.error} />}
            <Button type="submit" loading={create.isPending} loadingText="Saving…">
              Save draft
            </Button>
          </form>
        </Card>
      )}
      <Card>
        {q.isPending && <PageLoader label="Loading routes" />}
        {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
          {q.data?.routes.length === 0 && <li className="py-2 text-slate-500">No routes yet.</li>}
          {q.data?.routes.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-slate-500">
                  {r.origin} → {r.destination} · {(r.distanceM / 1000).toFixed(1)} km ·{' '}
                  {r.durationMin} min · {r.stopCount} stop(s)
                  {r.minSeats && r.minSeats > 1 ? ` · min ${r.minSeats} seats` : ''}
                  {r.allowedVehicleTypes?.length
                    ? ` · ${r.allowedVehicleTypes.map((t) => t.replace('_', ' ').toLowerCase()).join(', ')} only`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={
                    r.status === 'DRAFT'
                      ? 'PENDING'
                      : r.status === 'PUBLISHED'
                        ? 'ACTIVE'
                        : 'DEACTIVATED'
                  }
                  label={
                    r.status === 'DRAFT'
                      ? 'Draft'
                      : r.status === 'PUBLISHED'
                        ? 'Published'
                        : 'Archived'
                  }
                />
                {manage && r.status === 'DRAFT' && (
                  <>
                    <Button
                      loading={
                        act.isPending &&
                        act.variables?.id === r.id &&
                        act.variables.action === 'publish'
                      }
                      onClick={() => act.mutate({ id: r.id, action: 'publish' })}
                    >
                      Publish
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (
                          await ask({
                            title: 'Delete this draft route?',
                            message: 'The draft and its stops are removed for good.',
                            confirmLabel: 'Delete route',
                            danger: true,
                          })
                        )
                          act.mutate({ id: r.id, action: 'delete' });
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
                {manage && r.status === 'PUBLISHED' && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (
                        await ask({
                          title: 'Archive this route?',
                          message: 'It stops being offered for new trips.',
                          confirmLabel: 'Archive route',
                        })
                      )
                        act.mutate({ id: r.id, action: 'archive' });
                    }}
                  >
                    Archive
                  </Button>
                )}
              </div>
              {r.status === 'PUBLISHED' && <FareEditor routeId={r.id} canEdit={manage} />}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
