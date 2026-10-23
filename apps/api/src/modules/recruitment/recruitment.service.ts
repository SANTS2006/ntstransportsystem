import { withDb, type Db } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import { writeAudit } from '../audit/audit.js';
import type { Page } from '../catalog/catalog.service.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export type ApplicationStatus =
  'SUBMITTED' | 'SHORTLISTED' | 'INTERVIEW' | 'OFFERED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type JobRole = 'DRIVER' | 'CONDUCTOR' | 'DISPATCHER' | 'MECHANIC' | 'OTHER';

/**
 * What HR may do next with an application. HIRED is deliberately not listed: it is reached only
 * through hire(), which also creates the employee record in the same transaction.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['OFFERED', 'REJECTED'],
  OFFERED: ['REJECTED'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};
const TERMINAL: ApplicationStatus[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];

/** A person can have this many applications in progress at once. */
export const MAX_ACTIVE_APPLICATIONS = 20;

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10));

export interface JobInput {
  title: string;
  jobRole: JobRole;
  description: string;
  location?: string | undefined;
  closesOn?: string | undefined;
}

const jobDto = (j: {
  id: string;
  title: string;
  jobRole: string;
  description: string;
  location: string | null;
  status: string;
  closesOn: Date | null;
  createdAt: Date;
}) => ({
  id: j.id,
  title: j.title,
  jobRole: j.jobRole,
  description: j.description,
  location: j.location,
  status: j.status,
  closesOn: j.closesOn?.toISOString().slice(0, 10) ?? null,
  createdAt: j.createdAt.toISOString(),
});

export class RecruitmentService {
  constructor(private readonly db: Db) {}

  private audit(
    tx: Parameters<typeof writeAudit>[0],
    s: TenantScope,
    action: string,
    targetId: string,
    requestId?: string,
    summary?: Record<string, string | number | boolean | null>,
  ) {
    return writeAudit(tx, {
      action,
      outcome: 'SUCCESS',
      tenantId: s.tenantId,
      actorUserId: s.userId,
      targetType: 'recruitment',
      targetId,
      requestId,
      ...(summary ? { summary } : {}),
    });
  }

  // ---- Postings (HR) ---------------------------------------------------------------------------

