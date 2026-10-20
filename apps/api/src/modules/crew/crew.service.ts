import { withDb, type Db, type Tx } from '../../platform/db.js';
import { recordTripEvent } from '../catalog/trip-events.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { Page } from '../catalog/catalog.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

type EmployeeRole = 'DRIVER' | 'CONDUCTOR' | 'DISPATCHER' | 'MECHANIC' | 'OTHER';
type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
type CrewRole = 'DRIVER' | 'CONDUCTOR';

export interface EmployeeInput {
  employeeNumber: string;
  fullName: string;
  role: EmployeeRole;
  phone?: string | undefined;
  hiredOn?: string | undefined;
}
export interface EmployeePatch {
  fullName?: string | undefined;
  role?: EmployeeRole | undefined;
  status?: EmployeeStatus | undefined;
  phone?: string | undefined;
}

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const OVERLAP_MSG = 'This person is already assigned to an overlapping trip';

export class CrewService {
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

  // ---- Employees (HR-restricted) -----------------------------------------------------------

  async listEmployees(
    s: TenantScope,
    page: Page,
    filter: {
      role?: EmployeeRole | undefined;
      status?: EmployeeStatus | undefined;
      q?: string | undefined;
    } = {},
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.employee.findMany({
        where: {
          tenantId: s.tenantId,
          ...(filter.role ? { role: filter.role } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.q ? { fullName: { contains: filter.q, mode: 'insensitive' as const } } : {}),
        },
        include: { licences: { select: { expiresOn: true } } },
        orderBy: { fullName: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber,
      fullName: e.fullName,
      role: e.role,
      status: e.status,
      phone: e.phone,
      hiredOn: e.hiredOn ? isoDate(e.hiredOn) : null,
      licenceExpiresOn: e.licences.length
        ? isoDate(e.licences.map((l) => l.expiresOn).sort((a, b) => b.getTime() - a.getTime())[0]!)
        : null,
    }));
  }

