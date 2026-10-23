import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';

export const MAX_VOICE_SECONDS = 120;
const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Whether this browser can record from the microphone at all. */
export function canRecordVoice(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

const baseType = (t: string) => (t.split(';')[0] ?? '').trim().toLowerCase();
const extFor = (t: string) => (t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : 'webm');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function problemText(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone is blocked. Allow it for this site in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found on this device.';
  }
  return 'Could not start recording. Please try again, or type your message instead.';
}

/**
 * Records a voice message from the microphone, lets the person listen to it, and hands the result
 * up as a File (or null when it is removed). Nothing is sent from here; the page decides when to
 * upload. The microphone is released as soon as recording stops or the component goes away.
 */
export function VoiceRecorder({
  onChange,
  disabled = false,
  maxSeconds = MAX_VOICE_SECONDS,
}: {
  onChange: (file: File | null) => void;
  disabled?: boolean;
  maxSeconds?: number;
}) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const previewUrl = useRef<string | null>(null);

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  const forgetPreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  }, []);

  useEffect(
    () => () => {
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      release();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [release],
  );

  if (!canRecordVoice()) {
    return (
      <p className="text-xs text-slate-500">
        Voice messages are not available in this browser. Please type your message instead.
      </p>
    );
  }

  const start = async () => {
    setProblem(null);
    forgetPreview();
    onChange(null);
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setProblem(problemText(e));
      return;
    }
    stream.current = s;
    const mime = PREFERRED.find((t) => MediaRecorder.isTypeSupported?.(t));
    let r: MediaRecorder;
    try {
      r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
    } catch (e) {
      release();
      setProblem(problemText(e));
      return;
    }
    const chunks: Blob[] = [];
    r.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    r.onstop = () => {
      release();
      const type = baseType(r.mimeType || mime || 'audio/webm') || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) {
        setPhase('idle');
        setProblem('Nothing was recorded. Please try again.');
        return;
      }
      const file = new File([blob], `voice-message.${extFor(type)}`, { type });
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview(url);
      setPhase('ready');
      onChange(file);
    };
    recorder.current = r;
    setSeconds(0);
    r.start();
    setPhase('recording');
    timer.current = window.setInterval(() => {
      setSeconds((n) => {
        if (n + 1 >= maxSeconds && recorder.current?.state === 'recording') {
          recorder.current.stop();
        }
        return n + 1;
      });
    }, 1000);
  };

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };
  const remove = () => {
    forgetPreview();
    setPhase('idle');
    setSeconds(0);
    onChange(null);
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-sm font-medium">Voice message</p>
      {phase === 'idle' && (
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => void start()}
          >
            Record a voice message
          </Button>
          <p className="text-xs text-slate-500">
            Speak instead of typing. Up to {clock(maxSeconds)} minutes.
          </p>
        </>
      )}
      {phase === 'recording' && (
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" aria-live="polite" className="text-sm">
            <span
              aria-hidden="true"
              className="mr-2 inline-block size-2.5 animate-pulse rounded-full bg-red-600"
            />
            Recording {clock(seconds)} of {clock(maxSeconds)}
          </span>
          <Button type="button" onClick={stop}>
            Stop
          </Button>
        </div>
      )}
      {phase === 'ready' && preview && (
        <div className="space-y-2">
          <audio controls src={preview} className="w-full" aria-label="Your voice message" />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() => void start()}
            >
              Record again
            </Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={remove}>
              Remove
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
