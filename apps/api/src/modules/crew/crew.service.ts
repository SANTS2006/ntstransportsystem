import { withDb, type Db, type Tx } from '../../platform/db.js';
import { recordTripEvent } from '../catalog/trip-events.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { Page } from '../catalog/catalog.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import type { MembershipService } from '../tenants/membership.service.js';

const JOB_LABEL: Record<StaffJob, string> = {
  DRIVER: 'Driver',
  CONDUCTOR: 'Conductor',
  DISPATCHER: 'Dispatcher',
  MECHANIC: 'Mechanic',
  OTHER: 'Staff',
};
const JOB_OF_ROLE: Record<string, StaffJob> = { driver: 'DRIVER', dispatcher: 'DISPATCHER' };
/** The company role a job gets when none is chosen. Other jobs need the role to be chosen. */
const ROLE_KEY: Partial<Record<StaffJob, string>> = {
  DRIVER: 'driver',
  CONDUCTOR: 'driver',
  DISPATCHER: 'dispatcher',
};

type StaffJob = 'DRIVER' | 'CONDUCTOR' | 'DISPATCHER' | 'MECHANIC' | 'OTHER';
type StaffStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
type CrewRole = 'DRIVER' | 'CONDUCTOR';

export interface StaffInput {
  staffNumber: string;
  fullName: string;
  role?: StaffJob | undefined;
  roleKey?: string | undefined;
  phone?: string | undefined;
  /** When given, the person gets a sign-in and a welcome e-mail. */
  email?: string | undefined;
  hiredOn?: string | undefined;
}
export interface StaffPatch {
  fullName?: string | undefined;
  role?: StaffJob | undefined;
  status?: StaffStatus | undefined;
  phone?: string | undefined;
}

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const OVERLAP_MSG = 'This person is already assigned to an overlapping trip';

export class CrewService {
  constructor(
    private readonly db: Db,
    private readonly staff?: Pick<MembershipService, 'provisionStaff'>,
  ) {}

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

  // ---- Staff (HR-restricted) -----------------------------------------------------------

