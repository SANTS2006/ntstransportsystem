import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from '../../platform/crypto.js';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { enqueueOutbox } from '../../platform/outbox.js';
import { writeAudit } from '../audit/audit.js';
import type { Page } from '../catalog/catalog.service.js';
import type { Mailer, MailTemplate } from '../notifications/mailer.js';
import { inboxLink, inboxText } from '../notifications/inbox-text.js';
import { assertCanGrant } from '../tenants/delegation.js';
import type { TenantScope } from '../tenants/tenant.guards.js';
import { parseStoredFields, validateAnswers, type FormField } from './form-fields.js';

/** "Make an offer" is not a step: an application goes from the interview straight to hired. */
export type ApplicationStatus =
  'SUBMITTED' | 'SHORTLISTED' | 'INTERVIEW' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
type StaffJobKind = 'DRIVER' | 'CONDUCTOR' | 'DISPATCHER' | 'MECHANIC' | 'OTHER';

/**
 * What HR may do next with an application. INTERVIEW is reached through invite() (which records
 * the details and e-mails them) and HIRED only through hire(); REJECTED stays possible at every
 * step that is still open.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['HIRED', 'REJECTED'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};
/** The plain status changes HR can make with the status action. */
export const SIMPLE_TRANSITIONS = ['SHORTLISTED', 'REJECTED'] as const;
const TERMINAL: string[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];

/** A person can have this many applications in progress at once. */
export const MAX_ACTIVE_APPLICATIONS = 20;

/** Permissions that run the company: only someone who holds them can hire a person into them. */
const ADMIN_PERMISSIONS = new Set([
  'role.manage',
  'membership.invite',
  'membership.revoke',
  'tenant.profile.update',
  'hr.manage',
  'salary.manage',
  'payment.manage',
  'recruitment.manage',
]);

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10));

/** The job a company role stands for in the crew rules (who can be put on a trip, and so on). */
export function jobOfRoleKey(key: string | null | undefined): StaffJobKind {
  const k = (key ?? '').toLowerCase();
  if (k.includes('conductor')) return 'CONDUCTOR';
  if (k.includes('driver')) return 'DRIVER';
  if (k.includes('dispatch')) return 'DISPATCHER';
  if (k.includes('mechanic')) return 'MECHANIC';
  return 'OTHER';
}

export interface JobInput {
  title: string;
  roleKey: string;
  description: string;
  location?: string | undefined;
  closesOn?: string | undefined;
  formFields?: FormField[] | undefined;
}

export interface InterviewInput {
  date: string;
  time: string;
  mode: 'IN_PERSON' | 'PHONE' | 'VIDEO';
  location: string;
  contactPerson?: string | undefined;
  contactPhone?: string | undefined;
  instructions?: string | undefined;
}

export interface HireInput {
  staffNumber: string;
  jobTitle: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY';
  startDate: string;
  reportingTo?: string | undefined;
  workLocation?: string | undefined;
  notes?: string | undefined;
}

const MODE_LABEL = { IN_PERSON: 'In person', PHONE: 'Phone call', VIDEO: 'Video call' } as const;
const EMPLOYMENT_LABEL = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
} as const;

type JobRow = {
  id: string;
  title: string;
  roleKey: string | null;
  description: string;
  location: string | null;
  status: string;
  closesOn: Date | null;
  formFields: unknown;
  createdAt: Date;
};

const jobDto = (j: JobRow, roleName: string | null) => ({
  id: j.id,
  title: j.title,
  roleKey: j.roleKey,
  roleName: roleName ?? j.roleKey,
  description: j.description,
  location: j.location,
  status: j.status,
  closesOn: j.closesOn?.toISOString().slice(0, 10) ?? null,
  formFields: parseStoredFields(j.formFields),
  createdAt: j.createdAt.toISOString(),
});

/** Role names for (company, key) pairs, in one query. */
async function roleNames(tx: Tx, pairs: { tenantId: string; roleKey: string | null }[]) {
  const wanted = pairs.filter((p): p is { tenantId: string; roleKey: string } => !!p.roleKey);
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await tx.role.findMany({
    where: {
      tenantId: { in: [...new Set(wanted.map((w) => w.tenantId))] },
      key: { in: [...new Set(wanted.map((w) => w.roleKey))] },
    },
    select: { tenantId: true, key: true, name: true },
  });
  return new Map(rows.map((r) => [`${r.tenantId}:${r.key}`, r.name]));
}
const nameOf = (m: Map<string, string>, tenantId: string, key: string | null) =>
  key ? (m.get(`${tenantId}:${key}`) ?? null) : null;

