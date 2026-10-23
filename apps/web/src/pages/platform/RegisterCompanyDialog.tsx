import { useMutation } from '@tanstack/react-query';
import { Mail, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { PictureInput } from '../../components/ui/PictureInput';
import { api } from '../../lib/api';
import { checkIdentifier } from '../../lib/identifier';
import { isHexColor } from '../../lib/theme';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED = ['app', 'api', 'c', 'platform', 'login', 'register', 'trips', 'jobs', 'pay'];

const slugFrom = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

interface Form {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  timezone: string;
  defaultCurrency: string;
  primaryColor: string;
  accentColor: string;
}
const EMPTY: Form = {
  name: '',
  slug: '',
  adminName: '',
  adminEmail: '',
  timezone: 'Africa/Freetown',
  defaultCurrency: 'SLE',
  primaryColor: '#0075df',
  accentColor: '#fc8b01',
};

/** The platform team's form for putting a new company on the system. */
export function RegisterCompanyDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [f, setF] = useState<Form>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const register = useMutation({
    mutationFn: async () => {
      const made = await api<{ id: string; adminEmail: string; adminAccountCreated: boolean }>(
        '/platform/tenants',
        { method: 'POST', body: f },
      );
      let logoFailed = false;
      if (logo) {
        try {
          await api(`/platform/tenants/${made.id}/logo`, { method: 'PUT', file: logo });
        } catch {
          logoFailed = true;
        }
      }
      return { ...made, logoFailed };
    },
    onSuccess: (r) => {
      onDone(
        `Company registered. Sign-in details were emailed to ${r.adminEmail}.` +
          (r.logoFailed
            ? ' The logo could not be uploaded: add it from the company Branding page.'
            : ''),
      );
      setF(EMPTY);
      setLogo(null);
      setSlugTouched(false);
      setErrors({});
    },
  });
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (f.name.trim().length < 2) found.name = 'Enter the company name';
    if (f.slug.length < 3 || f.slug.length > 40 || !SLUG.test(f.slug)) {
      found.slug = 'Use 3 to 40 lower-case letters, digits or hyphens';
    } else if (RESERVED.includes(f.slug)) found.slug = 'That name is reserved';
    if (f.adminName.trim().length < 2) found.adminName = 'Enter the administrator’s full name';
    if (!f.adminEmail.includes('@') || checkIdentifier(f.adminEmail, false)) {
      found.adminEmail = 'Enter a valid email address';
    }
    if (!/^[A-Z]{3}$/.test(f.defaultCurrency))
      found.defaultCurrency = 'Use a 3-letter code, e.g. SLE';
    if (!isHexColor(f.primaryColor)) found.primaryColor = 'Use a colour like #0075df';
    if (!isHexColor(f.accentColor)) found.accentColor = 'Use a colour like #fc8b01';
    setErrors(found);
    if (Object.keys(found).length === 0 && !register.isPending) register.mutate();
  };

  const close = () => {
    register.reset();
    onClose();
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <Dialog open={open} title="Register a company" onClose={close}>
      <form noValidate onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {register.error && <ErrorAlert error={register.error} />}
        <Field
          label="Company name"
          icon={Store}
          required
          error={errors.name}
          value={f.name}
          onChange={(e) =>
            set({
              name: e.target.value,
              ...(slugTouched ? {} : { slug: slugFrom(e.target.value) }),
            })
          }
        />
        <Field
          label="Web address name"
          hint={`${origin}/${f.slug || 'company-name'}/login`}
          error={errors.slug}
          value={f.slug}
          onChange={(e) => {
            setSlugTouched(true);
            set({ slug: e.target.value.toLowerCase() });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Administrator's full name"
            autoComplete="off"
            error={errors.adminName}
            value={f.adminName}
            onChange={(e) => set({ adminName: e.target.value })}
          />
          <Field
            label="Administrator's email"
            type="email"
            icon={Mail}
            autoComplete="off"
            error={errors.adminEmail}
            value={f.adminEmail}
            onChange={(e) => set({ adminEmail: e.target.value })}
          />
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          A temporary password (the first letters of the company name, an @ and this year) is
          emailed to the administrator with the sign-in link. They must choose their own password at
          first sign-in.
        </p>
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
              <label className="mb-1 block text-sm font-medium">{label}</label>
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
          <p className="mb-1 text-sm font-medium">Logo (optional)</p>
          <div className="flex flex-wrap items-center gap-3">
            <PictureInput
              label={logo ? 'Choose another logo' : 'Upload logo'}
              maxBytes={600_000}
              onPick={setLogo}
            />
            {logo && <span className="truncate text-xs text-slate-600">{logo.name}</span>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={register.isPending} loadingText="Registering…">
            Register company
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
