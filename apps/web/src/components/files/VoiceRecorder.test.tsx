import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from './VoiceRecorder';

/** A stand-in for the browser's recorder: produces one chunk of "audio" when stopped. */
class FakeRecorder {
  static supported = ['audio/webm;codecs=opus', 'audio/webm'];
  static isTypeSupported = (t: string) => FakeRecorder.supported.includes(t);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(FakeRecorder.bytes)], { type: this.mimeType }),
    });
    this.onstop?.();
  }
  static bytes = 2000;
}

const track = { stop: vi.fn() };

function setBrowser(getUserMedia: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:voice-1', revokeObjectURL: vi.fn() }),
  );
}

beforeEach(() => {
  FakeRecorder.bytes = 2000;
  track.stop.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VoiceRecorder', () => {
  it('records, lets the person listen, and hands up a WebM voice file', async () => {
    setBrowser(async () => ({ getTracks: () => [track] }));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VoiceRecorder onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Record a voice message' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Recording 0:00 of 2:00');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.getByLabelText('Your voice message')).toBeTruthy());
    const file = onChange.mock.calls.at(-1)![0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('voice-message.webm');
    expect(file.type).toBe('audio/webm'); // no codec suffix: that is what the server expects
    expect(file.size).toBe(2000);
    expect(track.stop).toHaveBeenCalled(); // the microphone is released
  });

  it('can be removed, which tells the page there is no recording any more', async () => {
    setBrowser(async () => ({ getTracks: () => [track] }));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VoiceRecorder onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('stops by itself at the time limit', async () => {
    vi.useFakeTimers();
    setBrowser(async () => ({ getTracks: () => [track] }));
    const onChange = vi.fn();
    render(<VoiceRecorder onChange={onChange} maxSeconds={3} />);
    await act(async () => {
      screen.getByRole('button', { name: 'Record a voice message' }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(onChange).toHaveBeenCalled();
    expect((onChange.mock.calls.at(-1)![0] as File).name).toBe('voice-message.webm');
  });

  it('explains a blocked or missing microphone in plain words', async () => {
    const user = userEvent.setup();
    setBrowser(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    const { unmount } = render(<VoiceRecorder onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Record a voice message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/microphone is blocked/i);
    unmount();

    setBrowser(async () => {
      throw new DOMException('none', 'NotFoundError');
    });
    render(<VoiceRecorder onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Record a voice message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No microphone/);
  });

  it('does not hand up an empty recording', async () => {
    setBrowser(async () => ({ getTracks: () => [track] }));
    FakeRecorder.bytes = 0;
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VoiceRecorder onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was recorded/);
    expect(onChange).not.toHaveBeenCalledWith(expect.any(File));
  });

  it('tells people to type when the browser cannot record', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<VoiceRecorder onChange={vi.fn()} />);
    expect(screen.getByText(/not available in this browser/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
