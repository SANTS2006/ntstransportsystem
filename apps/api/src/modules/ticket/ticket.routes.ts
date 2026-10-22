import type { Permission } from '@nts/shared';
import type { Request, Response, Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import { createDenialAuditor } from '../tenants/tenant.audit.js';
import {
  requireTenantPermission,
  tenantScope,
  uuidParam,
  type TenantScope,
} from '../tenants/tenant.guards.js';
import { renderReceiptPdf, renderTicketsPdf } from './pdf.js';
import type { TicketService } from './ticket.service.js';

const scanBody = z
  .object({
    token: z.string().trim().min(10).max(300).optional(),
    code: z.string().trim().min(6).max(20).optional(),
    tripId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => (v.token === undefined) !== (v.code === undefined), {
    message: 'Provide either a QR token or a ticket code',
  });

/** Sends a generated document. Private and uncached: it contains a passenger's tickets. */
export function sendPdf(res: Response, filename: string, body: Buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', String(body.length));
  res.end(body);
}
export const safeName = (ref: string) => ref.replace(/[^A-Za-z0-9_-]/g, '');

export async function ticketsPdfFor(tickets: TicketService, s: TenantScope, bookingId: string) {
  const d = await tickets.documentData(s, bookingId);
  return { name: `tickets-${safeName(d.reference)}.pdf`, body: await renderTicketsPdf(d) };
}
export async function receiptPdfFor(tickets: TicketService, s: TenantScope, bookingId: string) {
  const d = await tickets.documentData(s, bookingId);
  return { name: `receipt-${safeName(d.reference)}.pdf`, body: await renderReceiptPdf(d) };
}

export interface TicketRouterDeps {
  db: Db;
  tickets: TicketService;
}

/** Tickets, receipts and boarding for company staff, under /tenants/:tenantId. */
export function ticketRouter({ db, tickets }: TicketRouterDeps): ExpressRouter {
  const t = Router({ mergeParams: true });
  t.use(requireAuth, tenantScope(db));
  const audit = createDenialAuditor(db);
  const perm = (p: Permission) => requireTenantPermission(p, audit.permissionDenied);
  const scope = (req: Request): TenantScope => {
    if (!req.tenant) throw AppError.unauthenticated();
    return req.tenant;
  };

  t.get('/bookings/:id/tickets', perm('booking.read'), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ tickets: await tickets.listForBooking(scope(req), uuidParam(req, 'id')) });
  });
  t.get('/bookings/:id/tickets.pdf', perm('booking.read'), async (req, res) => {
    const f = await ticketsPdfFor(tickets, scope(req), uuidParam(req, 'id'));
    sendPdf(res, f.name, f.body);
  });
  t.get('/bookings/:id/receipt.pdf', perm('booking.read'), async (req, res) => {
    const f = await receiptPdfFor(tickets, scope(req), uuidParam(req, 'id'));
    sendPdf(res, f.name, f.body);
  });

  t.post('/tickets/scan', perm('ticket.validate'), async (req, res) => {
    const r = await tickets.scan(scope(req), scanBody.parse(req.body), req.id);
    if (r.ok) {
      res.json(r);
      return;
    }
    // Refusals are an expected outcome of scanning, so they carry a machine-readable reason.
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: r.message,
        requestId: req.id,
        details: { reason: r.reason, ...(r.boardedAt ? { boardedAt: r.boardedAt } : {}) },
      },
    });
  });
  t.get('/trips/:id/manifest', perm('ticket.validate'), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await tickets.manifest(scope(req), uuidParam(req, 'id')));
  });

  const r = Router();
  r.use('/tenants/:tenantId', t);
  return r;
}

export const requestSchemas = { scanBody };
