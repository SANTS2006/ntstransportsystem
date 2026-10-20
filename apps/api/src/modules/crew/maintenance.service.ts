import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import { addDays } from '../catalog/time.js';
import type { Page } from '../catalog/catalog.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

type MaintenanceKind = 'SERVICE' | 'REPAIR' | 'INSPECTION';
type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type DocKind = 'INSURANCE' | 'INSPECTION_CERTIFICATE' | 'ROAD_LICENCE' | 'OTHER';

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (fromIso: string, to: Date) =>
  Math.round((to.getTime() - dateOnly(fromIso).getTime()) / 86_400_000);

/** Today's calendar date in the company's timezone (YYYY-MM-DD). */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export class MaintenanceService {
  constructor(private readonly db: Db) {}

  private audit(
    tx: Tx,
    s: TenantScope,
    action: string,
    targetType: string,
    targetId: string,
    requestId?: string,
    summary?: Record<string, string | number | boolean | null>,
  ) {
    return writeAudit(tx, {
      action,
      outcome: 'SUCCESS',
      tenantId: s.tenantId,
      actorUserId: s.userId,
      targetType,
      targetId,
      requestId,
      ...(summary ? { summary } : {}),
    });
  }

  // ---- Maintenance records -----------------------------------------------------------------

  async list(
    s: TenantScope,
    page: Page,
    filter: { vehicleId?: string | undefined; status?: MaintenanceStatus | undefined } = {},
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.maintenanceRecord.findMany({
        where: {
          tenantId: s.tenantId,
          ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
        include: { vehicle: { select: { registration: true } } },
        orderBy: [{ scheduledFor: 'desc' }],
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      vehicle: r.vehicle.registration,
      kind: r.kind,
      status: r.status,
      scheduledFor: isoDate(r.scheduledFor),
      completedOn: r.completedOn ? isoDate(r.completedOn) : null,
      description: r.description,
      vendor: r.vendor,
      odometerKm: r.odometerKm,
      costMinor: r.costMinor,
    }));
  }

  async create(
    s: TenantScope,
    input: {
      vehicleId: string;
      kind: MaintenanceKind;
      scheduledFor: string;
      description: string;
      vendor?: string | undefined;
    },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const v = await tx.vehicle.findFirst({
            where: { id: input.vehicleId, tenantId: s.tenantId },
          });
          if (!v) throw AppError.validation('Vehicle not found');
          if (v.status === 'RETIRED')
            throw AppError.conflict('A retired vehicle cannot be scheduled for maintenance');
          const r = await tx.maintenanceRecord.create({
            data: {
              tenantId: s.tenantId,
              vehicleId: input.vehicleId,
              kind: input.kind,
              scheduledFor: dateOnly(input.scheduledFor),
              description: input.description.trim(),
              vendor: input.vendor ?? null,
            },
          });
          await this.audit(tx, s, 'fleet.maintenance_scheduled', 'maintenance', r.id, requestId, {
            kind: input.kind,
          });
          return { id: r.id };
        }),
      { check: 'Description is out of range' },
    );
  }

  /** Starting work takes the vehicle out of service, which is refused while it has upcoming trips. */
  async start(s: TenantScope, id: string, requestId?: string) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const r = await tx.maintenanceRecord.findFirst({
            where: { id, tenantId: s.tenantId },
            include: { vehicle: true },
          });
          if (!r) throw AppError.notFound();
          if (r.status !== 'SCHEDULED')
            throw AppError.conflict('Only a scheduled job can be started');
          if (r.vehicle.status === 'RETIRED') throw AppError.conflict('This vehicle is retired');
          if (r.vehicle.status === 'ACTIVE') {
            const upcoming = await tx.trip.count({
              where: {
                tenantId: s.tenantId,
                vehicleId: r.vehicleId,
                status: { in: ['SCHEDULED', 'BOARDING'] },
                departureAt: { gt: new Date() },
              },
            });
            if (upcoming > 0)
              throw AppError.conflict(
                `This vehicle is assigned to ${upcoming} upcoming trip(s). Reassign them first.`,
              );
          }
          const claimed = await tx.maintenanceRecord.updateMany({
            where: { id, status: 'SCHEDULED' },
            data: { status: 'IN_PROGRESS' },
          });
          if (claimed.count !== 1) throw AppError.conflict('The job changed; please refresh');
          await tx.vehicle.update({ where: { id: r.vehicleId }, data: { status: 'MAINTENANCE' } });
          await this.audit(tx, s, 'fleet.maintenance_started', 'maintenance', id, requestId);
        }),
      { unique: 'This vehicle already has a job in progress' },
    );
  }

  async complete(
    s: TenantScope,
    id: string,
    input: { odometerKm?: number | undefined; costMinor?: number | undefined },
    requestId?: string,
  ) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const r = await tx.maintenanceRecord.findFirst({
            where: { id, tenantId: s.tenantId },
            include: { vehicle: true },
          });
          if (!r) throw AppError.notFound();
          if (r.status !== 'IN_PROGRESS')
            throw AppError.conflict('Only a job in progress can be completed');
          if (input.odometerKm !== undefined && input.odometerKm < r.vehicle.odometerKm)
            throw AppError.conflict('The odometer reading cannot go backwards');
          const { timezone: tz } = await tx.tenant.findUniqueOrThrow({
            where: { id: s.tenantId },
            select: { timezone: true },
          });
          const claimed = await tx.maintenanceRecord.updateMany({
            where: { id, status: 'IN_PROGRESS' },
            data: {
              status: 'COMPLETED',
              completedOn: dateOnly(todayIn(tz)),
              odometerKm: input.odometerKm ?? null,
              costMinor: input.costMinor ?? null,
            },
          });
          if (claimed.count !== 1) throw AppError.conflict('The job changed; please refresh');
          await tx.vehicle.update({
            where: { id: r.vehicleId },
            data: {
              ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
              ...(r.vehicle.status === 'MAINTENANCE' ? { status: 'ACTIVE' as const } : {}),
            },
          });
          await this.audit(tx, s, 'fleet.maintenance_completed', 'maintenance', id, requestId, {
            cost: input.costMinor ?? null,
          });
        }),
      { check: 'Cost or odometer is out of range' },
    );
  }

  async cancel(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const res = await tx.maintenanceRecord.updateMany({
        where: { id, tenantId: s.tenantId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      });
      if (res.count !== 1) {
        const exists = await tx.maintenanceRecord.findFirst({
          where: { id, tenantId: s.tenantId },
        });
        throw exists
          ? AppError.conflict('Only a scheduled job can be cancelled')
          : AppError.notFound();
      }
      await this.audit(tx, s, 'fleet.maintenance_cancelled', 'maintenance', id, requestId);
    });
  }

  // ---- Vehicle documents -------------------------------------------------------------------

  async listDocuments(s: TenantScope, vehicleId: string) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.vehicleDocument.findMany({
        where: { tenantId: s.tenantId, vehicleId },
        orderBy: { expiresOn: 'asc' },
      }),
    );
    return rows.map((d) => ({
      id: d.id,
      kind: d.kind,
      referenceNo: d.referenceNo,
      expiresOn: isoDate(d.expiresOn),
    }));
  }

  async addDocument(
    s: TenantScope,
    input: { vehicleId: string; kind: DocKind; referenceNo: string; expiresOn: string },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const v = await tx.vehicle.findFirst({
            where: { id: input.vehicleId, tenantId: s.tenantId },
          });
          if (!v) throw AppError.validation('Vehicle not found');
          const d = await tx.vehicleDocument.create({
            data: {
              tenantId: s.tenantId,
              vehicleId: input.vehicleId,
              kind: input.kind,
              referenceNo: input.referenceNo.trim(),
              expiresOn: dateOnly(input.expiresOn),
            },
          });
          await this.audit(tx, s, 'fleet.document_added', 'vehicle', input.vehicleId, requestId, {
            kind: input.kind,
          });
          return { id: d.id };
        }),
      { check: 'Reference number is out of range' },
    );
  }

  async removeDocument(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const res = await tx.vehicleDocument.deleteMany({ where: { id, tenantId: s.tenantId } });
      if (res.count !== 1) throw AppError.notFound();
      await this.audit(tx, s, 'fleet.document_removed', 'vehicle_document', id, requestId);
    });
  }

  // ---- Alerts ------------------------------------------------------------------------------

  /**
   * Things that need attention within `days`: expiring/expired vehicle documents, overdue or
   * upcoming maintenance, and (only when the caller may see HR data) driver licences. Dates are
   * evaluated in the company's timezone. Email/in-app reminders will be driven from this in the
   * notifications phase.
   */
  async alerts(s: TenantScope, days: number, includeLicences: boolean) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const { timezone: tz } = await tx.tenant.findUniqueOrThrow({
        where: { id: s.tenantId },
        select: { timezone: true },
      });
      const today = todayIn(tz);
      const horizon = dateOnly(addDays(today, days));
      const docs = await tx.vehicleDocument.findMany({
        where: { tenantId: s.tenantId, expiresOn: { lte: horizon } },
        include: { vehicle: { select: { registration: true, status: true } } },
        orderBy: { expiresOn: 'asc' },
        take: 200,
      });
      const maint = await tx.maintenanceRecord.findMany({
        where: { tenantId: s.tenantId, status: 'SCHEDULED', scheduledFor: { lte: horizon } },
        include: { vehicle: { select: { registration: true } } },
        orderBy: { scheduledFor: 'asc' },
        take: 200,
      });
      const licences = includeLicences
        ? await tx.driverLicence.findMany({
            where: {
              tenantId: s.tenantId,
              expiresOn: { lte: horizon },
              employee: { status: 'ACTIVE' },
            },
            include: { employee: { select: { fullName: true } } },
            orderBy: { expiresOn: 'asc' },
            take: 200,
          })
        : [];
      return {
        asOf: today,
        withinDays: days,
        documents: docs
          .filter((d) => d.vehicle.status !== 'RETIRED')
          .map((d) => ({
            id: d.id,
            vehicle: d.vehicle.registration,
            kind: d.kind,
            referenceNo: d.referenceNo,
            expiresOn: isoDate(d.expiresOn),
            daysLeft: daysBetween(today, d.expiresOn),
            expired: isoDate(d.expiresOn) < today,
          })),
        maintenance: maint.map((m) => ({
          id: m.id,
          vehicle: m.vehicle.registration,
          kind: m.kind,
          scheduledFor: isoDate(m.scheduledFor),
          daysLeft: daysBetween(today, m.scheduledFor),
          overdue: isoDate(m.scheduledFor) < today,
        })),
        ...(includeLicences
          ? {
              licences: licences.map((l) => ({
                id: l.id,
                employee: l.employee.fullName,
                licenceNumber: l.licenceNumber,
                expiresOn: isoDate(l.expiresOn),
                daysLeft: daysBetween(today, l.expiresOn),
                expired: isoDate(l.expiresOn) < today,
              })),
            }
          : {}),
      };
    });
  }
}
