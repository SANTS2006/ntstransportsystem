import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { isAppPath } from '../../components/layout/NotificationBell';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { api } from '../../lib/api';

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}
interface Page {
  unread: number;
  hasMore: boolean;
  items: Item[];
}
interface Detail extends Item {
  company: string;
  kind: string;
}

const stamp = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(
    new Date(iso),
  );
const short = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** The folder this page lives in (a company's address, or /platform), so links stay inside it. */
function useHere(): string {
  const { pathname } = useLocation();
  const i = pathname.indexOf('/notifications');
  return i < 0 ? '' : pathname.slice(0, i);
}

/** Every notification the person has received, newest first, with a way to open each one. */
export function NotificationsPage() {
  const here = useHere();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ['inbox-all', unreadOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api<Page>(`/me/notifications?offset=${pageParam}${unreadOnly ? '&unread=1' : ''}`, {
        signal,
      }),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.reduce((n, p) => n + p.items.length, 0) : undefined,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inbox-all'] });
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    void qc.invalidateQueries({ queryKey: ['inbox-count'] });
  };
  const markAll = useMutation({
    mutationFn: () => api('/me/notifications/read-all', { method: 'POST' }),
    onSettled: refresh,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;
  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Unread only
          </label>
          <Button
            variant="secondary"
            disabled={unread === 0}
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all as read
          </Button>
        </div>
      </div>
      {list.isPending && <PageLoader label="Loading notifications" />}
      {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
      {!list.isPending && !list.error && items.length === 0 && (
        <Alert tone="info">{unreadOnly ? 'No unread notifications.' : 'Nothing yet.'}</Alert>
      )}
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <Link
              to={`${here}/notifications/${n.id}`}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-600 dark:border-slate-700 dark:bg-slate-900"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${n.read ? 'bg-slate-100 text-slate-500 dark:bg-slate-800' : 'bg-brand-600 text-white'}`}
              >
                <Bell className="size-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${n.read ? '' : 'font-semibold'}`}>
                  {n.title}
                  {!n.read && <span className="sr-only"> (unread)</span>}
                </span>
                {n.body && (
                  <span className="line-clamp-2 block whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">
                    {n.body}
                  </span>
                )}
                <span className="block text-[11px] text-slate-500">{short(n.createdAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

/** One notification in full: what it says, when it came, who from, and where it leads. */
export function NotificationDetailPage() {
  const { id } = useParams();
  const here = useHere();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['inbox-item', id],
    retry: false,
    queryFn: ({ signal }) => api<Detail>(`/me/notifications/${id}`, { signal }),
  });
  const markRead = useMutation({
    mutationFn: () => api(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['inbox-all'] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      void qc.invalidateQueries({ queryKey: ['inbox-count'] });
    },
  });
  // Opening a notification reads it.
  const unread = q.data ? !q.data.read : false;
  useEffect(() => {
    if (unread) markRead.mutate();
  }, [unread, id]);
  const n = q.data;
  return (
    <div className="w-full space-y-5">
      <Link
        to={`${here}/notifications`}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-500"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All notifications
      </Link>
      {q.isPending && <PageLoader label="Loading notification" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {n && (
        <Card>
          <h1 className="text-xl font-semibold">{n.title}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {stamp(n.createdAt)} · from {n.company}
          </p>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
          {isAppPath(n.link) && (
            <div className="mt-5">
              <Link
                to={n.link}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                Open
              </Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
