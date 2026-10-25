import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, safeNext } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  beforeEach(() => {
    document.cookie = 'csrf=tok123; path=/';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('sends one request for a write repeated while it is still on its way', async () => {
    let release!: () => void;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(json(201, { id: 'a' }));
        }),
    );
    const first = api('/things', { method: 'POST', body: { name: 'x' } });
    const second = api('/things', { method: 'POST', body: { name: 'x' } });
    release();
    expect(await first).toEqual({ id: 'a' });
    expect(await second).toEqual({ id: 'a' });
    expect(spy).toHaveBeenCalledTimes(1);
    const headers = spy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends a dropped write again with the same key, but never a sign-in', async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(json(201, { ok: true }));
    const p = api('/things', { method: 'POST', body: { n: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ ok: true });
    const keys = spy.mock.calls.map(
      (c) => (c[1]?.headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(keys[0]).toBe(keys[1]);

    spy.mockReset().mockRejectedValue(new TypeError('network'));
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 0,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('sends the CSRF header on unsafe methods only', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {}));
    await api('/x');
    await api('/x', { method: 'POST', body: { a: 1 } });
    const get = spy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const post = spy.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(get['x-csrf-token']).toBeUndefined();
    expect(post['x-csrf-token']).toBe('tok123');
    expect(post['content-type']).toBe('application/json');
  });

  it('turns the API error envelope into an ApiError with the request id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(403, { error: { code: 'FORBIDDEN', message: 'No.', requestId: 'req-1' } }),
    );
    const err = await api('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No.',
      requestId: 'req-1',
    });
    expect((err as ApiError).retryable).toBe(false);
  });

  it('reports network failure as retryable with a human message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'));
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('NETWORK');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/connection/i);
  });

  it('returns undefined for 204 and survives a non-JSON error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.retryable).toBe(true);
  });
});

describe('safeNext', () => {
  it('allows only same-site relative paths', () => {
    expect(safeNext('/app/security')).toBe('/app/security');
    expect(safeNext('//evil.example')).toBe('/app/dashboard');
    expect(safeNext('https://evil.example')).toBe('/app/dashboard');
    expect(safeNext('/\\evil.example')).toBe('/app/dashboard');
    expect(safeNext(null)).toBe('/app/dashboard');
    expect(safeNext('javascript:alert(1)', '/home')).toBe('/home');
  });
});
