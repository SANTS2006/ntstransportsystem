import { useMutation } from '@tanstack/react-query';
import { useConfirm } from '../../components/ui/Confirm';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/layout/Layouts';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PictureInput } from '../../components/ui/PictureInput';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';

const AVATAR_MAX = 400_000;

/** The person's own details: their name and their picture. */
export function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.displayName ?? '');
  const [problem, setProblem] = useState<string | undefined>();
  const saveName = useMutation({
    mutationFn: () => api('/auth/me', { method: 'PATCH', body: { displayName: name.trim() } }),
    onSuccess: async () => {
      await refresh();
      toast('Your name is saved', 'success');
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => api('/auth/me/avatar', { method: 'PUT', file }),
    onSuccess: async () => {
      await refresh();
      toast('Your picture is updated', 'success');
    },
  });
  const ask = useConfirm();
  const remove = useMutation({
    mutationFn: () => api('/auth/me/avatar', { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      toast('Your picture is removed', 'success');
    },
  });
  if (!user) return null;
  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl">Profile and settings</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your name and picture show in the top corner and wherever a company sees who you are.
        </p>
      </div>
      <Card title="Profile picture">
        {(upload.error ?? remove.error) && <ErrorAlert error={upload.error ?? remove.error} />}
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={user.displayName} version={user.avatarVersion} size="lg" />
          <div className="flex flex-wrap gap-2">
            <PictureInput
              label={user.avatarVersion ? 'Change picture' : 'Upload a picture'}
              maxBytes={AVATAR_MAX}
              disabled={upload.isPending}
              onPick={(f) => upload.mutate(f)}
            />
            {user.avatarVersion && (
              <Button
                variant="dangerQuiet"
                loading={remove.isPending}
                loadingText="Removing…"
                onClick={async () => {
                  if (
                    await ask({
                      title: 'Remove your picture?',
                      message: 'Your initials show instead.',
                      confirmLabel: 'Remove picture',
                      danger: true,
                    })
                  )
                    remove.mutate();
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">PNG, JPEG or WebP, up to 400 KB.</p>
      </Card>
      <Card title="Your details">
        {saveName.error && <ErrorAlert error={saveName.error} />}
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setProblem('Enter your name');
              return;
            }
            setProblem(undefined);
            saveName.mutate();
          }}
        >
          <Field
            label="Full name"
            autoComplete="name"
            maxLength={100}
            error={problem}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field label="Email address" value={user.email ?? ''} disabled readOnly />
          {user.phone && <Field label="Phone number" value={user.phone} disabled readOnly />}
          <p className="text-xs text-slate-500">
            Your email or phone number is how you sign in, so it cannot be changed here.
          </p>
          <Button type="submit" loading={saveName.isPending} loadingText="Saving…">
            Save changes
          </Button>
        </form>
      </Card>
      <Card title="Password and two-step verification">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Change your password, turn on two-step verification and review where you are signed in.
        </p>
        <Link className="mt-3 inline-block text-sm font-semibold text-brand-600" to="/app/security">
          Open security settings
        </Link>
      </Card>
    </div>
  );
}