  /**
   * Minimal roster for dispatchers choosing crew: no phone, HR dates or other personal data,
   * only active drivers/conductors and whether a licence exists.
   */
  async roster(s: TenantScope) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.employee.findMany({
        where: { tenantId: s.tenantId, status: 'ACTIVE', role: { in: ['DRIVER', 'CONDUCTOR'] } },
        include: { licences: { select: { expiresOn: true } } },
        orderBy: { fullName: 'asc' },
        take: 500,
      }),
    );
    return rows.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      role: e.role,
      licenceExpiresOn: e.licences.length
        ? isoDate(e.licences.map((l) => l.expiresOn).sort((a, b) => b.getTime() - a.getTime())[0]!)
        : null,
    }));
  }

  async createEmployee(s: TenantScope, input: EmployeeInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const e = await tx.employee.create({
            data: {
              tenantId: s.tenantId,
              employeeNumber: input.employeeNumber.trim(),
              fullName: input.fullName.trim(),
              role: input.role,
              phone: input.phone ?? null,
              hiredOn: input.hiredOn ? dateOnly(input.hiredOn) : null,
            },
          });
          await this.audit(tx, s, 'hr.employee_created', 'employee', e.id, requestId, {
            role: e.role,
          });
          return {
            id: e.id,
            employeeNumber: e.employeeNumber,
            fullName: e.fullName,
            role: e.role,
            status: e.status,
          };
        }),
      {
        unique: 'An employee with this number already exists',
        check: 'Name or employee number is out of range',
      },
    );
  }

  /** Terminating or suspending someone with upcoming crew duty is refused until they are replaced. */
  async updateEmployee(s: TenantScope, id: string, patch: EmployeePatch, requestId?: string) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const e = await tx.employee.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!e) throw AppError.notFound();
          if (
            e.status === 'TERMINATED' &&
            patch.status !== undefined &&
            patch.status !== 'TERMINATED'
          ) {
            throw AppError.conflict(
              'A terminated employee cannot be reinstated; create a new record',
            );
          }
          if (patch.status && patch.status !== 'ACTIVE' && e.status === 'ACTIVE') {
            const upcoming = await tx.tripCrew.count({
              where: {
                tenantId: s.tenantId,
                employeeId: id,
                releasedAt: null,
                endsAt: { gt: new Date() },
              },
            });
            if (upcoming > 0)
              throw AppError.conflict(
                `This person is assigned to ${upcoming} upcoming trip(s). Replace them first.`,
              );
          }
          const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
          if (Object.keys(data).length === 0) throw AppError.validation('Nothing to update');
          await tx.employee.update({ where: { id }, data });
          await this.audit(tx, s, 'hr.employee_updated', 'employee', id, requestId, {
            fields: Object.keys(data).join(','),
          });
        }),
      { check: 'Name is out of range' },
    );
  }

  async addLicence(
    s: TenantScope,
    employeeId: string,
    input: { licenceNumber: string; category: string; expiresOn: string },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const e = await tx.employee.findFirst({
            where: { id: employeeId, tenantId: s.tenantId },
          });
          if (!e) throw AppError.notFound();
          if (e.role !== 'DRIVER') throw AppError.conflict('Only drivers hold driving licences');
          const l = await tx.driverLicence.create({
            data: {
              tenantId: s.tenantId,
              employeeId,
              licenceNumber: input.licenceNumber.trim().toUpperCase(),
              category: input.category.trim(),
              expiresOn: dateOnly(input.expiresOn),
            },
          });
          await this.audit(tx, s, 'hr.licence_added', 'employee', employeeId, requestId);
          return { id: l.id };
        }),
      { unique: 'This licence number is already recorded' },
    );
  }

  async listLicences(s: TenantScope, employeeId: string) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.driverLicence.findMany({
        where: { tenantId: s.tenantId, employeeId },
        orderBy: { expiresOn: 'desc' },
      }),
    );
    return rows.map((l) => ({
      id: l.id,
      licenceNumber: l.licenceNumber,
      category: l.category,
      expiresOn: isoDate(l.expiresOn),
    }));
  }

  // ---- Trip crew ---------------------------------------------------------------------------

  async listTripCrew(s: TenantScope, tripId: string) {
    const rows = await withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({
        where: { id: tripId, tenantId: s.tenantId },
        select: { id: true },
      });
      if (!trip) throw AppError.notFound();
      return tx.tripCrew.findMany({
        where: { tenantId: s.tenantId, tripId, releasedAt: null },
        include: { employee: { select: { fullName: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });
    return rows.map((c) => ({
      employeeId: c.employeeId,
      fullName: c.employee.fullName,
      role: c.role,
    }));
  }

  /**
   * Assigns crew to a trip. Rules: trip still open; employee active and of a matching job role;
   * drivers hold a licence valid on the service date; no overlapping duty; and at least the
   * company's minimum rest between consecutive trips. The database exclusion constraint is the
   * final guard against two dispatchers racing to double-book the same person.
   */
  async assign(
    s: TenantScope,
    tripId: string,
    employeeId: string,
    role: CrewRole,
    requestId?: string,
  ) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
          if (!trip) throw AppError.notFound();
          if (trip.status !== 'SCHEDULED' && trip.status !== 'BOARDING')
            throw AppError.conflict('Crew can only be changed on an open trip');
          const emp = await tx.employee.findFirst({
            where: { id: employeeId, tenantId: s.tenantId },
            include: { licences: true },
          });
          if (!emp) throw AppError.validation('Employee not found');
          if (emp.status !== 'ACTIVE') throw AppError.conflict('This employee is not active');
          if (emp.role !== role)
            throw AppError.conflict(
              `This employee’s job role (${emp.role.toLowerCase()}) cannot fill the ${role.toLowerCase()} position`,
            );
          if (role === 'DRIVER' && !emp.licences.some((l) => l.expiresOn >= trip.serviceDate)) {
            throw AppError.conflict(
              `This driver has no licence valid on ${isoDate(trip.serviceDate)}`,
            );
          }
          const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
          const restMs = tenant.crewMinRestMinutes * 60_000;
          const near = await tx.tripCrew.findMany({
            where: {
              tenantId: s.tenantId,
              employeeId,
              releasedAt: null,
              tripId: { not: tripId },
              startsAt: { lt: new Date(trip.arrivalAt.getTime() + restMs) },
              endsAt: { gt: new Date(trip.departureAt.getTime() - restMs) },
            },
          });
          for (const n of near) {
            if (n.startsAt < trip.arrivalAt && n.endsAt > trip.departureAt)
              throw AppError.conflict(OVERLAP_MSG);
          }
          if (near.length > 0)
            throw AppError.conflict(
              `This person needs at least ${tenant.crewMinRestMinutes} minutes of rest between trips`,
            );

          const existing = await tx.tripCrew.findFirst({
            where: { tripId, employeeId, releasedAt: null },
          });
          if (existing) throw AppError.conflict('This person is already assigned to this trip');
          await tx.tripCrew.createMany({
            data: [
              {
                tenantId: s.tenantId,
                tripId,
                employeeId,
                role,
                startsAt: trip.departureAt,
                endsAt: trip.arrivalAt,
              },
            ],
          });
          await recordTripEvent(tx, s, tripId, 'CREW_ASSIGNED', { employeeId, role });
          await this.audit(tx, s, 'trips.crew_assigned', 'trip', tripId, requestId, { role });
        }),
      { exclusion: OVERLAP_MSG, unique: 'This person is already assigned to this trip' },
    );
  }

  async release(s: TenantScope, tripId: string, employeeId: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
      if (!trip) throw AppError.notFound();
      if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED')
        throw AppError.conflict('This trip can no longer be changed');
      const res = await tx.tripCrew.updateMany({
        where: { tenantId: s.tenantId, tripId, employeeId, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (res.count !== 1) throw AppError.notFound();
      await recordTripEvent(tx, s, tripId, 'CREW_RELEASED', { employeeId });
      await this.audit(tx, s, 'trips.crew_released', 'trip', tripId, requestId);
    });
  }
}
