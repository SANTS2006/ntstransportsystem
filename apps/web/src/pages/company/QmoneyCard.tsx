import { formatPhone, normalizePhone } from '@nts/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';

interface Qmoney {
  number: string | null;
  accountName: string | null;
}

/**
 * QMoney is paid straight to the company's own number: the passenger sends the money, types the
 * transaction number, and staff confirm it after checking their QMoney statement.
 */
export function QmoneyCard({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['company', tenantId, 'qmoney'];
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<Qmoney>(`/tenants/${tenantId}/payment-settings/qmoney`, { signal }),
  });
  const [number, setNumber] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const shownNumber = number ?? q.data?.number ?? '';
  const shownName = name ?? q.data?.accountName ?? '';
  const valid = normalizePhone(shownNumber) !== null;
  const save = useMutation({
    mutationFn: (v: { number: string | null; accountName: string | null }) =>
      api<Qmoney>(`/tenants/${tenantId}/payment-settings/qmoney`, { method: 'PUT', body: v }),
    onSuccess: async (r) => {
      toast(r.number ? 'QMoney number saved' : 'QMoney is no longer offered', 'success');
      setNumber(null);
      setName(null);
      await qc.invalidateQueries({ queryKey: key });
    },
  });
  return (
    <Card title="QMoney">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Monime&apos;s checkout does not take QMoney. Instead, passengers see your QMoney number,
        send the money, and type the transaction number. Their seats are held for two hours while
        you check your QMoney statement and press &ldquo;Take payment&rdquo; on the booking.
      </p>
      {q.isPending && <PageLoader label="Loading QMoney settings" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate({ number: shownNumber, accountName: shownName.trim() || null });
          }}
        >
          <Field
            label="Your QMoney number"
            type="tel"
            inputMode="tel"
            value={shownNumber}
            hint={
              q.data.number
                ? `Passengers pay ${formatPhone(q.data.number)}`
                : 'The number passengers send money to, like 033 123 456'
            }
            error={shownNumber && !valid ? 'Enter a valid phone number' : undefined}
            onChange={(e) => setNumber(e.target.value)}
          />
          <Field
            label="Name on the account (shown to passengers)"
            value={shownName}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          {save.error && <ErrorAlert error={save.error} />}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!valid} loading={save.isPending} loadingText="Saving…">
              Save QMoney number
            </Button>
            {q.data.number && (
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => save.mutate({ number: null, accountName: null })}
              >
                Stop offering QMoney
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
