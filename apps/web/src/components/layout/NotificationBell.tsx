import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { PageLoader } from '../ui/Spinner';

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}
interface Inbox {
  unread: number;
  items: Item[];
}

const stamp = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** Only paths inside this app are followed; the server stores nothing else, this is a second check. */
export const isAppPath = (link: string | null): link is string =>
  link !== null && /^\/[A-Za-z0-9]/.test(link);

/** Bell with an unread count and a panel of the signed-in user's recent notifications. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const count = useQuery({
    queryKey: ['inbox-count'],
    queryFn: ({ signal }) => api<{ unread: number }>('/me/notifications/unread-count', { signal }),
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
  const list = useQuery({
    queryKey: ['inbox'],
    queryFn: ({ signal }) => api<Inbox>('/me/notifications', { signal }),
    enabled: open,
    retry: false,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    void qc.invalidateQueries({ queryKey: ['inbox-count'] });
  };
  const markOne = useMutation({
    mutationFn: (id: string) => api(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api('/me/notifications/read-all', { method: 'POST' }),
    onSettled: refresh,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const unread = typeof count.data?.unread === 'number' ? count.data.unread : 0;
  const items = Array.isArray(list.data?.items) ? list.data.items : [];

  const choose = (n: Item) => {
    if (!n.read) markOne.mutate(n.id);
    setOpen(false);
    if (isAppPath(n.link)) void navigate(n.link);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-level3 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            <p className="text-sm font-semibold">Notifications</p>
            <Button
              variant="ghost"
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isPending && (
              <div className="p-4">
                <PageLoader label="Loading notifications" />
              </div>
            )}
            {list.error && (
              <p className="p-4 text-sm text-red-700 dark:text-red-400">
                Could not load notifications.{' '}
                <button type="button" className="font-medium" onClick={() => void list.refetch()}>
                  Try again
                </button>
              </p>
            )}
            {!list.isPending && !list.error && items.length === 0 && (
              <p className="p-4 text-sm text-slate-500">Nothing yet.</p>
            )}
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => choose(n)}
                    className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-start gap-2">
                      {!n.read && (
                        <span
                          aria-label="Unread"
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600"
                        />
                      )}
                      <span className="min-w-0">
                        <span className={`block text-sm ${n.read ? '' : 'font-semibold'}`}>
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="block text-xs text-slate-600 dark:text-slate-400">
                            {n.body}
                          </span>
                        )}
                        <span className="block text-[11px] text-slate-500">
                          {stamp(n.createdAt)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
