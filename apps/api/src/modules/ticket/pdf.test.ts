import { describe, expect, it } from 'vitest';
import { renderTicketsPdf } from './pdf.js';

describe('ticket PDF', () => {
  const images = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
  const render = (status: string) =>
    renderTicketsPdf({
      company: 'Sierra Express Coaches',
      timezone: 'Africa/Freetown',
      reference: 'SE0001',
      contactName: 'Mariama Kanu',
      contactPhone: '+23276200201',
      route: 'Freetown - Bo',
      origin: { name: 'Freetown Central Terminal', city: 'Freetown' },
      destination: { name: 'Bo Terminal', city: 'Bo' },
      departureAt: new Date('2031-01-01T07:00:00Z'),
      arrivalAt: new Date('2031-01-01T12:00:00Z'),
      currency: 'SLE',
      totalMinor: 25_000,
      passengers: [{ seat: '3', name: 'Mariama Kanu', fareMinor: 25_000 }],
      payment: null,
      tickets: [
        {
          seat: '3',
          passengerName: 'Mariama Kanu',
          code: 'AB12CD34EF',
          token: 't1.x.y.z',
          status,
        },
      ] as never,
    });

  it('adds a barcode of the ticket code next to the QR code', async () => {
    const valid = await render('ISSUED');
    expect(valid.subarray(0, 5).toString()).toBe('%PDF-');
    // A cancelled ticket carries no barcode, so the valid one has more images.
    expect(images(valid)).toBeGreaterThan(images(await render('VOID')));
  });
});