export class RecruitmentService {
  constructor(
    private readonly db: Db,
    private readonly mailer?: Mailer,
    private readonly appUrl: string = 'http://localhost:5173',
  ) {}

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

  // ---- Roles a posting can recruit for ---------------------------------------------------------

  /** Every role registered in the company except the company owner role. */
  async listRoles(s: TenantScope) {
    return withDb(this.db, ctxOf(s), (tx) =>
      tx.role.findMany({
        where: { tenantId: s.tenantId, key: { not: 'owner' } },
        select: { key: true, name: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  private async assertRecruitableRole(tx: Tx, tenantId: string, key: string) {
    if (key === 'owner') throw AppError.validation('Choose a role other than the company owner');
    const r = await tx.role.findFirst({ where: { tenantId, key }, select: { id: true } });
    if (!r) throw AppError.validation('That role is not registered in your company');
  }

  // ---- Postings (HR) ---------------------------------------------------------------------------

  async createJob(s: TenantScope, input: JobInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          await this.assertRecruitableRole(tx, s.tenantId, input.roleKey);
          const j = await tx.jobPosting.create({
            data: {
              tenantId: s.tenantId,
              title: input.title,
              roleKey: input.roleKey,
              description: input.description,
              location: input.location ?? null,
              closesOn: input.closesOn ? new Date(input.closesOn) : null,
              formFields: input.formFields ?? [],
              createdBy: s.userId,
            },
          });
          await this.audit(tx, s, 'recruitment.job_created', j.id, requestId);
          const names = await roleNames(tx, [{ tenantId: s.tenantId, roleKey: j.roleKey }]);
          return jobDto(j, nameOf(names, s.tenantId, j.roleKey));
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
          if (patch.roleKey !== undefined)
            await this.assertRecruitableRole(tx, s.tenantId, patch.roleKey);
          const data = {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.roleKey !== undefined ? { roleKey: patch.roleKey } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.location !== undefined ? { location: patch.location } : {}),
            ...(patch.closesOn !== undefined ? { closesOn: new Date(patch.closesOn) } : {}),
            ...(patch.formFields !== undefined ? { formFields: patch.formFields } : {}),
          };
          if (Object.keys(data).length === 0) throw AppError.validation('Nothing to update');
          const u = await tx.jobPosting.update({ where: { id }, data });
          await this.audit(tx, s, 'recruitment.job_updated', id, requestId);
          const names = await roleNames(tx, [{ tenantId: s.tenantId, roleKey: u.roleKey }]);
          return jobDto(u, nameOf(names, s.tenantId, u.roleKey));
        }),
      { check: 'The title or description is too short or too long' },
    );
  }

  async setJobStatus(s: TenantScope, id: string, status: 'OPEN' | 'CLOSED', requestId?: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const j = await tx.jobPosting.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!j) throw AppError.notFound();
      const names = await roleNames(tx, [{ tenantId: s.tenantId, roleKey: j.roleKey }]);
      const roleName = nameOf(names, s.tenantId, j.roleKey);
      // Checked first: an OPEN posting whose closing date has passed is not live, and saying so
      // is more useful than answering "already open".
      if (status === 'OPEN' && j.closesOn && j.closesOn < todayUtc()) {
        throw AppError.conflict(
          'The closing date has passed. Change it before opening the posting.',
        );
      }
      if (status === 'OPEN' && !j.roleKey) {
        throw AppError.conflict('Choose the role this posting recruits for before publishing it.');
      }
      if (j.status === status) return jobDto(j, roleName);
      const u = await tx.jobPosting.update({ where: { id }, data: { status } });
      await this.audit(tx, s, `recruitment.job_${status.toLowerCase()}`, id, requestId);
      return jobDto(u, roleName);
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
      const names = await roleNames(
        tx,
        jobs.map((j) => ({ tenantId: s.tenantId, roleKey: j.roleKey })),
      );
      return jobs.map((j) => ({
        ...jobDto(j, nameOf(names, s.tenantId, j.roleKey)),
        applications: byJob.get(j.id) ?? 0,
      }));
    });
  }

  async getJob(s: TenantScope, id: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const j = await tx.jobPosting.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!j) throw AppError.notFound();
      const names = await roleNames(tx, [{ tenantId: s.tenantId, roleKey: j.roleKey }]);
      return jobDto(j, nameOf(names, s.tenantId, j.roleKey));
    });
  }

  // ---- Applications (HR) -----------------------------------------------------------------------

  async listApplications(
    s: TenantScope,
    page: Page,
    f: { jobId?: string | undefined; status?: string | undefined },
  ) {
    const rows = await withDb(this.db, ctxOf(s), (tx) =>
      tx.jobApplication.findMany({
        where: {
          tenantId: s.tenantId,
          ...(f.jobId ? { jobId: f.jobId } : {}),
          ...(f.status ? { status: f.status as never } : {}),
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
    const { app, files } = await withDb(this.db, ctxOf(s), async (tx) => {
      const app = await tx.jobApplication.findFirst({
        where: { id, tenantId: s.tenantId },
        include: {
          job: { select: { title: true, roleKey: true, formFields: true } },
          events: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      });
      if (!app) throw AppError.notFound();
      const files = await tx.storedFile.findMany({
        where: {
          tenantId: s.tenantId,
          ownerId: id,
          deletedAt: null,
          kind: {
            in: [
              'APPLICATION_CV',
              'APPLICATION_LICENCE',
              'APPLICATION_PHOTO',
              'APPLICATION_FORM_FILE',
            ],
          },
        },
        select: { kind: true, displayName: true, fieldKey: true, contentType: true },
      });
      return { app, files };
    });
    // The applicant's contact address, read separately (users are not tenant data).
    const user = await withDb(this.db, { platform: true }, (tx) =>
      tx.user.findUnique({ where: { id: app.userId }, select: { email: true } }),
    );
    const fields = parseStoredFields(app.job.formFields);
    const answers = (app.formAnswers ?? {}) as Record<string, unknown>;
    const fileOf = (kind: string) => files.find((f) => f.kind === kind);
    return {
      id: app.id,
      jobId: app.jobId,
      jobTitle: app.job.title,
      roleKey: app.job.roleKey,
      fullName: app.fullName,
      phoneNumber: app.phone,
      email: user?.email ?? null,
      yearsExperience: app.yearsExperience,
      experience: app.experience,
      licenceNumber: app.licenceNumber,
      status: app.status,
      staffId: app.staffId,
      cv: fileOf('APPLICATION_CV')?.displayName ?? null,
      licencePhoto: fileOf('APPLICATION_LICENCE')?.displayName ?? null,
      photo: fileOf('APPLICATION_PHOTO')?.displayName ?? null,
      formAnswers: fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        value:
          f.type === 'file'
            ? (files.find((x) => x.kind === 'APPLICATION_FORM_FILE' && x.fieldKey === f.id)
                ?.displayName ?? null)
            : (answers[f.id] ?? null),
      })),
      interview: (app.interview ?? null) as InterviewInput | null,
      createdAt: app.createdAt.toISOString(),
      allowedNext: APPLICATION_TRANSITIONS[app.status as ApplicationStatus] ?? [],
      events: app.events.map((e) => ({
        id: e.id,
        from: e.fromStatus,
        to: e.toStatus,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  // ---- Applicant notices (e-mail and in-app) -----------------------------------------------------

  private async applicantContact(tenantId: string, userId: string, jobId: string) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const [user, tenant, job] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } }),
        tx.jobPosting.findFirst({ where: { id: jobId, tenantId }, select: { title: true } }),
      ]);
      return {
        email: user?.email ?? null,
        company: tenant?.name ?? 'the company',
        slug: tenant?.slug ?? '',
        job: job?.title ?? 'the job',
      };
    });
  }

  /**
   * E-mails the applicant and leaves the same notice in their in-app inbox. A failed e-mail never
   * undoes the decision: the caller is told the mail did not go so HR can follow up.
   */
  private async notifyApplicant(
    a: { tenantId: string; userId: string; id: string },
    template: MailTemplate,
    data: Record<string, string>,
    to: string | null,
    /** Details that must reach the person by e-mail only (a first password). */
    secret: Record<string, string> = {},
  ): Promise<boolean> {
    const text = inboxText(template, data);
    if (text) {
      await withDb(this.db, { platform: true }, (tx) =>
        tx.inboxNotification.createMany({
          data: [
            {
              tenantId: a.tenantId,
              userId: a.userId,
              outboxEventId: randomUUID(),
              dedupeKey: `${template}:${a.id}:${randomUUID()}`,
              template,
              title: text.title,
              body: text.body,
              link: inboxLink(data.link),
            },
          ],
          skipDuplicates: true,
        }),
      );
    }
    if (!to || !this.mailer) return false;
    try {
      await this.mailer.send({
        to,
        template,
        data: { ...data, ...secret },
        tenantId: a.tenantId,
      });
      return true;
    } catch {
      return false;
    }
  }

  private appLink(slug: string) {
    return `${this.appUrl.replace(/\/$/, '')}${slug ? `/${slug}` : ''}/applications`;
  }

  // ---- Decisions ---------------------------------------------------------------------------------

  /** Shortlist or reject. Rejecting e-mails the applicant (with HR's message, if one was written). */
  async transition(
    s: TenantScope,
    id: string,
    to: (typeof SIMPLE_TRANSITIONS)[number],
    note?: string,
    requestId?: string,
  ) {
    const app = await withDb(this.db, ctxOf(s), async (tx) => {
      const a = await tx.jobApplication.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!a) throw AppError.notFound();
      const from = a.status as ApplicationStatus;
      if (!APPLICATION_TRANSITIONS[from]?.includes(to)) {
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
      // Shortlisting goes through the notification worker; a rejection is mailed right here.
      if (to === 'SHORTLISTED') {
        await enqueueOutbox(tx, {
          tenantId: s.tenantId,
          type: 'application.status_changed',
          payload: { applicationId: id, status: to },
          dedupeKey: `application.status_changed:${id}:${to}`,
        });
      }
      await this.audit(tx, s, 'recruitment.application_status', id, requestId, { from, to });
      return a;
    });
    if (to !== 'REJECTED') return { emailed: true };
    const c = await this.applicantContact(s.tenantId, app.userId, app.jobId);
    const emailed = await this.notifyApplicant(
      { tenantId: s.tenantId, userId: app.userId, id },
      'application-rejected',
      {
        name: app.fullName,
        job: c.job,
        company: c.company,
        message: note ?? '',
        link: this.appLink(c.slug),
      },
      c.email,
    );
    return { emailed };
  }

  /**
   * Invites an applicant to an interview: records the details, moves a shortlisted application to
   * the interview step (or updates the details of one already there) and e-mails the applicant.
   */
  async invite(s: TenantScope, id: string, input: InterviewInput, requestId?: string) {
    const a = await withDb(this.db, ctxOf(s), async (tx) => {
      const a = await tx.jobApplication.findFirst({ where: { id, tenantId: s.tenantId } });
      if (!a) throw AppError.notFound();
      const from = a.status as ApplicationStatus;
      if (from !== 'SHORTLISTED' && from !== 'INTERVIEW') {
        throw AppError.conflict('Only a shortlisted applicant can be invited to an interview');
      }
      const res = await tx.jobApplication.updateMany({
        where: { id, tenantId: s.tenantId, status: from },
        data: { status: 'INTERVIEW', interview: input as never },
      });
      if (res.count !== 1)
        throw AppError.conflict('This application was just changed by someone else');
      await tx.applicationEvent.createMany({
        data: [
          {
            tenantId: s.tenantId,
            applicationId: id,
            fromStatus: from,
            toStatus: 'INTERVIEW',
            note: `${from === 'INTERVIEW' ? 'Interview updated' : 'Interview invitation'}: ${input.date} ${input.time}, ${input.location}`,
            actorUserId: s.userId,
          },
        ],
      });
      await this.audit(tx, s, 'recruitment.interview_invited', id, requestId, {
        rescheduled: from === 'INTERVIEW',
      });
      return a;
    });
    const c = await this.applicantContact(s.tenantId, a.userId, a.jobId);
    const emailed = await this.notifyApplicant(
      { tenantId: s.tenantId, userId: a.userId, id },
      'interview-invitation',
      {
        name: a.fullName,
        job: c.job,
        company: c.company,
        date: input.date,
        time: input.time,
        mode: MODE_LABEL[input.mode],
        location: input.location,
        contactPerson: input.contactPerson ?? '',
        contactPhone: input.contactPhone ?? '',
        instructions: input.instructions ?? '',
        link: this.appLink(c.slug),
      },
      c.email,
    );
    return { emailed };
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

  /**
   * Hires an interviewed applicant: a staff profile is created (linked to their account), the
   * account gets the posting's role in the company with a default password to change at first
   * sign-in, the application becomes HIRED, all in one transaction. The employment details and
   * the password are then e-mailed to the new staff member.
   */
  async hire(s: TenantScope, id: string, input: HireInput, requestId?: string) {
    const password = randomBytes(10).toString('base64url');
    const out = await mapDbErrors(
      () =>
        withDb(this.db, { platform: true, userId: s.userId }, async (tx) => {
          const a = await tx.jobApplication.findFirst({
            where: { id, tenantId: s.tenantId },
            include: { job: { select: { title: true, roleKey: true } } },
          });
          if (!a) throw AppError.notFound();
          if (a.status !== 'INTERVIEW')
            throw AppError.conflict('Only an applicant who has been interviewed can be hired');
          if (!a.job.roleKey)
            throw AppError.conflict('The posting has no role. Set one before hiring.');
          const role = await tx.role.findFirst({
            where: { tenantId: s.tenantId, key: a.job.roleKey },
            include: { permissions: true },
          });
          if (!role || role.key === 'owner')
            throw AppError.conflict('The role of this posting is no longer available');
          // Running roles (managing people, pay, roles) can only be given by someone who holds them.
          assertCanGrant(
            s,
            role.permissions.map((p) => p.permission).filter((p) => ADMIN_PERMISSIONS.has(p)),
          );

          const existing = await tx.membership.findFirst({
            where: { tenantId: s.tenantId, userId: a.userId },
          });
          if (existing && existing.status !== 'REVOKED')
            throw AppError.conflict('This person already works for the company');
          const user = await tx.user.findUnique({
            where: { id: a.userId },
            select: { email: true },
          });
          // A default password is only useful when it can be delivered: people who signed up by
          // phone number keep signing in the way they do.
          const reset = Boolean(user?.email);
          if (reset) {
            await tx.user.update({
              where: { id: a.userId },
              data: { passwordHash: await hashPassword(password), mustChangePassword: true },
            });
          }

          const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
          const staff = await tx.staffProfile.create({
            data: {
              tenantId: s.tenantId,
              userId: a.userId,
              staffNumber: input.staffNumber,
              fullName: a.fullName,
              role: jobOfRoleKey(role.key),
              phone: a.phone,
              hiredOn: startDate,
              employment: {
                jobTitle: input.jobTitle,
                employmentType: input.employmentType,
                startDate: input.startDate,
                reportingTo: input.reportingTo ?? null,
                workLocation: input.workLocation ?? null,
                notes: input.notes ?? null,
                roleKey: role.key,
              },
            },
          });
          await tx.membership.upsert({
            where: { tenantId_userId: { tenantId: s.tenantId, userId: a.userId } },
            update: { roleId: role.id, status: 'ACTIVE', passengerMode: false },
            create: {
              tenantId: s.tenantId,
              userId: a.userId,
              roleId: role.id,
              status: 'ACTIVE',
              invitedBy: s.userId,
            },
          });
          const res = await tx.jobApplication.updateMany({
            where: { id, tenantId: s.tenantId, status: 'INTERVIEW' },
            data: { status: 'HIRED', staffId: staff.id },
          });
          if (res.count !== 1)
            throw AppError.conflict('This application was just changed by someone else');
          await tx.applicationEvent.createMany({
            data: [
              {
                tenantId: s.tenantId,
                applicationId: id,
                fromStatus: 'INTERVIEW',
                toStatus: 'HIRED',
                note: `Staff number ${input.staffNumber}, starts ${input.startDate}`,
                actorUserId: s.userId,
              },
            ],
          });
          await writeAudit(tx, {
            action: 'recruitment.hired',
            outcome: 'SUCCESS',
            tenantId: s.tenantId,
            actorUserId: s.userId,
            targetType: 'recruitment',
            targetId: id,
            requestId,
            summary: { staffId: staff.id, role: role.key, passwordReset: reset },
          });
          return { staffId: staff.id, a, reset, email: user?.email ?? null };
        }),
      {
        unique: 'A staff member with this number already exists',
        check: 'The staff number or a detail is not valid',
      },
    );
    const c = await this.applicantContact(s.tenantId, out.a.userId, out.a.jobId);
    const emailed = await this.notifyApplicant(
      { tenantId: s.tenantId, userId: out.a.userId, id },
      'application-hired',
      {
        name: out.a.fullName,
        job: c.job,
        company: c.company,
        staffNumber: input.staffNumber,
        jobTitle: input.jobTitle,
        employmentType: EMPLOYMENT_LABEL[input.employmentType],
        startDate: input.startDate,
        reportingTo: input.reportingTo ?? '',
        workLocation: input.workLocation ?? '',
        notes: input.notes ?? '',
        email: out.email ?? '',
        link: `${this.appUrl.replace(/\/$/, '')}${c.slug ? `/${c.slug}` : ''}/login`,
      },
      out.email,
      out.reset ? { password } : {},
    );
    return { staffId: out.staffId, emailed };
  }

  // ---- Public listings -------------------------------------------------------------------------

  private openWhere() {
    return {
      status: 'OPEN' as const,
      OR: [{ closesOn: null }, { closesOn: { gte: todayUtc() } }],
      tenant: { status: 'ACTIVE' as const },
    };
  }

  async listOpen(q?: string, tenantId?: string) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const rows = await tx.jobPosting.findMany({
        where: {
          ...this.openWhere(),
          ...(tenantId ? { tenantId } : {}),
          ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
        },
        include: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const names = await roleNames(
        tx,
        rows.map((j) => ({ tenantId: j.tenantId, roleKey: j.roleKey })),
      );
      return rows.map((j) => ({
        ...jobDto(j, nameOf(names, j.tenantId, j.roleKey)),
        tenantId: j.tenantId,
        company: j.tenant.name,
      }));
    });
  }

  async getOpen(tenantId: string, id: string) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const j = await tx.jobPosting.findFirst({
        where: { id, tenantId, ...this.openWhere() },
        include: { tenant: { select: { name: true } } },
      });
      if (!j) throw AppError.notFound();
      const names = await roleNames(tx, [{ tenantId: j.tenantId, roleKey: j.roleKey }]);
      return {
        ...jobDto(j, nameOf(names, j.tenantId, j.roleKey)),
        tenantId: j.tenantId,
        company: j.tenant.name,
      };
    });
  }

  // ---- Applicants --------------------------------------------------------------------------------

  async apply(
    userId: string,
    input: {
      tenantId: string;
      jobId: string;
      fullName: string;
      phoneNumber: string;
      yearsExperience: number;
      experience: string;
      licenceNumber?: string | undefined;
      answers?: Record<string, unknown> | undefined;
    },
    requestId?: string,
  ) {
    const job = await this.getOpen(input.tenantId, input.jobId);
    const answers = validateAnswers(job.formFields, input.answers ?? {});
    const active = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobApplication.count({ where: { userId, status: { notIn: TERMINAL as never[] } } }),
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
              phone: input.phoneNumber,
              yearsExperience: input.yearsExperience,
              experience: input.experience,
              licenceNumber: input.licenceNumber ?? null,
              formAnswers: answers,
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
              kind: { in: ['APPLICATION_CV', 'APPLICATION_LICENCE', 'APPLICATION_PHOTO'] },
              ownerId: { in: rows.map((r) => r.id) },
              deletedAt: null,
            },
            select: { ownerId: true, displayName: true, kind: true },
          })
        : [];
      return { rows, cvs };
    });
    const fileName = (id: string, kind: string) =>
      cvs.find((c) => c.ownerId === id && c.kind === kind)?.displayName ?? null;
    return rows.map((a) => ({
      cv: fileName(a.id, 'APPLICATION_CV'),
      licencePhoto: fileName(a.id, 'APPLICATION_LICENCE'),
      photo: fileName(a.id, 'APPLICATION_PHOTO'),
      id: a.id,
      company: a.tenant.name,
      jobTitle: a.job.title,
      status: a.status,
      interview:
        a.status === 'INTERVIEW' && a.interview ? (a.interview as unknown as InterviewInput) : null,
      createdAt: a.createdAt.toISOString(),
      canWithdraw: !TERMINAL.includes(a.status),
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
    if (TERMINAL.includes(a.status)) {
      throw AppError.conflict('This application can no longer be withdrawn');
    }
    await withDb(this.db, { tenantId: a.tenantId, userId }, async (tx) => {
      const res = await tx.jobApplication.updateMany({
        where: { id, tenantId: a.tenantId, status: { notIn: TERMINAL as never[] } },
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
