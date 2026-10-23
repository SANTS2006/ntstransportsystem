import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Alert, ErrorAlert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/** Whether the server has file storage configured. Upload controls are hidden when it does not. */
export function useFileUploadsEnabled(): boolean {
  const q = useQuery({
    queryKey: ['features'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => api<{ fileUploads: boolean }>('/features', { signal }),
  });
  return q.data?.fileUploads === true;
}

/** Checks a chosen file before sending it. The server checks again: this only saves a round trip. */
export function fileProblem(f: File): string | null {
  if (f.size === 0) return 'That file is empty.';
  if (f.size > MAX_UPLOAD_BYTES) return 'The file is larger than 5 MB.';
  if (!TYPES.includes(f.type)) return 'Choose a PDF, PNG or JPEG file.';
  return null;
}

interface Link {
  url: string;
  filename: string;
}
interface FileInfo {
  id: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
}
const kb = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Starts a download from a short-lived signed link. The file is always sent as an attachment. */
function openLink(l: Link) {
  if (!/^https?:\/\//.test(l.url) && !l.url.startsWith('/'))
    throw new Error('Invalid download link');
  window.location.assign(l.url);
}

function Picker({
  label,
  busy,
  onPick,
  error,
}: {
  label: string;
  busy: boolean;
  onPick: (f: File) => void;
  error: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label={label}
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
      <Button
        variant="secondary"
        loading={busy}
        loadingText="Uploading…"
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** CV of one application: upload or replace, and open the current one. */
export function CvControl({
  uploadPath,
  linkPath,
  canUpload,
}: {
  uploadPath?: string;
  linkPath: string;
  canUpload: boolean;
}) {
  const toast = useToast();
  const [problem, setProblem] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const enabled = useFileUploadsEnabled();
  const open = useMutation({
    mutationFn: () => api<Link>(linkPath),
    onSuccess: (l) => {
      try {
        openLink(l);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not open the file', 'error');
      }
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not open the file', 'error'),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api<FileInfo>(uploadPath as string, { method: 'POST', file }),
    onSuccess: (f) => {
      setUploaded(f.displayName);
      toast('CV uploaded', 'success');
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Upload failed'),
  });
  if (!enabled) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {canUpload && uploadPath && (
        <Picker
          label={uploaded ? 'Replace CV' : 'Upload CV'}
          busy={upload.isPending}
          error={problem}
          onPick={(f) => {
            const p = fileProblem(f);
            setProblem(p);
            if (!p) upload.mutate(f);
          }}
        />
      )}
      <Button variant="ghost" loading={open.isPending} onClick={() => open.mutate()}>
        Open CV
      </Button>
      {uploaded && <span className="text-xs text-slate-500">Saved: {uploaded}</span>}
    </div>
  );
}

/** Up to three files on a complaint: list, add, open. */
export function Attachments({
  listPath,
  uploadPath,
  linkPath,
  canUpload,
  max = 3,
}: {
  listPath: string;
  uploadPath: string;
  linkPath: (fileId: string) => string;
  canUpload: boolean;
  max?: number;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const enabled = useFileUploadsEnabled();
  const [problem, setProblem] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['files', listPath],
    enabled,
    queryFn: ({ signal }) => api<{ files: FileInfo[] }>(listPath, { signal }),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api<FileInfo>(uploadPath, { method: 'POST', file }),
    onSuccess: async () => {
      setProblem(null);
      await qc.invalidateQueries({ queryKey: ['files', listPath] });
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Upload failed'),
  });
  const open = useMutation({
    mutationFn: (id: string) => api<Link>(linkPath(id)),
    onSuccess: (l) => {
      try {
        openLink(l);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not open the file', 'error');
      }
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not open the file', 'error'),
  });
  if (!enabled) return null;
  const files = list.data?.files ?? [];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Attachments</p>
      {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
      {files.length === 0 && !list.isPending && <p className="text-xs text-slate-500">None.</p>}
      <ul className="space-y-1 text-sm">
        {files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-brand-700 underline dark:text-brand-500"
              onClick={() => open.mutate(f.id)}
            >
              {f.displayName}
            </button>
            <span className="text-xs text-slate-500">{kb(f.sizeBytes)}</span>
          </li>
        ))}
      </ul>
      {canUpload && files.length < max && (
        <Picker
          label="Attach a file"
          busy={upload.isPending}
          error={problem}
          onPick={(f) => {
            const p = fileProblem(f);
            setProblem(p);
            if (!p) upload.mutate(f);
          }}
        />
      )}
      {canUpload && files.length >= max && (
        <Alert tone="info">You have attached the maximum of {max} files.</Alert>
      )}
    </div>
  );
}
