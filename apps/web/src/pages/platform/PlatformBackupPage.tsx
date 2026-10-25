import { useMutation } from '@tanstack/react-query';
import { DatabaseBackup, Download, FileUp, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';

interface Report {
  mode: 'check' | 'apply';
  createdAt: string;
  restored: number;
  tables: { name: string; inFile: number; restored: number }[];
  notWritable?: string[];
}

const MAX_MB = 80;

/** The same CSRF header the rest of the app sends; this call carries a file, not JSON. */
const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('csrf='))
      ?.slice(5) ?? '',
  );

async function failure(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; requestId?: string } } | undefined;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = undefined;
  }
  return new ApiError(
    res.status,
    body?.error?.code ?? 'ERROR',
    body?.error?.message ?? 'Something went wrong. Please try again.',
    body?.error?.requestId,
  );
}

interface JobState {
  skipped?: string[];
  id: string;
  status: 'running' | 'done' | 'failed';
  error?: string;
  report?: Report;
}

/** A backup or restore runs in the background; ask how it is going until it is finished. */
async function finish(id: string): Promise<JobState> {
  for (let i = 0; i < 600; i++) {
    const job = await api<JobState>(`/platform/backup/jobs/${id}`);
    if (job.status === 'failed')
      throw new ApiError(409, 'JOB_FAILED', job.error ?? 'The job failed.');
    if (job.status === 'done') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new ApiError(0, 'TIMEOUT', 'This is taking too long. Check the audit log, then try again.');
}

/** Backup and recovery of the platform's data, for super administrators. */
export function PlatformBackupPage() {
  const toast = useToast();
  const ask = useConfirm();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const { id } = await api<{ id: string }>('/platform/backup', { method: 'POST' });
      const job = await finish(id);
      const res = await fetch(`/api/v1/platform/backup/jobs/${id}/file`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw await failure(res);
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
        'nts-backup.nts.gz';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { name, skipped: job.skipped ?? [] };
    },
    onSuccess: ({ name, skipped }) =>
      skipped.length
        ? toast(
            `Backup saved as ${name}, but it is incomplete: ${skipped.join(', ')} could not be read. Try again.`,
            'error',
          )
        : toast(`Backup saved as ${name}`, 'success'),
  });

  const restore = useMutation({
    mutationFn: async (mode: 'check' | 'apply') => {
      let res: Response;
      try {
        res = await fetch(`/api/v1/platform/backup/restore?mode=${mode}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/gzip', 'x-csrf-token': csrf() },
          body: file,
        });
      } catch {
        throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
      }
      if (!res.ok) throw await failure(res);
      const { id } = (await res.json()) as { id: string };
      const done = await finish(id);
      return done.report as Report;
    },
    onSuccess: (r) => {
      setReport(r);
      if (r.mode === 'apply') toast(`${r.restored} missing record(s) restored`, 'success');
    },
  });

  const pick = (f: File | undefined) => {
    setReport(null);
    restore.reset();
    if (f && f.size > MAX_MB * 1024 * 1024) {
      toast(`Choose a backup file under ${MAX_MB} MB`, 'error');
      return;
    }
    setFile(f ?? null);
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Backup and recovery</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Keep a copy of the platform&apos;s data, and bring back records that were lost.
        </p>
      </div>

      <Card title="Back up now">
        <div className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Downloads one file with all companies, staff, customers, trips, bookings, payments and
            settings. Sessions, sign-in codes and queued notifications are left out. Keep the file
            somewhere safe: it contains personal data.
          </p>
          {create.error && <ErrorAlert error={create.error} />}
          <Button
            loading={create.isPending}
            loadingText="Preparing the backup, this can take a minute…"
            onClick={() => create.mutate()}
          >
            <Download aria-hidden="true" className="size-4" strokeWidth={1.8} />
            Download a backup
          </Button>
        </div>
      </Card>

      <Card title="Recover from a backup">
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-600" />
            Recovery only adds back records that are missing. It never changes or deletes anything
            that exists now, so an old backup cannot undo recent work. Check first to see what would
            come back.
          </p>
          <input
            ref={picker}
            type="file"
            accept=".gz,.nts,application/gzip"
            className="sr-only"
            aria-label="Backup file"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => picker.current?.click()}>
              <FileUp aria-hidden="true" className="size-4" strokeWidth={1.8} />
              Choose a backup file
            </Button>
            {file && (
              <span className="min-w-0 break-all text-sm text-slate-700 dark:text-slate-300">
                {file.name} ({(file.size / 1048576).toFixed(1)} MB)
              </span>
            )}
          </div>
          {restore.error && <ErrorAlert error={restore.error} />}
          {file && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                loading={restore.isPending && restore.variables === 'check'}
                loadingText="Checking…"
                onClick={() => restore.mutate('check')}
              >
                Check what would come back
              </Button>
              <Button
                loading={restore.isPending && restore.variables === 'apply'}
                loadingText="Restoring…"
                onClick={async () => {
                  if (
                    await ask({
                      title: 'Restore missing records?',
                      message:
                        'Records that exist in the backup but not now are added back. Nothing that exists is changed or deleted.',
                      confirmLabel: 'Restore',
                    })
                  )
                    restore.mutate('apply');
                }}
              >
                <DatabaseBackup aria-hidden="true" className="size-4" strokeWidth={1.8} />
                Restore missing records
              </Button>
            </div>
          )}
          {report && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
              <p className="font-semibold">
                {report.mode === 'check' ? 'Check result' : 'Restored'}: {report.restored} record(s){' '}
                {report.mode === 'check' ? 'would be added back' : 'added back'}
                {report.createdAt
                  ? ` from the backup of ${new Date(report.createdAt).toLocaleString()}`
                  : ''}
                .
              </p>
              {report.tables.some((t) => t.restored > 0) ? (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {report.tables
                    .filter((t) => t.restored > 0)
                    .map((t) => (
                      <li key={t.name} className="flex justify-between gap-3">
                        <span className="min-w-0 break-all">{t.name}</span>
                        <span className="font-semibold">{t.restored}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-slate-700 dark:text-slate-300">Nothing is missing.</p>
              )}
              {(report.notWritable?.length ?? 0) > 0 && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Left as they are (system settings this console does not change):{' '}
                  {report.notWritable!.join(', ')}.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
