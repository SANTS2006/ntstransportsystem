import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { useConfirm } from '../../components/ui/Confirm';
import { DataTable } from '../../components/ui/DataTable';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { can, useCompany } from './company-context';

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  members: number;
  permissions: string[];
}
interface RolesResponse {
  roles: RoleRow[];
  catalog: string[];
}

/** "booking.manage" is shown under "Booking" as "manage". */
const groupOf = (p: string) => p.split('.')[0] ?? p;
const actionOf = (p: string) => p.split('.').slice(1).join(' ') || p;
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function useRoles() {
  const { tenantId } = useCompany();
  return useQuery({
    queryKey: ['company', tenantId, 'roles'],
    queryFn: ({ signal }) => api<RolesResponse>(`/tenants/${tenantId}/roles`, { signal }),
  });
}

/**
 * Every permission, grouped by module, as tick boxes. A ticked box is assigned, an empty one is
 * not. Boxes the editor may not give (permissions they lack themselves) are locked.
 */
function PermissionMatrix({
  catalog,
  selected,
  onChange,
  grantable,
  readOnly,
}: {
  catalog: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  grantable: Set<string>;
  readOnly: boolean;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of catalog) m.set(groupOf(p), [...(m.get(groupOf(p)) ?? []), p]);
    return [...m.entries()];
  }, [catalog]);
  const toggle = (p: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(p);
    else next.delete(p);
    onChange(next);
  };
  const setGroup = (perms: string[], on: boolean) => {
    const next = new Set(selected);
    for (const p of perms) {
      if (!grantable.has(p) && on) continue;
      if (on) next.add(p);
      else next.delete(p);
    }
    onChange(next);
  };
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map(([g, perms]) => {
        const on = perms.filter((p) => selected.has(p)).length;
        return (
          <fieldset
            key={g}
            className="space-y-2 rounded-2xl bg-slate-50 p-4 shadow-[var(--shadow-field)] dark:bg-slate-800/60"
          >
            <legend className="sr-only">{title(g)} permissions</legend>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{title(g)}</p>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {on} of {perms.length}
              </span>
            </div>
            {!readOnly && (
              <div className="flex gap-3 text-xs font-semibold text-brand-600">
                <button type="button" onClick={() => setGroup(perms, true)}>
                  Select all
                </button>
                <button type="button" onClick={() => setGroup(perms, false)}>
                  Clear
                </button>
              </div>
            )}
            <ul className="space-y-1.5">
              {perms.map((p) => {
                const locked = readOnly || !grantable.has(p);
                return (
                  <li key={p}>
                    <label
                      className={`flex items-center gap-2.5 text-sm ${locked ? 'opacity-70' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p)}
                        disabled={locked && !selected.has(p) ? true : readOnly}
                        onChange={(e) => toggle(p, e.target.checked)}
                        className="size-4 shrink-0 accent-brand-600"
                      />
                      <span className="min-w-0">
                        <span className="block capitalize">{actionOf(p)}</span>
                        <span className="block truncate font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {p}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/** Roles and permissions: see every role, tick the permissions it has, make new roles. */
export function RolesPage() {
  const { tenantId, access } = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const ask = useConfirm();
  const q = useRoles();
  const manage = can(access, 'role.manage');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<Set<string>>(new Set());
  const [nameError, setNameError] = useState<string | undefined>();

  const roles = q.data?.roles ?? [];
  const picked = roles.find((r) => r.id === pickedId) ?? roles[0];
  useEffect(() => {
    if (picked) setDraft(new Set(picked.permissions));
  }, [picked?.id, q.dataUpdatedAt]);

  // What this editor may hand out: only permissions they hold themselves.
  const grantable = useMemo(() => new Set(access.permissions), [access.permissions]);
  const dirty =
    picked !== undefined &&
    (draft.size !== picked.permissions.length || picked.permissions.some((p) => !draft.has(p)));
  const locked = !manage || picked?.isSystem === true;
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });

  const save = useMutation({
    mutationFn: () =>
      api(`/tenants/${tenantId}/roles/${picked!.id}/permissions`, {
        method: 'PUT',
        body: { permissions: [...draft] },
      }),
    onSuccess: async () => {
      toast('Permissions saved', 'success');
      await refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not save', 'error'),
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/tenants/${tenantId}/roles`, {
        method: 'POST',
        body: { key: keyFrom(newName), name: newName.trim(), permissions: [...newPerms] },
      }),
    onSuccess: async (r) => {
      toast('Role created', 'success');
      setCreating(false);
      setNewName('');
      setNewPerms(new Set());
      setPickedId(r.id);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/tenants/${tenantId}/roles/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Role deleted', 'success');
      setPickedId(null);
      await refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not delete', 'error'),
  });

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">Roles and permissions</h1>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Choose a role to see what it can do. Ticked permissions are assigned, empty ones are
            not.
          </p>
        </div>
        {manage && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="size-4" strokeWidth={1.8} />
            New role
          </Button>
        )}
      </div>

      {q.isPending && <PageLoader label="Loading roles" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}

      {q.data && (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <ul className="space-y-2" aria-label="Roles">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setPickedId(r.id)}
                  aria-current={picked?.id === r.id}
                  className={`flex w-full items-center justify-between gap-3 rounded-2xl p-3 text-left shadow-[var(--shadow-field)] ${
                    picked?.id === r.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.name}</span>
                    <span
                      className={`block text-xs ${picked?.id === r.id ? 'text-white/80' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                      {r.permissions.length} of {q.data.catalog.length} permissions · {r.members}{' '}
                      {r.members === 1 ? 'person' : 'people'}
                    </span>
                  </span>
                  {r.isSystem && (
                    <ShieldCheck
                      aria-label="System role"
                      className="size-4 shrink-0"
                      strokeWidth={1.8}
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {picked && (
            <Card
              title={picked.name}
              action={
                <div className="flex items-center gap-2">
                  {picked.isSystem && <Badge tone="slate">System role: locked</Badge>}
                  {manage && !picked.isSystem && picked.members === 0 && (
                    <Button
                      variant="dangerQuiet"
                      loading={remove.isPending}
                      onClick={async () => {
                        if (
                          await ask({
                            title: `Delete ${picked.name}?`,
                            message: 'The role and its permissions are removed for good.',
                            confirmLabel: 'Delete role',
                            danger: true,
                          })
                        )
                          remove.mutate(picked.id);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              }
            >
              <PermissionMatrix
                catalog={q.data.catalog}
                selected={draft}
                onChange={setDraft}
                grantable={grantable}
                readOnly={locked}
              />
              {!locked && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    You can only give permissions you hold yourself. Changes apply to everyone with
                    this role straight away.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={!dirty}
                      onClick={() => setDraft(new Set(picked.permissions))}
                    >
                      Undo changes
                    </Button>
                    <Button
                      disabled={!dirty}
                      loading={save.isPending}
                      loadingText="Saving…"
                      onClick={() => save.mutate()}
                    >
                      <Check aria-hidden="true" className="size-4" strokeWidth={1.8} />
                      Save permissions
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      <Dialog open={creating} title="New role" onClose={() => setCreating(false)}>
        <form
          noValidate
          className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim().length < 2 || keyFrom(newName).length < 2) {
              setNameError('Give the role a name of at least 2 letters');
              return;
            }
            setNameError(undefined);
            create.mutate();
          }}
        >
          {create.error && <ErrorAlert error={create.error} />}
          <Field
            label="Role name"
            placeholder="e.g. Ticket checker"
            error={nameError}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <p className="text-sm font-semibold">Permissions</p>
          <PermissionMatrix
            catalog={q.data?.catalog ?? []}
            selected={newPerms}
            onChange={setNewPerms}
            grantable={grantable}
            readOnly={false}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} loadingText="Creating…">
              Create role
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ---- Users -----------------------------------------------------------------------------------

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  verified: boolean;
  joinedAt: string;
  isStaff: boolean;
}
const PAGE = 25;

/** Everyone who signed up on this company's page. */
export function UsersPage() {
  const { tenantId } = useCompany();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ['company', tenantId, 'users', search, page],
    queryFn: ({ signal }) =>
      api<{ total: number; users: UserRow[] }>(
        `/tenants/${tenantId}/users?limit=${PAGE}&offset=${page * PAGE}${
          search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''
        }`,
        { signal },
      ),
  });
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl">Users</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Everyone who created an account on your company page. These are your passengers; people
          who also work for you are marked as staff.
        </p>
      </div>
      <div className="relative max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-500"
          strokeWidth={1.8}
        />
        <input
          type="search"
          aria-label="Search users"
          placeholder="Search by name, email or phone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-base placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-900"
        />
      </div>
      {q.isPending && <PageLoader label="Loading users" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <DataTable
          name="Users"
          rows={q.data.users}
          rowKey={(u) => u.id}
          empty="No users yet. People appear here when they sign up on your company page."
          columns={[
            {
              key: 'name',
              header: 'User',
              kind: 'title',
              cell: (u) => (
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white"
                  >
                    {u.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate font-semibold">{u.name}</span>
                </div>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              cell: (u) => (
                <span className="break-all text-sm">{u.email ?? u.phone ?? 'Not given'}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (u) => (
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={u.verified ? 'green' : 'amber'}>
                    {u.verified ? 'Confirmed' : 'Not confirmed'}
                  </Badge>
                  {u.isStaff && <Badge tone="slate">Staff</Badge>}
                </div>
              ),
            },
            {
              key: 'joined',
              header: 'Joined',
              cell: (u) => new Date(u.joinedAt).toLocaleDateString(),
            },
          ]}
        />
      )}
      {q.data && total > PAGE && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Page {page + 1} of {pages} · {total} users
          </p>
          <Button
            variant="secondary"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Several roles for one staff member ------------------------------------------------------

export interface StaffRoles {
  id: string;
  displayName: string;
  roles: { id: string; key: string; name: string }[];
}

/** Tick the roles a staff member holds; each tick or untick is saved straight away. */
export function StaffRolesDialog({
  member,
  allRoles,
  onClose,
  onChanged,
}: {
  member: StaffRoles | null;
  allRoles: RoleRow[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { tenantId } = useCompany();
  const toast = useToast();
  const [held, setHeld] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (member) setHeld(new Set(member.roles.map((r) => r.id)));
  }, [member]);
  const change = useMutation({
    mutationFn: (v: { roleId: string; on: boolean }) =>
      api(
        v.on
          ? `/tenants/${tenantId}/memberships/${member!.id}/roles`
          : `/tenants/${tenantId}/memberships/${member!.id}/roles/${v.roleId}`,
        v.on ? { method: 'POST', body: { roleId: v.roleId } } : { method: 'DELETE' },
      ),
    onSuccess: async (_d, v) => {
      setHeld((cur) => {
        const next = new Set(cur);
        if (v.on) next.add(v.roleId);
        else next.delete(v.roleId);
        return next;
      });
      await onChanged();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not change the role', 'error'),
  });
  return (
    <Dialog
      open={member !== null}
      title={member ? `Roles of ${member.displayName}` : ''}
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          They can switch between the roles they hold and, while using one, they get exactly that
          role&apos;s permissions. Everyone can also act as a passenger.
        </p>
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {allRoles.map((r) => {
            const on = held.has(r.id);
            return (
              <li key={r.id}>
                <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm shadow-[var(--shadow-field)] dark:bg-slate-800/60">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={on}
                    disabled={change.isPending || (on && held.size <= 1)}
                    onChange={(e) => change.mutate({ roleId: r.id, on: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{r.name}</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      {r.permissions.length} permissions
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
