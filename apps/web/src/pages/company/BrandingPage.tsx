import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../components/ui/Confirm';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/ui/Spinner';
import { PictureInput } from '../../components/ui/PictureInput';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { isHexColor } from '../../lib/theme';
import { can, useCompany } from './company-context';

export interface Branding {
  primaryColor: string | null;
  accentColor: string | null;
  hasLogo: boolean;
  slug: string | null;
  logoUrl: string | null;
}

const DEFAULT_PRIMARY = '#0075df';
const DEFAULT_ACCENT = '#fc8b01';

/** Two colour pickers: a swatch for choosing, a text box for typing the code. */
function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = isHexColor(value);
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-11 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
        />
        <input
          aria-label={`${label} code`}
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          className={`min-h-11 w-32 rounded-lg border bg-white px-3 font-mono text-sm dark:bg-slate-900 ${
            valid ? 'border-slate-300 dark:border-slate-600' : 'border-red-600'
          }`}
        />
      </div>
      {!valid && <p className="mt-1 text-xs text-red-700">Use a colour like #0075df.</p>}
    </div>
  );
}

/** The company's logo and colours, and the web addresses its customers use. */
export function BrandingPage() {
  const { tenantId, access } = useCompany();
  const canEdit = can(access, 'tenant.profile.update');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['company', tenantId, 'branding'],
    queryFn: ({ signal }) => api<Branding>(`/tenants/${tenantId}/branding`, { signal }),
  });
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  useEffect(() => {
    if (q.data) {
      setPrimary(q.data.primaryColor ?? DEFAULT_PRIMARY);
      setAccent(q.data.accentColor ?? DEFAULT_ACCENT);
    }
  }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['company', tenantId] });
  const saveColours = useMutation({
    mutationFn: () =>
      api(`/tenants/${tenantId}/branding`, {
        method: 'PATCH',
        body: { primaryColor: primary.toLowerCase(), accentColor: accent.toLowerCase() },
      }),
    onSuccess: async () => {
      toast('Colours saved. They now apply across your workspace.', 'success');
      await refresh();
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => api(`/tenants/${tenantId}/branding/logo`, { method: 'PUT', file }),
    onSuccess: async () => {
      toast('Logo updated', 'success');
      await refresh();
    },
  });
  const ask = useConfirm();
  const removeLogo = useMutation({
    mutationFn: () => api(`/tenants/${tenantId}/branding/logo`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Logo removed', 'success');
      await refresh();
    },
  });

  if (q.isPending) return <PageLoader label="Loading branding" />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const origin = window.location.origin;
  const loginUrl = b.slug ? `${origin}/${b.slug}/login` : '';
  const registerUrl = b.slug ? `${origin}/${b.slug}/register` : '';
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Link copied', 'success');
    } catch {
      toast('Copy it by hand: select the address and press Ctrl+C', 'error');
    }
  };
  const colourOk = isHexColor(primary) && isHexColor(accent);
  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl">Branding</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your logo and two colours appear on your sign-in page and across your workspace.
        </p>
      </div>

      <Card title="Logo">
        {(upload.error ?? removeLogo.error) && (
          <ErrorAlert error={upload.error ?? removeLogo.error} />
        )}
        <div className="flex flex-wrap items-center gap-5">
          {b.logoUrl ? (
            <img
              src={b.logoUrl}
              alt="Your logo"
              className="h-20 max-w-48 rounded-lg border border-slate-200 bg-white object-contain p-1"
            />
          ) : (
            <span className="grid h-20 w-32 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">
              No logo yet
            </span>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <PictureInput
                label={b.hasLogo ? 'Change logo' : 'Upload logo'}
                maxBytes={600_000}
                disabled={upload.isPending}
                onPick={(f) => upload.mutate(f)}
              />
              {b.hasLogo && (
                <Button
                  variant="dangerQuiet"
                  loading={removeLogo.isPending}
                  loadingText="Removing…"
                  onClick={async () => {
                    if (
                      await ask({
                        title: 'Remove the logo?',
                        message: 'Your sign-in page and workspace show your name instead.',
                        confirmLabel: 'Remove logo',
                        danger: true,
                      })
                    )
                      removeLogo.mutate();
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">PNG, JPEG or WebP, up to 600 KB.</p>
      </Card>

      <Card title="Colours">
        {saveColours.error && <ErrorAlert error={saveColours.error} />}
        <div className="flex flex-wrap items-start gap-6">
          <ColourField label="Main colour" value={primary} onChange={setPrimary} />
          <ColourField label="Accent colour" value={accent} onChange={setAccent} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: isHexColor(primary) ? primary : DEFAULT_PRIMARY }}
          >
            Main colour
          </span>
          <span
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: isHexColor(accent) ? accent : DEFAULT_ACCENT }}
          >
            Accent colour
          </span>
        </div>
        {canEdit && (
          <Button
            className="mt-4"
            disabled={!colourOk}
            loading={saveColours.isPending}
            loadingText="Saving…"
            onClick={() => saveColours.mutate()}
          >
            Save colours
          </Button>
        )}
      </Card>

      {b.slug && (
        <Card title="Your web addresses">
          <dl className="space-y-3 text-sm">
            {[
              ['Sign-in page', loginUrl],
              ['Sign-up page for your customers', registerUrl],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1.5 dark:bg-slate-800">
                    {v}
                  </code>
                  <Button variant="secondary" onClick={() => void copy(v!)}>
                    <Copy aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    Copy
                  </Button>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Share the sign-up page with your passengers. Anyone who signs up there can book tickets
            and use the other passenger features.
          </p>
        </Card>
      )}
    </div>
  );
}
