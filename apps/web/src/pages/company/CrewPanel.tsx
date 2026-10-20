import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { useCompany } from './company-context';

const selectClass =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';

interface CrewMember {
  employeeId: string;
  fullName: string;
  role: string;
}
interface RosterEntry {
  id: string;
  fullName: string;
  role: string;
  licenceExpiresOn: string | null;
}

/** Crew for one trip. Uses the minimal dispatcher roster, so no HR permission is needed. */
export function CrewPanel({
  tripId,
  canManage,
  open,
}: {
  tripId: string;
  canManage: boolean;
  open: boolean;
}) {
  const { tenantId } = useCompany();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const crew = useQuery({
    queryKey: ['company', tenantId, 'crew', tripId],
    queryFn: ({ signal }) =>
      api<{ crew: CrewMember[] }>(`/tenants/${tenantId}/trips/${tripId}/crew`, { signal }),
  });
  const roster = useQuery({
    queryKey: ['company', tenantId, 'roster'],
    enabled: canManage && open,
    queryFn: ({ signal }) =>
      api<{ roster: RosterEntry[] }>(`/tenants/${tenantId}/crew/roster`, { signal }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId, 'crew', tripId] });
  const picked = roster.data?.roster.find((r) => r.id === employeeId);
  // Don't offer people who are already on this trip.
  const available =
    roster.data?.roster.filter((r) => !crew.data?.crew.some((c) => c.employeeId === r.id)) ?? [];
  const assign = useMutation({
    mutationFn: () =>
      api(`/tenants/${tenantId}/trips/${tripId}/crew`, {
        method: 'POST',
        body: { employeeId, role: picked?.role },
      }),
    onSuccess: async () => {
      setEmployeeId('');
      await refresh();
    },
  });
  const release = useMutation({
    mutationFn: (id: string) =>
      api(`/tenants/${tenantId}/trips/${tripId}/crew/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Crew</p>
      {crew.isPending && <Spinner label="Loading crew" />}
      {crew.error && <ErrorAlert error={crew.error} onRetry={() => void crew.refetch()} />}
      {crew.data?.crew.length === 0 && <p className="text-slate-500">No crew assigned yet.</p>}
      <ul className="space-y-1">
        {crew.data?.crew.map((c) => (
          <li key={c.employeeId} className="flex items-center justify-between gap-2">
            <span>
              {c.fullName} <span className="text-xs text-slate-500">({c.role.toLowerCase()})</span>
            </span>
            {canManage && (
              <Button
                variant="ghost"
                loading={release.isPending && release.variables === c.employeeId}
                onClick={() => release.mutate(c.employeeId)}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Choose crew member"
              className={selectClass}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Choose a person…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName} ({r.role.toLowerCase()})
                </option>
              ))}
            </select>
            <Button
              disabled={!employeeId}
              loading={assign.isPending}
              loadingText="Assigning…"
              onClick={() => assign.mutate()}
            >
              Assign
            </Button>
          </div>
          {assign.error && <ErrorAlert error={assign.error} />}
        </div>
      )}
    </div>
  );
}
