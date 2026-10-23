import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { NewComplaintPage } from './ComplaintPages';

class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(1500)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  body: unknown;
  isFile: boolean;
}

function setup(opts: { uploads: boolean; attachFails?: boolean }) {
  document.cookie = 'csrf=abc; path=/';
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) },
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:v', revokeObjectURL: () => undefined }),
  );
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const isFile = init?.body instanceof File;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: !isFile && typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      isFile,
    });
    if (url.endsWith('/features')) return json(200, { fileUploads: opts.uploads });
    if (url.endsWith('/passenger/complaints') && init?.method === 'POST') {
      return json(201, { id: 'c1' });
    }
    if (url.endsWith('/attachments') && init?.method === 'POST') {
      return opts.attachFails
        ? json(503, {
            error: { code: 'SERVICE_UNAVAILABLE', message: 'File storage is unavailable' },
          })
        : json(201, { id: 'f1' });
    }
    return json(200, { complaints: [], files: [] });
  });
  const router = createMemoryRouter(
    [
      { path: '/app/complaints/new', element: <NewComplaintPage /> },
      { path: '/app/complaints/:id', element: <p>THREAD OPEN</p> },
    ],
    { initialEntries: ['/app/complaints/new?booking=b1'] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Report a problem with a voice message', () => {
  it('sends the complaint without typed text, then uploads the recording', async () => {
    const user = userEvent.setup();
    const { calls } = setup({ uploads: true });
    await user.type(screen.getByLabelText('Short summary'), 'Driver was rude');
    const send = screen.getByRole('button', { name: 'Send complaint' });
    expect(send).toBeDisabled(); // nothing typed and nothing recorded yet
    await user.click(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await waitFor(() => expect(screen.getByText('THREAD OPEN')).toBeTruthy());

    const create = calls.find(
      (c) => c.url.endsWith('/passenger/complaints') && c.method === 'POST',
    )!;
    expect(create.body).toEqual({
      bookingId: 'b1',
      category: 'DELAY',
      subject: 'Driver was rude',
      voice: true, // no `body`: the voice message stands in for it
    });
    const upload = calls.find((c) => c.url.endsWith('/passenger/complaints/c1/attachments'))!;
    expect(upload.isFile).toBe(true);
    expect(calls.indexOf(upload)).toBeGreaterThan(calls.indexOf(create)); // after, never before
  });

  it('still needs typed text when there is no recording', async () => {
    const user = userEvent.setup();
    setup({ uploads: true });
    await user.type(screen.getByLabelText('Short summary'), 'Late bus');
    const send = screen.getByRole('button', { name: 'Send complaint' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(/What happened/), 'It left an hour late.');
    expect(send).toBeEnabled();
  });

  it('keeps the complaint and says so when the recording could not be uploaded', async () => {
    const user = userEvent.setup();
    setup({ uploads: true, attachFails: true });
    await user.type(screen.getByLabelText('Short summary'), 'Driver was rude');
    await user.click(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Send complaint' }));
    await waitFor(() => expect(screen.getByText('THREAD OPEN')).toBeTruthy()); // not lost
    expect(await screen.findByText(/voice message could not be uploaded/)).toBeTruthy();
  });

  it('offers no recording when the server has no file storage', async () => {
    setup({ uploads: false });
    await screen.findByLabelText('Short summary');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull(),
    );
    expect(screen.getByLabelText('What happened?')).toBeTruthy();
  });
});
