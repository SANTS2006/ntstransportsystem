import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import { Alert, ErrorAlert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageLoader } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { VoiceRecorder } from './VoiceRecorder';

const MB = 1024 * 1024;
export type Media = 'document' | 'image' | 'audio' | 'video';
/** Largest size per kind of file; the server enforces the same limits. */
export const LIMITS: Record<Media, number> = {
  document: 5 * MB,
  image: 5 * MB,
  audio: 10 * MB,
  video: 25 * MB,
};
/** The biggest of them: anything larger is refused before looking at its type. */
export const MAX_UPLOAD_BYTES = LIMITS.video;

const DOCS_AND_IMAGES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MEDIA_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
];
const ACCEPT_CV = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const ACCEPT_ATTACHMENT = `${ACCEPT_CV},audio/*,video/*`;

export const mediaOf = (type: string): Media =>
  type.startsWith('audio/')
    ? 'audio'
    : type.startsWith('video/')
      ? 'video'
      : type.startsWith('image/')
        ? 'image'
        : 'document';

/** Whether the server has file storage configured. Upload controls are hidden when it does not. */
export function useFileUploadsEnabled(): boolean {
  return useFeatures().fileUploads;
}

/**
 * Checks a chosen file before sending it. The server checks again: this only saves a round trip.
 * A CV is a document or a picture; other attachments may also be audio or video.
 */
export function fileProblem(f: File, use: 'cv' | 'attachment' = 'cv'): string | null {
  if (f.size === 0) return 'That file is empty.';
  const type = f.type.toLowerCase().split(';')[0] ?? '';
  const ok = DOCS_AND_IMAGES.includes(type) || (use === 'attachment' && MEDIA_TYPES.includes(type));
  if (!ok) {
    return use === 'cv'
      ? 'Choose a PDF or an image (PNG, JPEG or WebP).'
      : 'Choose a PDF, a photo, an audio recording or a video.';
  }
  const kind = mediaOf(type);
  if (f.size > LIMITS[kind]) {
    return `That ${kind === 'document' ? 'file' : kind} is larger than ${LIMITS[kind] / MB} MB.`;
  }
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
  media?: Media;
  sizeBytes: number;
}
const kb = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const isSafeUrl = (u: string) => /^https:\/\//.test(u) || u.startsWith('/');
const isLocalHttp = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u);

/** Starts a download from a short-lived signed link. */
function openLink(l: Link) {
  if (!isSafeUrl(l.url) && !isLocalHttp(l.url)) throw new Error('Invalid download link');
  window.location.assign(l.url);
}