  async listStaff(
    s: TenantScope,
    page: Page,
    filter: {
      role?: StaffJob | undefined;
      status?: StaffStatus | undefined;
      q?: string | undefined;
    } = {},
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.staffProfile.findMany({
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
      staffNumber: e.staffNumber,
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
      tx.staffProfile.findMany({
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

  async createStaff(s: TenantScope, input: StaffInput, requestId?: string) {
    const job: StaffJob =
      input.role ?? (input.roleKey ? (JOB_OF_ROLE[input.roleKey] ?? 'OTHER') : 'OTHER');
    const roleKey = input.roleKey ?? ROLE_KEY[job];
    if (input.email && !roleKey) {
      throw AppError.validation('Choose the role this person signs in with');
    }
    const created = await this.insertStaff(s, { ...input, role: job }, requestId);
    if (!input.email || !this.staff) return created;
    try {
      const { userId } = await this.staff.provisionStaff(
        s,
        {
          email: input.email,
          name: input.fullName.trim(),
          phone: input.phone,
          staffNumber: input.staffNumber.trim(),
          job: JOB_LABEL[job],
          roleKey: roleKey!,
        },
        requestId,
      );
      await withDb(this.db, ctxOf(s), (tx) =>
        tx.staffProfile.update({ where: { id: created.id }, data: { userId } }),
      );
    } catch (err) {
      // No half-added person: the record goes if the account could not be made.
      await withDb(this.db, ctxOf(s), (tx) =>
        tx.staffProfile.delete({ where: { id: created.id } }),
      );
      throw err;
    }
    return created;
  }

  private insertStaff(s: TenantScope, input: StaffInput & { role: StaffJob }, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const e = await tx.staffProfile.create({
            data: {
              tenantId: s.tenantId,
              staffNumber: input.staffNumber.trim(),
              fullName: input.fullName.trim(),
              role: input.role,
              phone: input.phone ?? null,
              hiredOn: input.hiredOn ? dateOnly(input.hiredOn) : null,
            },
          });
          await this.audit(tx, s, 'hr.staff_created', 'staff', e.id, requestId, {
            role: e.role,
          });
          return {
            id: e.id,
            staffNumber: e.staffNumber,
            fullName: e.fullName,
            role: e.role,
            status: e.status,
          };
        }),
      {
        unique: 'An staff with this number already exists',
        check: 'Name or staff number is out of range',
      },
    );
  }

  /** Terminating or suspending someone with upcoming crew duty is refused until they are replaced. */
  async updateStaff(s: TenantScope, id: string, patch: StaffPatch, requestId?: string) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const e = await tx.staffProfile.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!e) throw AppError.notFound();
          if (
            e.status === 'TERMINATED' &&
            patch.status !== undefined &&
            patch.status !== 'TERMINATED'
          ) {
            throw AppError.conflict('A terminated staff cannot be reinstated; create a new record');
          }
          if (patch.status && patch.status !== 'ACTIVE' && e.status === 'ACTIVE') {
            const upcoming = await tx.tripCrew.count({
              where: {
                tenantId: s.tenantId,
                staffId: id,
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
          await tx.staffProfile.update({ where: { id }, data });
          // A person who has left the company can no longer sign in to it (owners are handled by
          // the owner rules in the staff list, never silently here).
          if (patch.status === 'TERMINATED' && e.userId && e.userId !== s.userId) {
            await tx.membership.updateMany({
              where: {
                tenantId: s.tenantId,
                userId: e.userId,
                status: 'ACTIVE',
                roles: { none: { role: { key: 'owner' } } },
              },
              data: { status: 'REVOKED' },
            });
          }
          await this.audit(tx, s, 'hr.staff_updated', 'staff', id, requestId, {
            fields: Object.keys(data).join(','),
          });
        }),
      { check: 'Name is out of range' },
    );
  }

  async addLicence(
    s: TenantScope,
    staffId: string,
    input: { licenceNumber: string; category: string; expiresOn: string },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const e = await tx.staffProfile.findFirst({
            where: { id: staffId, tenantId: s.tenantId },
          });
          if (!e) throw AppError.notFound();
          if (e.role !== 'DRIVER') throw AppError.conflict('Only drivers hold driving licences');
          const l = await tx.driverLicence.create({
            data: {
              tenantId: s.tenantId,
              staffId,
              licenceNumber: input.licenceNumber.trim().toUpperCase(),
              category: input.category.trim(),
              expiresOn: dateOnly(input.expiresOn),
            },
          });
          await this.audit(tx, s, 'hr.licence_added', 'staff', staffId, requestId);
          return { id: l.id };
        }),
      { unique: 'This licence number is already recorded' },
    );
  }

  async listLicences(s: TenantScope, staffId: string) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.driverLicence.findMany({
        where: { tenantId: s.tenantId, staffId },
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
        include: { staff: { select: { fullName: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });
    return rows.map((c) => ({
      staffId: c.staffId,
      fullName: c.staff.fullName,
      role: c.role,
    }));
  }

  /**
   * Assigns crew to a trip. Rules: trip still open; staff active and of a matching job role;
   * drivers hold a licence valid on the service date; no overlapping duty; and at least the
   * company's minimum rest between consecutive trips. The database exclusion constraint is the
   * final guard against two dispatchers racing to double-book the same person.
   */
  async assign(
    s: TenantScope,
    tripId: string,
    staffId: string,
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
          const emp = await tx.staffProfile.findFirst({
            where: { id: staffId, tenantId: s.tenantId },
            include: { licences: true },
          });
          if (!emp) throw AppError.validation('Staff not found');
          if (emp.status !== 'ACTIVE') throw AppError.conflict('This staff is not active');
          if (emp.role !== role)
            throw AppError.conflict(
              `This staff’s job role (${emp.role.toLowerCase()}) cannot fill the ${role.toLowerCase()} position`,
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
              staffId,
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
            where: { tripId, staffId, releasedAt: null },
          });
          if (existing) throw AppError.conflict('This person is already assigned to this trip');
          await tx.tripCrew.createMany({
            data: [
              {
                tenantId: s.tenantId,
                tripId,
                staffId,
                role,
                startsAt: trip.departureAt,
                endsAt: trip.arrivalAt,
              },
            ],
          });
          await recordTripEvent(tx, s, tripId, 'CREW_ASSIGNED', { staffId, role });
          await this.audit(tx, s, 'trips.crew_assigned', 'trip', tripId, requestId, { role });
        }),
      { exclusion: OVERLAP_MSG, unique: 'This person is already assigned to this trip' },
    );
  }

  async release(s: TenantScope, tripId: string, staffId: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId: s.tenantId } });
      if (!trip) throw AppError.notFound();
      if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED')
        throw AppError.conflict('This trip can no longer be changed');
      const res = await tx.tripCrew.updateMany({
        where: { tenantId: s.tenantId, tripId, staffId, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (res.count !== 1) throw AppError.notFound();
      await recordTripEvent(tx, s, tripId, 'CREW_RELEASED', { staffId });
      await this.audit(tx, s, 'trips.crew_released', 'trip', tripId, requestId);
    });
  }
}
