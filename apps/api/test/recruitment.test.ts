import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import { OutboxProcessor } from '../src/platform/outbox.js';
import {
  CaptureMailer,
  createDb,
  createTenantWithOwner,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  type Client,
} from './helpers.js';

describe.skipIf(!TEST_DB_URL)('recruitment (database)', () => {
  let db: Db;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    ctx = makeApp(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const plat = <T>(fn: (tx: Tx) => Promise<T>) => withDb(db, { platform: true }, fn);

  async function member(tenantId: string, roleKey: string): Promise<Client> {
    const c = await newClient(ctx.app, db, roleKey);
    await plat(async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
      await tx.membership.create({
        data: { tenantId, userId: c.userId, roleId: role.id, status: 'ACTIVE' },
      });
    });
    return c;
  }
  async function company(label: string) {
    const t = await createTenantWithOwner(db, label);
    return {
      tenantId: t.tenant.id,
      owner: await loginClient(ctx.app, db, t.email, t.password),
      ownerEmail: t.email,
    };
  }

  const job = (extra: Record<string, unknown> = {}) => ({
    title: 'Long-distance bus driver',
    roleKey: 'driver',
    description:
      'Drive our Freetown to Bo route. Valid licence and two years of experience required.',
    location: 'Freetown',
    ...extra,
  });
  const application = (tenantId: string, jobId: string, extra: Record<string, unknown> = {}) => ({
    tenantId,
    jobId,
    fullName: 'Ibrahim Koroma',
    phoneNumber: '+23276123456',
    yearsExperience: 8,
    experience: 'Eight years driving coaches between Freetown and Bo, no accidents.',
    licenceNumber: 'SL-123456',
    ...extra,
  });
  const publicJobs = () => request(ctx.app).get('/api/v1/public/jobs');

  it('lets HR draft, publish, edit and close postings, and shows only open ones publicly', async () => {
    const c = await company('rc-jobs');
    const hr = await member(c.tenantId, 'hr_manager');
    const agent = await member(c.tenantId, 'sales_agent');
    const other = await company('rc-jobs-other');
    const base = `/tenants/${c.tenantId}/jobs`;

    await agent.call('get', base).expect(403);
    await agent.call('post', base).send(job()).expect(403);
    await other.owner.call('get', `/tenants/${c.tenantId}/jobs`).expect(404);
    await hr
      .call('post', base)
      .send(job({ title: 'ab' }))
      .expect(400);
    await hr
      .call('post', base)
      .send(job({ description: 'too short' }))
      .expect(400);
    await hr
      .call('post', base)
      .send(job({ closesOn: '2020-01-01' }))
      .expect(400);
    await hr
      .call('post', base)
      .send(job({ roleKey: 'ceo' }))
      .expect(400); // not a role of this company
    await hr
      .call('post', base)
      .send(job({ roleKey: 'owner' }))
      .expect(400); // never the owner role
    await hr
      .call('post', base)
      .send(job({ status: 'OPEN' }))
      .expect(400); // cannot create as open

    const made = (await hr.call('post', base).send(job()).expect(201)).body as {
      id: string;
      status: string;
    };
    expect(made.status).toBe('DRAFT');
    expect(
      (await publicJobs().expect(200)).body.jobs.some((j: { id: string }) => j.id === made.id),
    ).toBe(false);
    await request(ctx.app).get(`/api/v1/public/jobs/${c.tenantId}/${made.id}`).expect(404);

    await hr.call('patch', `${base}/${made.id}`).send({}).expect(400);
    await hr.call('patch', `${base}/${made.id}`).send({ title: 'Senior coach driver' }).expect(200);
    await hr.call('post', `${base}/${made.id}/open`).expect(200);
    const listed = (await publicJobs().expect(200)).body.jobs.find(
      (j: { id: string }) => j.id === made.id,
    );
    expect(listed).toMatchObject({
      title: 'Senior coach driver',
      company: expect.any(String),
      tenantId: c.tenantId,
    });
    await request(ctx.app).get(`/api/v1/public/jobs/${c.tenantId}/${made.id}`).expect(200);
    await request(ctx.app).get(`/api/v1/public/jobs/${other.tenantId}/${made.id}`).expect(404); // wrong company id

    // A job whose closing date has passed drops out of the public list on its own.
    await plat((tx) =>
      tx.jobPosting.update({ where: { id: made.id }, data: { closesOn: new Date('2020-01-01') } }),
    );
    expect(
      (await publicJobs().expect(200)).body.jobs.some((j: { id: string }) => j.id === made.id),
    ).toBe(false);
    await hr.call('post', `${base}/${made.id}/open`).expect(409); // cannot reopen with a past closing date
    await plat((tx) => tx.jobPosting.update({ where: { id: made.id }, data: { closesOn: null } }));
    await hr.call('post', `${base}/${made.id}/close`).expect(200);
    await hr
      .call('patch', `${base}/${made.id}`)
      .send({ title: 'Edited after closing' })
      .expect(409);
    expect(
      (await publicJobs().expect(200)).body.jobs.some((j: { id: string }) => j.id === made.id),
    ).toBe(false);

    // A suspended company's postings disappear immediately.
    await hr.call('post', `${base}/${made.id}/open`).expect(200);
    await plat((tx) =>
      tx.tenant.update({ where: { id: c.tenantId }, data: { status: 'SUSPENDED' } }),
    );
    expect(
      (await publicJobs().expect(200)).body.jobs.some((j: { id: string }) => j.id === made.id),
    ).toBe(false);
  }, 600_000);

  it('lets a signed-in person apply once, see only their own applications, and withdraw', async () => {
    const c = await company('rc-apply');
    const hr = await member(c.tenantId, 'hr_manager');
    const other = await company('rc-apply-other');
    const open = (await hr.call('post', `/tenants/${c.tenantId}/jobs`).send(job()).expect(201))
      .body as { id: string };
    const draft = (
      await hr
        .call('post', `/tenants/${c.tenantId}/jobs`)
        .send(job({ title: 'Draft job here' }))
        .expect(201)
    ).body as { id: string };
    await hr.call('post', `/tenants/${c.tenantId}/jobs/${open.id}/open`).expect(200);
    const a = await newClient(ctx.app, db, 'rc-applicant-a');
    const b = await newClient(ctx.app, db, 'rc-applicant-b');

    await request(ctx.app)
      .post('/api/v1/applicant/applications')
      .send(application(c.tenantId, open.id))
      .expect(401);
    await a
      .call('post', '/applicant/applications')
      .send(application(c.tenantId, draft.id))
      .expect(404); // not open
    await a
      .call('post', '/applicant/applications')
      .send(application(other.tenantId, open.id))
      .expect(404); // wrong company
    await a
      .call('post', '/applicant/applications')
      .send(application(c.tenantId, open.id, { phoneNumber: 'abc' }))
      .expect(400);
    await a
      .call('post', '/applicant/applications')
      .send(application(c.tenantId, open.id, { experience: 'short' }))
      .expect(400);
    await a
      .call('post', '/applicant/applications')
      .send(application(c.tenantId, open.id, { status: 'HIRED' }))
      .expect(400);

    const made = (
      await a
        .call('post', '/applicant/applications')
        .send(application(c.tenantId, open.id))
        .expect(201)
    ).body as { id: string };
    await a
      .call('post', '/applicant/applications')
      .send(application(c.tenantId, open.id))
      .expect(409); // only once
    const mine = (await a.call('get', '/applicant/applications').expect(200)).body.applications;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      jobTitle: 'Long-distance bus driver',
      status: 'SUBMITTED',
      canWithdraw: true,
    });
    expect((await b.call('get', '/applicant/applications').expect(200)).body.applications).toEqual(
      [],
    );
    await b.call('post', `/applicant/applications/${made.id}/withdraw`).expect(404);

    // Applicant data is visible to HR only, and only in their own company.
    const agent = await member(c.tenantId, 'sales_agent');
    await agent.call('get', `/tenants/${c.tenantId}/applications`).expect(403);
    await agent.call('get', `/tenants/${c.tenantId}/applications/${made.id}`).expect(403);
    await other.owner.call('get', `/tenants/${other.tenantId}/applications/${made.id}`).expect(404);
    const seen = await hr.call('get', `/tenants/${c.tenantId}/applications/${made.id}`).expect(200);
    expect(seen.body).toMatchObject({
      fullName: 'Ibrahim Koroma',
      phoneNumber: '+23276123456',
      yearsExperience: 8,
      licenceNumber: 'SL-123456',
      status: 'SUBMITTED',
    });
    expect(seen.body.email).toBe(a.email);
    expect(seen.headers['cache-control']).toMatch(/no-store/);
    expect(
      (
        await hr
          .call('get', `/tenants/${c.tenantId}/applications?status=SUBMITTED&jobId=${open.id}`)
          .expect(200)
      ).body.applications,
    ).toHaveLength(1);

    await a.call('post', `/applicant/applications/${made.id}/withdraw`).expect(204);
    await a.call('post', `/applicant/applications/${made.id}/withdraw`).expect(409);
    expect(
      (await a.call('get', '/applicant/applications').expect(200)).body.applications[0],
    ).toMatchObject({ status: 'WITHDRAWN', canWithdraw: false });
    await hr
      .call('post', `/tenants/${c.tenantId}/applications/${made.id}/status`)
      .send({ status: 'SHORTLISTED' })
      .expect(409); // terminal
  }, 600_000);

  it('lists the roles a posting can recruit for (never the owner) and checks custom form answers', async () => {
    const c = await company('rc-form');
    const hr = await member(c.tenantId, 'hr_manager');
    const roles = (await hr.call('get', `/tenants/${c.tenantId}/jobs/roles`).expect(200)).body
      .roles as { key: string; name: string }[];
    expect(roles.map((r) => r.key)).toEqual(
      expect.arrayContaining(['driver', 'dispatcher', 'admin']),
    );
    expect(roles.map((r) => r.key)).not.toContain('owner');

    const formFields = [
      {
        id: 'badge',
        label: 'Do you hold a PSV badge?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No'],
      },
      { id: 'notes', label: 'Anything else?', type: 'textarea', required: false },
    ];
    await hr
      .call('post', `/tenants/${c.tenantId}/jobs`)
      .send(job({ formFields: [{ ...formFields[0], options: ['Only one'] }] }))
      .expect(400); // a choice needs two options
    const j = (
      await hr.call('post', `/tenants/${c.tenantId}/jobs`).send(job({ formFields })).expect(201)
    ).body as { id: string; formFields: unknown[] };
    expect(j.formFields).toHaveLength(2);
    await hr.call('post', `/tenants/${c.tenantId}/jobs/${j.id}/open`).expect(200);

    const a = await newClient(ctx.app, db, 'rc-form-a');
    const apply = (answers: Record<string, unknown>) =>
      a.call('post', '/applicant/applications').send({ ...application(c.tenantId, j.id), answers });
    await apply({}).expect(400); // the required question is unanswered
    await apply({ badge: 'Maybe' }).expect(400); // not one of the options
    await apply({ badge: 'Yes', stranger: 'x' }).expect(400); // not a question of this posting
    const made = (await apply({ badge: 'Yes', notes: 'Available at once' }).expect(201)).body as {
      id: string;
    };
    const seen = (
      await hr.call('get', `/tenants/${c.tenantId}/applications/${made.id}`).expect(200)
    ).body;
    expect(seen.formAnswers).toEqual([
      expect.objectContaining({ id: 'badge', value: 'Yes' }),
      expect.objectContaining({ id: 'notes', value: 'Available at once' }),
    ]);
  }, 600_000);

  it('moves applications through the pipeline, emails each decision, and hires atomically into a staff profile', async () => {
    const c = await company('rc-flow');
    const hr = await member(c.tenantId, 'hr_manager');
    const j = (await hr.call('post', `/tenants/${c.tenantId}/jobs`).send(job()).expect(201))
      .body as { id: string };
    await hr.call('post', `/tenants/${c.tenantId}/jobs/${j.id}/open`).expect(200);
    const a = await newClient(ctx.app, db, 'rc-flow-a');
    const made = (
      await a
        .call('post', '/applicant/applications')
        .send(application(c.tenantId, j.id))
        .expect(201)
    ).body as { id: string };
    const url = `/tenants/${c.tenantId}/applications/${made.id}`;
    const move = (status: string, note?: string) =>
      hr.call('post', `${url}/status`).send({ status, ...(note ? { note } : {}) });
    const details = {
      jobTitle: 'Coach driver',
      employmentType: 'FULL_TIME',
      startDate: '2026-11-01',
      reportingTo: 'Head of Operations',
      workLocation: 'Freetown depot',
    };
    const interview = {
      date: '2026-12-01',
      time: '10:30',
      mode: 'IN_PERSON',
      location: 'Head office, Siaka Stevens Street',
      contactPerson: 'Mariama',
      instructions: 'Bring your licence',
    };

    await move('INTERVIEW').expect(400); // interviews are arranged with the interview action
    await move('OFFERED').expect(400); // there is no offer step any more
    await move('HIRED').expect(400); // only through the hire action
    await hr.call('post', `${url}/interview`).send(interview).expect(409); // not shortlisted yet
    await hr
      .call('post', `${url}/hire`)
      .send({ staffNumber: 'EMP-1', ...details })
      .expect(409);
    await move('SHORTLISTED', 'Strong driving record').expect(200);
    await hr.call('post', `${url}/notes`).send({ note: 'Called referee: positive' }).expect(201);
    await hr.call('post', `${url}/notes`).send({ note: '' }).expect(400);

    // The invitation records the details and e-mails them to the applicant.
    await hr
      .call('post', `${url}/interview`)
      .send({ ...interview, time: '25:00' })
      .expect(400);
    const invited = await hr.call('post', `${url}/interview`).send(interview).expect(200);
    expect(invited.body.emailed).toBe(true);
    const inviteMail = ctx.mailer.sent.find(
      (m) => m.template === 'interview-invitation' && m.to === a.email,
    );
    expect(inviteMail?.data).toMatchObject({
      date: '2026-12-01',
      time: '10:30',
      location: 'Head office, Siaka Stevens Street',
      contactPerson: 'Mariama',
    });
    const after = (await hr.call('get', url).expect(200)).body;
    expect(after.status).toBe('INTERVIEW');
    expect(after.interview).toMatchObject({ date: '2026-12-01', location: interview.location });
    expect(after.allowedNext).toEqual(['HIRED', 'REJECTED']);

    // The staff number is taken: nothing changes (no half-hired applicant).
    await plat((tx) =>
      tx.staffProfile.create({
        data: {
          tenantId: c.tenantId,
          staffNumber: 'EMP-1',
          fullName: 'Existing Person',
          role: 'DRIVER',
        },
      }),
    );
    await hr
      .call('post', `${url}/hire`)
      .send({ staffNumber: 'EMP-1', ...details })
      .expect(409);
    expect((await hr.call('get', url).expect(200)).body).toMatchObject({
      status: 'INTERVIEW',
      staffId: null,
    });

    const hired = await hr
      .call('post', `${url}/hire`)
      .send({ staffNumber: 'EMP-2', ...details, notes: 'Probation of three months' })
      .expect(201);
    expect(hired.body.emailed).toBe(true);
    const emp = await plat((tx) =>
      tx.staffProfile.findUniqueOrThrow({ where: { id: hired.body.staffId } }),
    );
    expect(emp).toMatchObject({
      staffNumber: 'EMP-2',
      fullName: 'Ibrahim Koroma',
      role: 'DRIVER',
      userId: a.userId,
      phone: '+23276123456',
    });
    expect(emp.employment).toMatchObject({ jobTitle: 'Coach driver', roleKey: 'driver' });

    // They now work for the company in the posting's role, with a default password to change.
    const m = await plat((tx) =>
      tx.membership.findFirstOrThrow({
        where: { tenantId: c.tenantId, userId: a.userId },
        include: { role: true },
      }),
    );
    expect(m).toMatchObject({ status: 'ACTIVE' });
    expect(m.role.key).toBe('driver');
    const user = await plat((tx) => tx.user.findUniqueOrThrow({ where: { id: a.userId } }));
    expect(user.mustChangePassword).toBe(true);
    const hireMail = ctx.mailer.sent.find(
      (x) => x.template === 'application-hired' && x.to === a.email,
    );
    expect(hireMail?.data).toMatchObject({
      staffNumber: 'EMP-2',
      jobTitle: 'Coach driver',
      startDate: '2026-11-01',
      reportingTo: 'Head of Operations',
    });
    expect(hireMail?.data.password).toBeTruthy();

    const detail = (await hr.call('get', url).expect(200)).body;
    expect(detail).toMatchObject({
      status: 'HIRED',
      staffId: hired.body.staffId,
      allowedNext: [],
    });
    expect(
      detail.events.map(
        (e: { to: string | null; note: string | null }) => e.to ?? `note:${e.note}`,
      ),
    ).toEqual(['SUBMITTED', 'SHORTLISTED', 'note:Called referee: positive', 'INTERVIEW', 'HIRED']);
    await hr
      .call('post', `${url}/hire`)
      .send({ staffNumber: 'EMP-3', ...details })
      .expect(409); // only once
    await a.call('post', `/applicant/applications/${made.id}/withdraw`).expect(409);

    // Records are immutable at the database level.
    await expect(
      plat((tx) =>
        tx.applicationEvent.updateMany({
          where: { applicationId: made.id },
          data: { note: 'edited' },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      plat((tx) => tx.applicationEvent.deleteMany({ where: { applicationId: made.id } })),
    ).rejects.toThrow();
    await expect(
      plat((tx) => tx.jobApplication.deleteMany({ where: { id: made.id } })),
    ).rejects.toThrow();
    await expect(plat((tx) => tx.jobPosting.deleteMany({ where: { id: j.id } }))).rejects.toThrow();
  }, 600_000);

  it('lets HR reject at every open step and emails the applicant', async () => {
    const c = await company('rc-reject');
    const hr = await member(c.tenantId, 'hr_manager');
    const j = (await hr.call('post', `/tenants/${c.tenantId}/jobs`).send(job()).expect(201))
      .body as { id: string };
    await hr.call('post', `/tenants/${c.tenantId}/jobs/${j.id}/open`).expect(200);
    const interview = {
      date: '2026-12-01',
      time: '09:00',
      mode: 'PHONE',
      location: '+23276000000',
    };
    for (const step of ['SUBMITTED', 'SHORTLISTED', 'INTERVIEW'] as const) {
      const a = await newClient(ctx.app, db, `rc-reject-${step.toLowerCase()}`);
      const made = (
        await a
          .call('post', '/applicant/applications')
          .send(application(c.tenantId, j.id))
          .expect(201)
      ).body as { id: string };
      const url = `/tenants/${c.tenantId}/applications/${made.id}`;
      if (step !== 'SUBMITTED')
        await hr.call('post', `${url}/status`).send({ status: 'SHORTLISTED' }).expect(200);
      if (step === 'INTERVIEW')
        await hr.call('post', `${url}/interview`).send(interview).expect(200);
      const res = await hr
        .call('post', `${url}/status`)
        .send({ status: 'REJECTED', note: 'We found a closer match' })
        .expect(200);
      expect(res.body.emailed).toBe(true);
      const mail = ctx.mailer.sent.find(
        (m) => m.template === 'application-rejected' && m.to === a.email,
      );
      expect(mail?.data.message).toBe('We found a closer match');
      expect((await hr.call('get', url).expect(200)).body.status).toBe('REJECTED');
    }
  }, 600_000);

  it('emails HR about new applications and applicants about decisions, never leaking private notes', async () => {
    const c = await company('rc-mail');
    const hr = await member(c.tenantId, 'hr_manager');
    const j = (await hr.call('post', `/tenants/${c.tenantId}/jobs`).send(job()).expect(201))
      .body as { id: string };
    await hr.call('post', `/tenants/${c.tenantId}/jobs/${j.id}/open`).expect(200);
    const a = await newClient(ctx.app, db, 'rc-mail-a');
    const made = (
      await a
        .call('post', '/applicant/applications')
        .send(application(c.tenantId, j.id))
        .expect(201)
    ).body as { id: string };
    const url = `/tenants/${c.tenantId}/applications/${made.id}`;
    await hr
      .call('post', `${url}/notes`)
      .send({ note: 'Concerned about the licence class: secret HR view' })
      .expect(201);
    await hr.call('post', `${url}/status`).send({ status: 'SHORTLISTED' }).expect(200);
    await hr
      .call('post', `${url}/status`)
      .send({ status: 'REJECTED', note: 'Not enough experience' })
      .expect(200);

    const mailer = new CaptureMailer();
    const proc = new OutboxProcessor(
      db,
      new NotificationService(db, mailer, 'https://app.test').handlers(),
      { tenantId: c.tenantId, batchSize: 50 },
    );
    for (let i = 0; i < 4; i++) if ((await proc.runOnce()).claimed === 0) break;

    const toHr = mailer.sent.filter((m) => m.template === 'application-received');
    expect(toHr.map((m) => m.to).sort()).toEqual([c.ownerEmail, hr.email].sort());
    expect(toHr[0]!.data.link).toMatch(/^https:\/\/app\.test\/[a-z0-9-]+\/recruitment$/);
    const toApplicant = mailer.sent.filter((m) => m.template === 'application-update');
    expect(toApplicant.map((m) => m.data.status)).toEqual(['SHORTLISTED']); // the rejection is mailed by the action itself
    expect(toApplicant.every((m) => m.to === a.email)).toBe(true);
    const all = JSON.stringify(mailer.sent);
    expect(all).not.toContain('secret HR view');
    expect(all).not.toContain('Not enough experience');
    expect(all).not.toContain('SL-123456');
  }, 600_000);
});
