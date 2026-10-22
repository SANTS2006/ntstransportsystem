import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface DocTicket {
  seat: string;
  passengerName: string;
  code: string;
  token: string;
  status: string;
}
export interface DocData {
  company: string;
  timezone: string;
  reference: string;
  contactName: string;
  contactPhone: string;
  route: string;
  origin: { name: string; city: string };
  destination: { name: string; city: string };
  departureAt: Date;
  arrivalAt: Date;
  currency: string;
  totalMinor: number;
  passengers: { seat: string; name: string; fareMinor: number }[];
  payment: { id: string; paidAt: Date | null; amountMinor: number } | null;
  tickets: DocTicket[];
}

/** The built-in PDF fonts are Latin-1 only: anything else would print as garbage, so show "?". */
const safe = (s: string) => s.replace(/[^ -~¡-ÿ]/g, '?');
const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(
    d,
  );

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** One page per ticket: trip details, passenger, seat, and the signed QR code. */
export async function renderTicketsPdf(d: DocData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A5',
    margin: 36,
    info: { Title: `Tickets ${d.reference}`, Author: safe(d.company) },
  });
  const done = collect(doc);
  let first = true;
  for (const t of d.tickets) {
    if (!first) doc.addPage();
    first = false;
    const png = await QRCode.toBuffer(t.token, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 360,
    });

    doc.fillColor('#0f766e').fontSize(18).text(safe(d.company), { align: 'left' });
    doc
      .moveDown(0.2)
      .fillColor('#475569')
      .fontSize(9)
      .text('BUS TICKET', { characterSpacing: 1.5 });
    doc
      .moveDown(0.8)
      .fillColor('#0f172a')
      .fontSize(20)
      .text(`${safe(d.origin.city)} to ${safe(d.destination.city)}`);
    doc.moveDown(0.2).fontSize(10).fillColor('#334155').text(safe(d.route));
    doc
      .moveDown(0.6)
      .fontSize(11)
      .fillColor('#0f172a')
      .text(`Departs: ${when(d.departureAt, d.timezone)}`);
    doc.text(`Arrives: ${when(d.arrivalAt, d.timezone)}`);
    doc
      .moveDown(0.8)
      .fontSize(11)
      .text(`Passenger: ${safe(t.passengerName)}`);
    doc
      .fontSize(26)
      .fillColor('#0f766e')
      .text(`Seat ${safe(t.seat)}`);
    doc
      .moveDown(0.3)
      .fontSize(10)
      .fillColor('#334155')
      .text(`Booking ${d.reference} - Ticket ${t.code}`);
    if (t.status === 'VOID') {
      doc.moveDown(0.3).fontSize(14).fillColor('#b91c1c').text('CANCELLED - NOT VALID FOR TRAVEL');
    }
    const x = doc.page.width - 36 - 150;
    doc.image(png, x, doc.page.height - 36 - 150 - 30, { width: 150, height: 150 });
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(
        'Show this QR code when boarding. Valid for this trip and seat only. Each ticket can be used once.',
        36,
        doc.page.height - 36 - 24,
        { width: doc.page.width - 72 },
      );
  }
  doc.end();
  return done;
}

/** A one-page receipt for a paid booking. */
export async function renderReceiptPdf(d: DocData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: { Title: `Receipt ${d.reference}`, Author: safe(d.company) },
  });
  const done = collect(doc);
  doc.fillColor('#0f766e').fontSize(22).text(safe(d.company));
  doc
    .moveDown(0.2)
    .fillColor('#475569')
    .fontSize(10)
    .text('PAYMENT RECEIPT', { characterSpacing: 1.5 });
  doc.moveDown(1).fillColor('#0f172a').fontSize(11);
  doc.text(`Booking reference: ${d.reference}`);
  doc.text(`Paid: ${d.payment?.paidAt ? when(d.payment.paidAt, d.timezone) : 'n/a'}`);
  doc.text(`Customer: ${safe(d.contactName)}  (${safe(d.contactPhone)})`);
  doc.moveDown(0.6);
  doc.text(`Trip: ${safe(d.origin.city)} to ${safe(d.destination.city)} (${safe(d.route)})`);
  doc.text(`Departs: ${when(d.departureAt, d.timezone)}`);
  doc.moveDown(1);

  const left = 50;
  const right = doc.page.width - 50;
  doc.fontSize(10).fillColor('#475569').text('Seat / passenger', left, doc.y, { continued: false });
  doc
    .moveTo(left, doc.y + 2)
    .lineTo(right, doc.y + 2)
    .strokeColor('#cbd5e1')
    .stroke();
  doc.moveDown(0.6).fillColor('#0f172a').fontSize(11);
  for (const p of d.passengers) {
    const y = doc.y;
    doc.text(`${safe(p.seat)} - ${safe(p.name)}`, left, y, { width: right - left - 120 });
    doc.text(money(p.fareMinor, d.currency), right - 120, y, { width: 120, align: 'right' });
    doc.moveDown(0.4);
  }
  doc
    .moveTo(left, doc.y + 2)
    .lineTo(right, doc.y + 2)
    .strokeColor('#cbd5e1')
    .stroke();
  doc.moveDown(0.8).fontSize(13);
  const y = doc.y;
  doc.text('Total', left, y);
  doc.text(money(d.totalMinor, d.currency), right - 160, y, { width: 160, align: 'right' });
  doc.moveDown(2).fontSize(9).fillColor('#64748b');
  doc.text(
    d.payment
      ? `Paid online through Monime. Payment reference ${d.payment.id.slice(0, 8)}. This receipt is generated automatically.`
      : 'This receipt is generated automatically.',
    left,
    doc.y,
    { width: right - left },
  );
  doc.end();
  return done;
}