  async createJob(s: TenantScope, input: JobInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const j = await tx.jobPosting.create({
            data: {
              tenantId: s.tenantId,
              title: input.title,
              jobRole: input.jobRole,
              description: input.description,
              location: input.location ?? null,
              closesOn: input.closesOn ? new Date(input.closesOn) : null,
              createdBy: s.userId,
            },
          });
          await this.audit(tx, s, 'recruitment.job_created', j.id, requestId);
          return jobDto(j);
        }),
      { check: 'The title or description is too short or too long' },
    );
  }

  async updateJob(
    s: TenantScope,
    id: string,
    patch: { [K in keyof JobInput]?: JobInput[K] | undefined },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const j = await tx.jobPosting.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!j) throw AppError.notFound();
          if (j.status === 'CLOSED')
            throw AppError.conflict('A closed posting cannot be edited. Reopen it first.');
          const data = {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.jobRole !== undefined ? { jobRole: patch.jobRole } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.location !== undefined ? { location: patch.location } : {}),
            ...(patch.closesOn !== undefined ? { closesOn: new Date(patch.closesOn) } : {}),
          };
          if (Object.keys(data).length === 0) throw AppError.validation('Nothing to update');
          const u = await tx.jobPosting.update({ where: { id }, data });
          await this.audit(tx, s, 'recruitment.job_updated', id, requestId);
          return jobDto(u);
        }),
      { check: 'The title or description is too short or too long' },
    );
  }

  async setJobStatus(s: TenantScope, id: string, status: 'OPEN' | 'CLOSED', requestId?: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const j = await tx.jobPosting.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!j) throw AppError.notFound();
      // Checked first: an OPEN posting whose closing date has passed is not live, and saying so
      // is more useful than answering "already open".
      if (status === 'OPEN' && j.closesOn && j.closesOn < todayUtc()) {
        throw AppError.conflict(
          'The closing date has passed. Change it before opening the posting.',
        );
      }
      if (j.status === status) return jobDto(j);
      const u = await tx.jobPosting.update({ where: { id }, data: { status } });
      await this.audit(tx, s, `recruitment.job_${status.toLowerCase()}`, id, requestId);
      return jobDto(u);
    });
  }

  async listJobs(s: TenantScope, page: Page, status?: 'DRAFT' | 'OPEN' | 'CLOSED') {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const jobs = await tx.jobPosting.findMany({
        where: { tenantId: s.tenantId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
      });
      const counts = jobs.length
        ? await tx.jobApplication.groupBy({
            by: ['jobId'],
            where: { tenantId: s.tenantId, jobId: { in: jobs.map((j) => j.id) } },
            _count: true,
          })
        : [];
      const byJob = new Map(counts.map((c) => [c.jobId, c._count]));
      return jobs.map((j) => ({ ...jobDto(j), applications: byJob.get(j.id) ?? 0 }));
    });
  }

  async getJob(s: TenantScope, id: string) {
    const j = await withDb(this.db, ctxOf(s), (tx) =>
      tx.jobPosting.findFirst({ where: { id, tenantId: s.tenantId } }),
    );
    if (!j) throw AppError.notFound();
    return jobDto(j);
  }

  // ---- Applications (HR) -----------------------------------------------------------------------

  async listApplications(
    s: TenantScope,
    page: Page,
    f: { jobId?: string | undefined; status?: ApplicationStatus | undefined },
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.jobApplication.findMany({
        where: {
          tenantId: s.tenantId,
          ...(f.jobId ? { jobId: f.jobId } : {}),
          ...(f.status ? { status: f.status } : {}),
        },
        include: { job: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((a) => ({
      id: a.id,
      jobId: a.jobId,
      jobTitle: a.job.title,
      fullName: a.fullName,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async getApplication(s: TenantScope, id: string) {
    const app = await withDb(this.db, ctxOf(s), (tx) =>
      tx.jobApplication.findFirst({
        where: { id, tenantId: s.tenantId },
        include: {
          job: { select: { title: true, jobRole: true } },
          events: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      }),
    );
    if (!app) throw AppError.notFound();
    // The applicant's contact address, read separately (users are not tenant data).
    const user = await withDb(this.db, { platform: true }, (tx) =>
      tx.user.findUnique({ where: { id: app.userId }, select: { email: true } }),
    );
    const cv = await withDb(this.db, ctxOf(s), (tx) =>
      tx.storedFile.findFirst({
        where: { tenantId: s.tenantId, kind: 'APPLICATION_CV', ownerId: id, deletedAt: null },
        select: { displayName: true },
      }),
    );
    const a = { app, email: user?.email ?? null };
    return {
      id: a.app.id,
      jobId: a.app.jobId,
      jobTitle: a.app.job.title,
      jobRole: a.app.job.jobRole,
      fullName: a.app.fullName,
      phone: a.app.phone,
      email: a.email,
      experience: a.app.experience,
      licenceNumber: a.app.licenceNumber,
      status: a.app.status,
      employeeId: a.app.employeeId,
      cv: cv?.displayName ?? null,
      createdAt: a.app.createdAt.toISOString(),
      allowedNext: APPLICATION_TRANSITIONS[a.app.status as ApplicationStatus],
      events: a.app.events.map((e) => ({
        id: e.id,
        from: e.fromStatus,
        to: e.toStatus,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  async transition(
    s: TenantScope,
    id: string,
    to: ApplicationStatus,
    note?: string,
    requestId?: string,
  ) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const a = await tx.jobApplication.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!a) throw AppError.notFound();
      const from = a.status as ApplicationStatus;
      if (!APPLICATION_TRANSITIONS[from].includes(to)) {
        throw AppError.conflict(
          `An application that is ${from.toLowerCase()} cannot move to ${to.toLowerCase()}`,
        );
      }
      // Compare-and-set so two HR users acting at once cannot both apply a transition.
      const res = await tx.jobApplication.updateMany({
        where: { id, tenantId: s.tenantId, status: from },
        data: { status: to },
      });
      if (res.count !== 1)
        throw AppError.conflict('This application was just changed by someone else');
      await tx.applicationEvent.createMany({
        data: [
          {
            tenantId: s.tenantId,
            applicationId: id,
            fromStatus: from,
            toStatus: to,
            note: note ?? null,
            actorUserId: s.userId,
          },
        ],
      });
      await enqueueOutbox(tx, {
        tenantId: s.tenantId,
        type: 'application.status_changed',
        payload: { applicationId: id, status: to },
        dedupeKey: `application.status_changed:${id}:${to}`,
      });
      await this.audit(tx, s, 'recruitment.application_status', id, requestId, { from, to });
    });
  }

  async addNote(s: TenantScope, id: string, note: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const a = await tx.jobApplication.findFirst({
        where: { id, tenantId: s.tenantId },
        select: { id: true },
      });
      if (!a) throw AppError.notFound();
      await tx.applicationEvent.createMany({
        data: [{ tenantId: s.tenantId, applicationId: id, note, actorUserId: s.userId }],
      });
      await this.audit(tx, s, 'recruitment.application_note', id, requestId);
    });
  }

  /** Offer accepted: the applicant becomes an employee record and the application is HIRED, together. */
  async hire(
    s: TenantScope,
    id: string,
    input: { employeeNumber: string; hiredOn?: string | undefined },
    requestId?: string,
  ) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const a = await tx.jobApplication.findFirst({
            where: { id, tenantId: s.tenantId },
            include: { job: { select: { jobRole: true } } },
          });
          if (!a) throw AppError.notFound();
          if (a.status !== 'OFFERED')
            throw AppError.conflict('Only an application with an offer can be hired');
          const emp = await tx.employee.create({
            data: {
              tenantId: s.tenantId,
              userId: a.userId,
              employeeNumber: input.employeeNumber,
              fullName: a.fullName,
              role: a.job.jobRole,
              phone: a.phone,
              hiredOn: input.hiredOn ? new Date(input.hiredOn) : todayUtc(),
            },
          });
          const res = await tx.jobApplication.updateMany({
            where: { id, tenantId: s.tenantId, status: 'OFFERED' },
            data: { status: 'HIRED', employeeId: emp.id },
          });
          if (res.count !== 1)
            throw AppError.conflict('This application was just changed by someone else');
          await tx.applicationEvent.createMany({
            data: [
              {
                tenantId: s.tenantId,
                applicationId: id,
                fromStatus: 'OFFERED',
                toStatus: 'HIRED',
                actorUserId: s.userId,
              },
            ],
          });
          await enqueueOutbox(tx, {
            tenantId: s.tenantId,
            type: 'application.status_changed',
            payload: { applicationId: id, status: 'HIRED' },
            dedupeKey: `application.status_changed:${id}:HIRED`,
          });
          await this.audit(tx, s, 'recruitment.hired', id, requestId, { employeeId: emp.id });
          return { employeeId: emp.id };
        }),
      {
        unique: 'An employee with this number already exists',
        check: 'The employee number is not valid',
      },
    );
  }

  // ---- Public listings -------------------------------------------------------------------------

  private openWhere() {
    return {
      status: 'OPEN' as const,
      OR: [{ closesOn: null }, { closesOn: { gte: todayUtc() } }],
      tenant: { status: 'ACTIVE' as const },
    };
  }

  async listOpen(q?: string) {
    const rows = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobPosting.findMany({
        where: {
          ...this.openWhere(),
          ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
        },
        include: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map((j) => ({ ...jobDto(j), tenantId: j.tenantId, company: j.tenant.name }));
  }

  async getOpen(tenantId: string, id: string) {
    const j = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobPosting.findFirst({
        where: { id, tenantId, ...this.openWhere() },
        include: { tenant: { select: { name: true } } },
      }),
    );
    if (!j) throw AppError.notFound();
    return { ...jobDto(j), tenantId: j.tenantId, company: j.tenant.name };
  }

  // ---- Applicants --------------------------------------------------------------------------------

  async apply(
    userId: string,
    input: {
      tenantId: string;
      jobId: string;
      fullName: string;
      phone: string;
      experience: string;
      licenceNumber?: string | undefined;
    },
    requestId?: string,
  ) {
    const job = await this.getOpen(input.tenantId, input.jobId);
    const active = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobApplication.count({ where: { userId, status: { notIn: TERMINAL } } }),
    );
    if (active >= MAX_ACTIVE_APPLICATIONS) {
      throw AppError.conflict(
        'You have many applications in progress. Please wait for answers before applying to more.',
      );
    }
    return mapDbErrors(
      () =>
        withDb(this.db, { tenantId: input.tenantId, userId }, async (tx) => {
          const a = await tx.jobApplication.create({
            data: {
              tenantId: input.tenantId,
              jobId: job.id,
              userId,
              fullName: input.fullName,
              phone: input.phone,
              experience: input.experience,
              licenceNumber: input.licenceNumber ?? null,
            },
          });
          await tx.applicationEvent.createMany({
            data: [
              {
                tenantId: input.tenantId,
                applicationId: a.id,
                toStatus: 'SUBMITTED',
                actorUserId: userId,
              },
            ],
          });
          await enqueueOutbox(tx, {
            tenantId: input.tenantId,
            type: 'application.received',
            payload: { applicationId: a.id },
            dedupeKey: `application.received:${a.id}`,
          });
          await writeAudit(tx, {
            action: 'recruitment.applied',
            outcome: 'SUCCESS',
            tenantId: input.tenantId,
            actorUserId: userId,
            targetType: 'recruitment',
            targetId: a.id,
            requestId,
          });
          return { id: a.id };
        }),
      {
        unique: 'You have already applied for this job',
        check: 'Some of your answers are too short or too long',
      },
    );
  }

  async listOwn(userId: string) {
    const { rows, cvs } = await withDb(this.db, { platform: true }, async (tx) => {
      const rows = await tx.jobApplication.findMany({
        where: { userId },
        include: { job: { select: { title: true } }, tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const cvs = rows.length
        ? await tx.storedFile.findMany({
            where: {
              kind: 'APPLICATION_CV',
              ownerId: { in: rows.map((r) => r.id) },
              deletedAt: null,
            },
            select: { ownerId: true, displayName: true },
          })
        : [];
      return { rows, cvs };
    });
    const cvName = new Map(cvs.map((c) => [c.ownerId, c.displayName]));
    return rows.map((a) => ({
      cv: cvName.get(a.id) ?? null,
      id: a.id,
      company: a.tenant.name,
      jobTitle: a.job.title,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      canWithdraw: !TERMINAL.includes(a.status as ApplicationStatus),
    }));
  }

  async withdraw(userId: string, id: string, requestId?: string) {
    const a = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobApplication.findFirst({
        where: { id, userId },
        select: { id: true, tenantId: true, status: true },
      }),
    );
    if (!a) throw AppError.notFound();
    if (TERMINAL.includes(a.status as ApplicationStatus)) {
      throw AppError.conflict('This application can no longer be withdrawn');
    }
    await withDb(this.db, { tenantId: a.tenantId, userId }, async (tx) => {
      const res = await tx.jobApplication.updateMany({
        where: { id, tenantId: a.tenantId, status: { notIn: TERMINAL } },
        data: { status: 'WITHDRAWN' },
      });
      if (res.count !== 1) throw AppError.conflict('This application can no longer be withdrawn');
      await tx.applicationEvent.createMany({
        data: [
          {
            tenantId: a.tenantId,
            applicationId: id,
            fromStatus: a.status,
            toStatus: 'WITHDRAWN',
            actorUserId: userId,
          },
        ],
      });
      await writeAudit(tx, {
        action: 'recruitment.withdrawn',
        outcome: 'SUCCESS',
        tenantId: a.tenantId,
        actorUserId: userId,
        targetType: 'recruitment',
        targetId: id,
        requestId,
      });
    });
  }
}
