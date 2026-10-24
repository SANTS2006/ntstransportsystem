import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, ErrorAlert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, StatusBadge } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageLoader } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { Attachments, useFileUploadsEnabled } from '../../components/files/FileControls';
import { VoiceRecorder } from '../../components/files/VoiceRecorder';

const CATEGORIES = [
  { value: 'DELAY', label: 'Delay' },
  { value: 'VEHICLE', label: 'Vehicle condition' },
  { value: 'STAFF_CONDUCT', label: 'Staff conduct' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'SAFETY', label: 'Safety' },
  { value: 'OTHER', label: 'Something else' },
];
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
const badge = (s: string) => (s === 'RESOLVED' || s === 'CLOSED' ? 'ACTIVE' : 'PENDING');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

interface ComplaintRow {
  id: string;
  company: string;
  bookingReference: string;
  category: string;
  subject: string;
  status: string;
  updatedAt: string;
}
interface Thread extends ComplaintRow {
  messages: { id: string; from: 'YOU' | 'COMPANY'; body: string; at: string }[];
}

export function MyComplaintsPage() {
  const q = useQuery({
    queryKey: ['passenger-complaints'],
    queryFn: ({ signal }) =>
      api<{ complaints: ComplaintRow[] }>('/passenger/complaints', { signal }),
  });
  return (
    <div className="mx-auto w-[90%] space-y-4">
      <h1 className="text-2xl font-semibold">My complaints</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        To report a problem, open the booking it is about in{' '}
        <Link className="font-medium" to="/app/bookings">
          My bookings
        </Link>
        .
      </p>
      {q.isPending && <PageLoader label="Loading" />}
      {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.complaints.length === 0 && (
        <Alert tone="info">You have not sent any complaints.</Alert>
      )}
      <ul className="space-y-3">
        {q.data?.complaints.map((c) => (
          <li key={c.id}>
            <Link
              to={`/app/complaints/${c.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-600 dark:border-slate-700 dark:bg-slate-900"
            >
              <span>
                <span className="block font-medium">{c.subject}</span>
                <span className="text-xs text-slate-500">
                  {c.company} · booking {c.bookingReference} · updated {when(c.updatedAt)}
                </span>
              </span>
              <StatusBadge status={badge(c.status)} label={STATUS_LABEL[c.status] ?? c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NewComplaintPage() {
  const [params] = useSearchParams();
  const bookingId = params.get('booking') ?? '';
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [category, setCategory] = useState('DELAY');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [voice, setVoice] = useState<File | null>(null);
  const voiceAvailable = useFileUploadsEnabled();
  const send = useMutation({
    mutationFn: async () => {
      const made = await api<{ id: string }>('/passenger/complaints', {
        method: 'POST',
        body: {
          bookingId,
          category,
          subject: subject.trim(),
          ...(body.trim() ? { body: body.trim() } : {}),
          ...(voice ? { voice: true } : {}),
        },
      });
      // The complaint exists now; the recording follows. If it cannot be sent, say so and let the
      // passenger add it from the complaint page instead of losing the complaint.
      let voiceSent = true;
      if (voice) {
        try {
          await api(`/passenger/complaints/${made.id}/attachments`, {
            method: 'POST',
            file: voice,
          });
        } catch {
          voiceSent = false;
        }
      }
      return { id: made.id, voiceSent };
    },
    onSuccess: async (r) => {
      if (r.voiceSent) toast('Your complaint was sent', 'success');
      else
        toast(
          'Your complaint was sent, but the voice message could not be uploaded. Please record it again below.',
          'error',
        );
      await qc.invalidateQueries({ queryKey: ['passenger-complaints'] });
      void nav(`/app/complaints/${r.id}`, { replace: true });
    },
  });
  if (!bookingId)
    return <Alert tone="error">Open a booking first, then choose Report a problem.</Alert>;
  const valid = subject.trim().length >= 3 && (body.trim().length >= 5 || voice !== null);
  return (
    <div className="mx-auto w-[90%] space-y-4">
      <h1 className="text-2xl font-semibold">Report a problem</h1>
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !send.isPending) send.mutate();
          }}
        >
          <div>
            <label htmlFor="cp-cat" className="mb-1 block text-sm font-medium">
              What is it about?
            </label>
            <select
              id="cp-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Short summary"
            value={subject}
            maxLength={150}
            onChange={(e) => setSubject(e.target.value)}
          />
          <div>
            <label htmlFor="cp-body" className="mb-1 block text-sm font-medium">
              {voiceAvailable
                ? 'What happened? (type it, or record a voice message below)'
                : 'What happened?'}
            </label>
            <textarea
              id="cp-body"
              rows={5}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </div>
          {voiceAvailable && <VoiceRecorder onChange={setVoice} disabled={send.isPending} />}
          {send.error && <ErrorAlert error={send.error} />}
          <Button type="submit" disabled={!valid} loading={send.isPending} loadingText="Sending…">
            Send complaint
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function ComplaintThreadPage() {
  const { id } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const q = useQuery({
    queryKey: ['passenger-complaint', id],
    queryFn: ({ signal }) => api<Thread>(`/passenger/complaints/${id}`, { signal }),
  });
  const send = useMutation({
    mutationFn: () =>
      api(`/passenger/complaints/${id}/messages`, { method: 'POST', body: { body: text.trim() } }),
    onSuccess: async () => {
      setText('');
      await qc.invalidateQueries({ queryKey: ['passenger-complaint', id] });
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  if (q.isPending) return <PageLoader label="Loading" />;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  return (
    <div className="mx-auto w-[90%] space-y-4">
      <Link className="text-sm text-brand-700 font-medium dark:text-brand-500" to="/app/complaints">
        My complaints
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{c.subject}</h1>
          <p className="text-xs text-slate-500">
            {c.company} · booking {c.bookingReference}
          </p>
        </div>
        <StatusBadge status={badge(c.status)} label={STATUS_LABEL[c.status] ?? c.status} />
      </div>
      <ol className="space-y-3" aria-label="Conversation">
        {c.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-xl p-3 text-sm ${
              m.from === 'YOU'
                ? 'ml-auto bg-brand-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800'
            }`}
          >
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className={`mt-1 text-xs ${m.from === 'YOU' ? 'text-brand-50' : 'text-slate-500'}`}>
              {m.from === 'YOU' ? 'You' : c.company} · {when(m.at)}
            </p>
          </li>
        ))}
      </ol>
      <Attachments
        listPath={`/passenger/complaints/${c.id}/attachments`}
        uploadPath={`/passenger/complaints/${c.id}/attachments`}
        linkPath={(fid) => `/passenger/complaints/${c.id}/attachments/${fid}/link`}
        canUpload={c.status !== 'CLOSED'}
      />
      {c.status === 'CLOSED' ? (
        <Alert tone="info">
          This complaint is closed. You can start a new one from your booking.
        </Alert>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !send.isPending) send.mutate();
          }}
        >
          <label htmlFor="cp-reply" className="block text-sm font-medium">
            {c.status === 'RESOLVED' ? 'Not solved? Tell us more' : 'Add a message'}
          </label>
          <textarea
            id="cp-reply"
            rows={3}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
          <Button
            type="submit"
            disabled={!text.trim()}
            loading={send.isPending}
            loadingText="Sending…"
          >
            Send
          </Button>
        </form>
      )}
    </div>
  );
}

