import { useMutation, useQuery } from '@tanstack/react-query';
import { Paperclip, Send, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
  adminName: string | null;
  adminEmail: string | null;
}

/** Providers cap a message at about 4 MB in all. */
const MAX_TOTAL = 4 * 1024 * 1024;
const ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip';

const size = (n: number) =>
  n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** The platform console writes to a company's administrator, in the system's own look. */
export function PlatformEmailPage() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tenantId, setTenantId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const companies = useQuery({
    queryKey: ['platform', 'email-companies'],
    queryFn: ({ signal }) =>
      api<{ items: CompanyOption[] }>('/platform/email/companies', { signal }),
  });
  const chosen = companies.data?.items.find((c) => c.id === tenantId);
  const total = files.reduce((n, f) => n + f.size, 0);

  const send = useMutation({
    mutationFn: async () => {
      const attachments = await Promise.all(
        files.map(async (f) => ({ name: f.name, contentBase64: await toBase64(f) })),
      );
      return api<{ sentTo: string; company: string }>('/platform/email', {
        method: 'POST',
        body: { tenantId, subject, message, attachments },
      });
    },
    onSuccess: (r) => {
      toast(`Email sent to ${r.company} (${r.sentTo})`, 'success');
      setSubject('');
      setMessage('');
      setFiles([]);
    },
  });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) {
      setProblem('Attachments are too large: keep them under 4 MB in total.');
      return;
    }
    if (next.length > 6) {
      setProblem('Attach at most 6 files.');
      return;
    }
    setProblem(null);
    setFiles(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!tenantId) return setProblem('Choose the company to write to.');
    if (!chosen?.adminEmail) return setProblem('This company has no administrator email yet.');
    if (!subject.trim() || !message.trim()) return setProblem('Write a subject and a message.');
    setProblem(null);
    send.mutate();
  };

  return (
    <div className="w-full space-y-6">
      <h1 className="text-2xl font-semibold">Email</h1>
      <Card title="Write to a company">
        {companies.isPending && <PageLoader label="Loading companies" />}
        {companies.error && (
          <ErrorAlert error={companies.error} onRetry={() => void companies.refetch()} />
        )}
        {companies.data && (
          <form noValidate onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="mail-company" className="mb-1 block text-sm font-semibold">
                Company
              </label>
              <select
                id="mail-company"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">Choose a company…</option>
                {companies.data.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="To"
              readOnly
              value={
                chosen
                  ? chosen.adminEmail
                    ? `${chosen.adminName ?? 'Administrator'} <${chosen.adminEmail}>`
                    : 'This company has no administrator email yet'
                  : ''
              }
              placeholder="The company's administrator is chosen for you"
              hint="The administrator of the company you choose receives the message."
            />
            <Field
              label="Subject"
              value={subject}
              maxLength={150}
              onChange={(e) => setSubject(e.target.value)}
            />
            <div>
              <label htmlFor="mail-body" className="mb-1 block text-sm font-semibold">
                Message
              </label>
              <textarea
                id="mail-body"
                rows={8}
                maxLength={10000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </div>
            <div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="sr-only"
                aria-label="Attach files"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
                <Paperclip aria-hidden="true" className="size-4" strokeWidth={1.8} />
                Attach files, photos or videos
              </Button>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Up to 6 files and 4 MB in all.
              </p>
              {files.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800"
                    >
                      <span className="min-w-0 truncate">
                        {f.name} <span className="text-xs text-slate-500">{size(f.size)}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        className="grid size-8 place-items-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    </li>
                  ))}
                  <li className="text-xs text-slate-500">Total {size(total)}</li>
                </ul>
              )}
            </div>
            {problem && (
              <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
                {problem}
              </p>
            )}
            {send.error && <ErrorAlert error={send.error} />}
            <div className="flex justify-end">
              <Button type="submit" loading={send.isPending} loadingText="Sending…">
                <Send aria-hidden="true" className="size-4" strokeWidth={1.8} />
                Send email
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
