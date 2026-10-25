const BASE = '/api/v1';
// Generous default for slow mobile links; override per environment with VITE_API_TIMEOUT_MS.
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** True when retrying the same request might succeed (network, timeout, 5xx, 429). */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Extra request headers, e.g. Idempotency-Key. */
  headers?: Record<string, string>;
  /** Upload a file as the raw request body instead of JSON. */
  file?: File;
}

/**
 * JSON API call. Session cookies are HttpOnly and sent automatically; for state-changing requests
 * the readable `csrf` cookie is echoed in a header (double-submit). Every call has a hard timeout
 * so a loading indicator can never spin forever.
 */
export async function api<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.file) {
    headers['content-type'] = opts.file.type;
    headers['x-file-name'] = encodeURIComponent(opts.file.name);
  } else if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      signal,
      ...(opts.file
        ? { body: opts.file }
        : opts.body !== undefined
          ? { body: JSON.stringify(opts.body) }
          : {}),
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err; // caller cancelled: not an error to display
    const timedOut = timeout.aborted;
    throw new ApiError(
      0,
      timedOut ? 'TIMEOUT' : 'NETWORK',
      timedOut
        ? 'The server took too long to respond. Please try again.'
        : 'Could not reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 204) return undefined as T;
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  if (!res.ok) {
    const e = (
      payload as
        | { error?: { code?: string; message?: string; requestId?: string; details?: unknown } }
        | undefined
    )?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'ERROR',
      e?.message ?? 'Something went wrong. Please try again.',
      e?.requestId,
      e?.details,
    );
  }
  return payload as T;
}

/** Only same-site relative paths may be used as post-login redirects (blocks open redirects). */
export function safeNext(raw: string | null | undefined, fallback = '/app/dashboard'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}