/** Star rating for a completed trip; shows the given rating once it has been sent. */
export function RateTrip({ bookingId }: { bookingId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const given = useQuery({
    queryKey: ['passenger-rating', bookingId],
    queryFn: ({ signal }) =>
      api<{ rating: { rating: number; comment: string | null } | null }>(
        `/passenger/bookings/${bookingId}/rating`,
        { signal },
      ),
  });
  const send = useMutation({
    mutationFn: () =>
      api(`/passenger/bookings/${bookingId}/rating`, {
        method: 'POST',
        body: { rating: stars, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      }),
    onSuccess: async () => {
      toast('Thanks for your feedback', 'success');
      await qc.invalidateQueries({ queryKey: ['passenger-rating', bookingId] });
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  if (given.isPending) return null;
  if (given.data?.rating) {
    return (
      <p
        className="mt-3 text-sm"
        aria-label={`You rated this trip ${given.data.rating.rating} out of 5`}
      >
        Your rating: {'★'.repeat(given.data.rating.rating)}
        {'☆'.repeat(5 - given.data.rating.rating)}
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <p className="text-sm font-medium">How was your trip?</p>
      <div role="radiogroup" aria-label="Rating" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={() => setStars(n)}
            className={`min-h-11 min-w-11 rounded-lg border text-lg ${
              n <= stars
                ? 'border-amber-500 bg-amber-100 text-amber-700'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            ★
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <Field
            label="Comment (optional)"
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button loading={send.isPending} loadingText="Sending…" onClick={() => send.mutate()}>
            Send rating
          </Button>
        </>
      )}
    </div>
  );
}
