import { describe, expect, it } from 'vitest';
import { inboxLink, inboxText } from './inbox-text.js';

describe('inboxText', () => {
  it('describes a confirmed booking with the trip and seats', () => {
    const t = inboxText('booking-confirmed', {
      reference: 'ABC123',
      route: 'Freetown to Bo',
      departure: 'Friday 24 October 2026 at 08:00',
      seats: '3, 4',
    });
    expect(t?.title).toBe('Booking confirmed');
    expect(t?.body).toContain('Freetown to Bo');
    expect(t?.body).toContain('Seats 3, 4');
    expect(t?.body).toContain('ABC123');
  });

  it('mentions the delay only when there is one', () => {
    expect(inboxText('trip-delayed', { route: 'A to B', delayMinutes: '45' })?.body).toContain(
      'Delayed about 45 min',
    );
    expect(inboxText('trip-delayed', { route: 'A to B', delayMinutes: '0' })?.body).not.toContain(
      'Delayed',
    );
  });

  it('has no in-app form for account e-mails', () => {
    for (const t of ['verify-email', 'password-reset', 'password-changed'] as const) {
      expect(inboxText(t, { link: 'https://app.test/x' })).toBeNull();
    }
  });

  it('never exceeds the stored length limits', () => {
    const t = inboxText('application-received', { job: 'x'.repeat(2000) });
    expect(t?.body.length).toBeLessThanOrEqual(500);
    expect(
      inboxText('complaint-reply', { reference: 'y'.repeat(2000) })?.body.length,
    ).toBeLessThanOrEqual(500);
  });
});

describe('inboxLink', () => {
  it('keeps only the path and query of a mail link', () => {
    expect(inboxLink('https://app.test/app/bookings/abc?x=1')).toBe('/app/bookings/abc?x=1');
  });
  it('drops anything that is not a usable link', () => {
    expect(inboxLink(undefined)).toBeNull();
    expect(inboxLink('not a url')).toBeNull();
    expect(inboxLink('https://app.test/')).toBeNull();
    expect(inboxLink('https://app.test//evil.example')).toBeNull();
  });
});
