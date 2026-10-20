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
    expect(safeNext('//evil.example')).toBe('/app');
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext('/\\evil.example')).toBe('/app');
    expect(safeNext(null)).toBe('/app');
    expect(safeNext('javascript:alert(1)', '/home')).toBe('/home');
  });
});
