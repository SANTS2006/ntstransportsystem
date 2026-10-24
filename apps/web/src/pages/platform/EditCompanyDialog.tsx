import { useMutation } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { PictureInput } from '../../components/ui/PictureInput';
import { api } from '../../lib/api';
import { isHexColor } from '../../lib/theme';
import type { TenantRow } from './CompaniesTable';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED = ['app', 'api', 'c', 'platform', 'login', 'register', 'trips', 'jobs', 'pay'];

interface Form {
  name: string;
  slug: string;
  timezone: string;
  defaultCurrency: string;
  primaryColor: string;
  accentColor: string;
}
const fromRow = (t: TenantRow): Form => ({
  name: t.name,
  slug: t.slug,
  timezone: t.timezone,
  defaultCurrency: t.defaultCurrency,
  primaryColor: t.primaryColor ?? '#0075df',
  accentColor: t.accentColor ?? '#fc8b01',
});

/** Platform staff correct a company's name, web address, timezone, currency, colours and logo. */
export function EditCompanyDialog({
  company,
  onClose,
  onSaved,
}: {
  company: TenantRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [f, setF] = useState<Form | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  useEffect(() => {
    if (company) {
      setF(fromRow(company));
      setLogo(null);
      setErrors({});
    }
  }, [company]);
  const save = useMutation({
    mutationFn: async () => {
      if (!company || !f) return;
      await api(`/platform/tenants/${company.id}`, {
        method: 'PATCH',
        body: { ...f, name: f.name.trim() },
      });
      if (logo) await api(`/platform/tenants/${company.id}/logo`, { method: 'PUT', file: logo });
    },
    onSuccess: () => onSaved('Company details saved'),
  });
  if (!f || !company)
    return (
      <Dialog open={false} title="" onClose={onClose}>
        {null}
      </Dialog>
    );
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (f.name.trim().length < 2) found.name = 'Enter the company name';
    if (f.slug.length < 3 || f.slug.length > 40 || !SLUG.test(f.slug)) {
      found.slug = 'Use 3 to 40 lower-case letters, digits or hyphens';
    } else if (RESERVED.includes(f.slug)) found.slug = 'That name is reserved';
    if (!/^[A-Z]{3}$/.test(f.defaultCurrency))
      found.defaultCurrency = 'Use a 3-letter code, e.g. SLE';
    if (!isHexColor(f.primaryColor)) found.primaryColor = 'Use a colour like #0075df';
    if (!isHexColor(f.accentColor)) found.accentColor = 'Use a colour like #fc8b01';
    setErrors(found);
    if (Object.keys(found).length === 0 && !save.isPending) save.mutate();
  };
  const origin = window.location.origin;
  return (
    <Dialog
      open
      title={`Edit ${company.name}`}
      onClose={() => {
        save.reset();
        onClose();
      }}
    >
      <form noValidate onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {save.error && <ErrorAlert error={save.error} />}
        <Field
          label="Company name"
          icon={Store}
          error={errors.name}
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Field
          label="Web address name"
          hint={
            f.slug !== company.slug
              ? `Changing it moves the company's pages to ${origin}/${f.slug}/login. Links using the old name stop working.`
              : `${origin}/${f.slug}/login`
          }
          error={errors.slug}
          value={f.slug}
          onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Timezone"
            hint="IANA name, e.g. Africa/Freetown"
            value={f.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          />
          <Field
            label="Currency"
            maxLength={3}
            error={errors.defaultCurrency}
            value={f.defaultCurrency}
            onChange={(e) => set({ defaultCurrency: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['Main colour', 'primaryColor'],
              ['Accent colour', 'accentColor'],
            ] as const
          ).map(([label, key]) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-semibold">{label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${label} picker`}
                  value={isHexColor(f[key]) ? f[key] : '#000000'}
                  onChange={(e) => set({ [key]: e.target.value })}
                  className="size-11 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                />
                <input
                  aria-label={`${label} code`}
                  value={f[key]}
                  maxLength={7}
                  onChange={(e) => set({ [key]: e.target.value })}
                  className="min-h-11 w-28 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm dark:border-slate-600 dark:bg-slate-900"
                />
              </div>
              {errors[key] && <p className="mt-1 text-xs text-red-700">{errors[key]}</p>}
            </div>
          ))}
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Logo</p>
          <div className="flex flex-wrap items-center gap-3">
            {company.logoUrl && !logo && (
              <img
                src={company.logoUrl}
                alt="Current logo"
                className="h-12 max-w-32 rounded-lg border border-slate-200 bg-white object-contain p-0.5"
              />
            )}
            <PictureInput
              label={company.logoUrl || logo ? 'Choose another logo' : 'Upload logo'}
              maxBytes={600_000}
              onPick={setLogo}
            />
            {logo && <span className="truncate text-xs text-slate-600">{logo.name}</span>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="secondary"
            onClick={() => {
              save.reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} loadingText="Saving…">
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