function Picker({
  label,
  busy,
  onPick,
  error,
  accept,
}: {
  label: string;
  busy: boolean;
  onPick: (f: File) => void;
  error: string | null;
  accept: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={accept}
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
  current,
}: {
  uploadPath?: string;
  linkPath: string;
  canUpload: boolean;
  /** File name of the CV already on file, if any. */
  current: string | null;
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
  const hasCv = uploaded !== null || current !== null;
  if (!enabled) return null;
  if (!hasCv && !(canUpload && uploadPath)) {
    return <span className="text-xs text-slate-500">No CV attached</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {canUpload && uploadPath && (
        <Picker
          label={hasCv ? 'Replace CV' : 'Upload CV'}
          accept={ACCEPT_CV}
          busy={upload.isPending}
          error={problem}
          onPick={(f) => {
            const p = fileProblem(f, 'cv');
            setProblem(p);
            if (!p) upload.mutate(f);
          }}
        />
      )}
      {hasCv && (
        <Button variant="ghost" loading={open.isPending} onClick={() => open.mutate()}>
          Open CV
        </Button>
      )}
      {(uploaded ?? current) && (
        <span className="text-xs text-slate-500">
          {uploaded ? 'Saved' : 'On file'}: {uploaded ?? current}
        </span>
      )}
    </div>
  );
}

const SHOW_LABEL: Record<Media, string> = {
  document: 'Open',
  image: 'View photo',
  audio: 'Play',
  video: 'Watch',
};

/** One attached file: a download, or a photo/recording/video shown right here. */
function AttachmentRow({ f, linkPath }: { f: FileInfo; linkPath: (id: string) => string }) {
  const toast = useToast();
  const media = f.media ?? mediaOf(f.contentType);
  const [shown, setShown] = useState<string | null>(null);
  const fail = (e: unknown) =>
    toast(e instanceof Error ? e.message : 'Could not open the file', 'error');
  const show = useMutation({
    mutationFn: () => api<Link>(`${linkPath(f.id)}?inline=1`),
    onSuccess: (l) => {
      if (isSafeUrl(l.url) || isLocalHttp(l.url)) setShown(l.url);
      else fail(new Error('Invalid link'));
    },
    onError: fail,
  });
  const download = useMutation({
    mutationFn: () => api<Link>(linkPath(f.id)),
    onSuccess: (l) => {
      try {
        openLink(l);
      } catch (e) {
        fail(e);
      }
    },
    onError: fail,
  });
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{f.displayName}</span>
        <span className="text-xs text-slate-500">{kb(f.sizeBytes)}</span>
        {media !== 'document' && !shown && (
          <button
            type="button"
            className="text-brand-700 font-medium dark:text-brand-500"
            disabled={show.isPending}
            onClick={() => show.mutate()}
          >
            {show.isPending ? 'Loading…' : SHOW_LABEL[media]}
          </button>
        )}
        <button
          type="button"
          className="text-brand-700 font-medium dark:text-brand-500"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {media === 'document' ? SHOW_LABEL.document : 'Download'}
        </button>
      </div>
      {shown && media === 'audio' && (
        <audio
          controls
          autoPlay
          src={shown}
          className="w-full max-w-md"
          aria-label={f.displayName}
        />
      )}
      {shown && media === 'video' && (
        <video
          controls
          src={shown}
          className="max-h-80 w-full max-w-md rounded-lg bg-black"
          aria-label={f.displayName}
        />
      )}
      {shown && media === 'image' && (
        <img src={shown} alt={f.displayName} className="max-h-80 rounded-lg" />
      )}
    </li>
  );
}

/** Up to four files on a complaint: photos, videos, documents and voice messages. */
export function Attachments({
  listPath,
  uploadPath,
  linkPath,
  canUpload,
  max = 4,
}: {
  listPath: string;
  uploadPath: string;
  linkPath: (fileId: string) => string;
  canUpload: boolean;
  max?: number;
}) {
  const qc = useQueryClient();
  const enabled = useFileUploadsEnabled();
  const [problem, setProblem] = useState<string | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [voiceKey, setVoiceKey] = useState(0);
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
  const sendVoice = useMutation({
    mutationFn: (file: File) => api<FileInfo>(uploadPath, { method: 'POST', file }),
    onSuccess: async () => {
      setProblem(null);
      setVoice(null);
      setVoiceKey((k) => k + 1); // a fresh recorder
      await qc.invalidateQueries({ queryKey: ['files', listPath] });
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Upload failed'),
  });
  if (!enabled) return null;
  const files = list.data?.files ?? [];
  const room = files.length < max;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Attachments</p>
      {list.isPending && <PageLoader label="Loading attachments" />}
      {list.error && <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />}
      {files.length === 0 && !list.isPending && <p className="text-xs text-slate-500">None.</p>}
      <ul className="space-y-2 text-sm">
        {files.map((f) => (
          <AttachmentRow key={f.id} f={f} linkPath={linkPath} />
        ))}
      </ul>
      {canUpload && room && (
        <div className="space-y-3">
          <Picker
            label="Attach a file, photo or video"
            accept={ACCEPT_ATTACHMENT}
            busy={upload.isPending}
            error={problem}
            onPick={(f) => {
              const p = fileProblem(f, 'attachment');
              setProblem(p);
              if (!p) upload.mutate(f);
            }}
          />
          <VoiceRecorder key={voiceKey} onChange={setVoice} disabled={sendVoice.isPending} />
          {voice && (
            <Button
              loading={sendVoice.isPending}
              loadingText="Sending…"
              onClick={() => sendVoice.mutate(voice)}
            >
              Send voice message
            </Button>
          )}
        </div>
      )}
      {canUpload && !room && (
        <Alert tone="info">You have attached the maximum of {max} files.</Alert>
      )}
    </div>
  );
}
