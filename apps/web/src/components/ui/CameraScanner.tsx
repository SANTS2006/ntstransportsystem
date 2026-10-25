import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** The codes a ticket can carry: its QR code, or a barcode of its ticket code. */
const NATIVE_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'itf'];

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface DetectorClass {
  new (opts: { formats: string[] }): DetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function explain(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was refused. Allow the camera for this site in the browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError')
    return 'The camera is being used by another app. Close it and try again.';
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'The camera only works on a secure (https) address.';
  }
  return 'The camera could not be started.';
}

/**
 * Live camera scanner for QR codes and barcodes. It uses the browser's own barcode reader where
 * there is one (Chrome on Android) and a bundled reader everywhere else (iPhone, Firefox), and
 * keeps scanning: every code it reads is handed to `onDetect`.
 */
export function CameraScanner({ onDetect }: { onDetect: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onDetect);
  handler.current = onDetect;
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let stopped = false;
    let stop: () => void = () => undefined;

    const start = async () => {
      const el = video.current;
      if (!el) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('no camera api'), { name: 'NotFoundError' });
      }
      const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
      const supported = Native ? await Native.getSupportedFormats().catch(() => []) : [];
      if (Native && supported.includes('qr_code')) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        el.srcObject = stream;
        await el.play();
        const detector = new Native({
          formats: NATIVE_FORMATS.filter((f) => supported.includes(f)),
        });
        let timer = 0;
        const tick = async () => {
          if (stopped) return;
          if (el.readyState >= 2) {
            const found = await detector.detect(el).catch(() => []);
            const text = found[0]?.rawValue;
            if (text) handler.current(text);
          }
          timer = window.setTimeout(() => void tick(), 180);
        };
        void tick();
        stop = () => {
          window.clearTimeout(timer);
          stream.getTracks().forEach((t) => t.stop());
        };
        return;
      }
      // No built-in reader: load the bundled one only now, so the page stays light.
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.ITF,
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        el,
        (result) => {
          if (result && !stopped) handler.current(result.getText());
        },
      );
      if (stopped) controls.stop();
      stop = () => controls.stop();
    };

    start()
      .catch((err: unknown) => {
        if (!stopped) setError(explain(err));
      })
      .finally(() => {
        if (!stopped) setStarting(false);
      });
    return () => {
      stopped = true;
      stop();
    };
  }, []);

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <CameraOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} />
        <p>{error} You can still type the ticket code below.</p>
      </div>
    );
  }
  return (
    <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl bg-slate-950">
      <video
        ref={video}
        muted
        playsInline
        aria-label="Camera view for scanning tickets"
        className="size-full object-cover"
      />
      {/* The frame to hold the code in. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[14%] rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgb(2_6_23/0.35)]"
      />
      <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white drop-shadow">
        {starting ? 'Starting the camera…' : 'Hold the QR code or barcode inside the frame'}
      </p>
    </div>
  );
}
