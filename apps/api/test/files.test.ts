import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDb, type Db, type Tx } from '../src/platform/db.js';
import { MemoryStorage } from '../src/platform/storage.js';
import {
  createDb,
  createTenantWithOwner,
  loginClient,
  makeApp,
  newClient,
  TEST_DB_URL,
  type Client,
} from './helpers.js';

const PDF = (n = 1000) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n, 0x41)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);

describe.skipIf(!TEST_DB_URL)('file uploads (database, in-memory storage)', () => {
  let db: Db;
  let storage: MemoryStorage;
  let ctx: ReturnType<typeof makeApp>;

  beforeAll(() => {
    db = createDb(TEST_DB_URL as string);
    storage = new MemoryStorage();
    ctx = makeApp(db, { storage });
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
    return { tenantId: t.tenant.id, owner: await loginClient(ctx.app, db, t.email, t.password) };
  }
  const upload = (
    who: Client,
    path: string,
    body: Buffer,
    type = 'application/pdf',
    name?: string,
  ) => {
    const r = who.call('post', path).set('Content-Type', type);
    if (name) r.set('X-File-Name', encodeURIComponent(name));
    return r.send(body);
  };

  /** An open job with one application from `applicant`. */
  async function applicationSetup(label: string) {
    const c = await company(label);
    const hr = await member(c.tenantId, 'hr_manager');
    const job = (
      await hr
        .call('post', `/tenants/${c.tenantId}/jobs`)
        .send({
          title: 'Coach driver',
          jobRole: 'DRIVER',
          description: 'Drive our coaches on long routes. Experience needed.',
        })
        .expect(201)
    ).body as { id: string };
    await hr.call('post', `/tenants/${c.tenantId}/jobs/${job.id}/open`).expect(200);
    const applicant = await newClient(ctx.app, db, 'fl-applicant');
    const app = (
      await applicant
        .call('post', '/applicant/applications')
        .send({
          tenantId: c.tenantId,
          jobId: job.id,
          fullName: 'Sia Kamara',
          phone: '+23277111222',
          experience: 'Six years driving coaches across the country.',
        })
        .expect(201)
    ).body as { id: string };
    return { ...c, hr, applicant, appId: app.id };
  }

  it('reports whether uploads are available', async () => {
    expect((await request(ctx.app).get('/api/v1/features').expect(200)).body).toEqual({
      fileUploads: true,
    });
    const off = makeApp(db);
    expect((await request(off.app).get('/api/v1/features').expect(200)).body).toEqual({
      fileUploads: false,
    });
    const t = await company('fl-off');
    const c = await newClient(off.app, db, 'fl-off-user');
    await c
      .call('post', `/applicant/applications/${t.tenantId}/cv`)
      .set('Content-Type', 'application/pdf')
      .send(PDF())
      .expect(404); // not mounted
  }, 300_000);

  it('stores a CV by its real type, shows it only to the applicant and HR, and replaces it cleanly', async () => {
    const k = await applicationSetup('fl-cv');
    const url = `/applicant/applications/${k.appId}/cv`;
    const hrUrl = `/tenants/${k.tenantId}/applications/${k.appId}/cv`;

    // What is refused
    await upload(k.applicant, url, Buffer.alloc(0)).expect(400);
    await upload(k.applicant, url, Buffer.from('MZ\x90\x00 pretending to be a pdf')).expect(415); // wrong bytes
    await upload(k.applicant, url, Buffer.from('<svg onload=alert(1)></svg>'), 'image/png').expect(
      415,
    );
    await upload(k.applicant, url, PDF(), 'text/plain').expect(415); // type we do not take
    await upload(k.applicant, url, PDF(5 * 1024 * 1024 + 10)).expect(413); // over 5 MB
    await request(ctx.app)
      .post(`/api/v1${url}`)
      .set('Content-Type', 'application/pdf')
      .send(PDF())
      .expect(401);
    const other = await newClient(ctx.app, db, 'fl-other');
    await upload(other, url, PDF()).expect(404); // not their application
    expect(storage.objects.size).toBe(0); // nothing was stored by any of that

    // A good upload, with a hostile file name
    const first = await upload(
      k.applicant,
      url,
      PDF(),
      'application/pdf',
      '../../My "CV".exe',
    ).expect(201);
    expect(first.body).toMatchObject({
      displayName: 'My CV.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF().length,
    });
    const rows = await plat((tx) => tx.storedFile.findMany({ where: { ownerId: k.appId } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectKey).toMatch(
      new RegExp(`^tenants/${k.tenantId}/application_cv/${k.appId}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(rows[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.objects.get(rows[0]!.objectKey)!.contentType).toBe('application/pdf');

    // Links: the applicant and HR get short-lived ones; everyone else gets nothing.
    const mine = (await k.applicant.call('get', url).expect(200)).body;
    expect(mine.url).toContain(rows[0]!.objectKey);
    expect(mine.filename).toBe('My CV.pdf');
    const theirs = await k.hr.call('get', hrUrl).expect(200);
    expect(theirs.headers['cache-control']).toMatch(/no-store/);
    await other.call('get', url).expect(404);
    const agent = await member(k.tenantId, 'sales_agent');
    await agent.call('get', hrUrl).expect(403);
    const outsider = await company('fl-cv-outsider');
    await outsider.owner
      .call('get', `/tenants/${outsider.tenantId}/applications/${k.appId}/cv`)
      .expect(404);
    await outsider.owner.call('get', hrUrl.replace(k.tenantId, outsider.tenantId)).expect(404);
    const audits = await withDb(db, { tenantId: k.tenantId }, (tx) =>
      tx.auditLog.count({
        where: { tenantId: k.tenantId, action: 'file.cv_accessed', actorUserId: k.hr.userId },
      }),
    );
    expect(audits).toBe(1); // HR opening a CV is recorded

    // Replacing retires the old file everywhere.
    const oldKey = rows[0]!.objectKey;
    await upload(k.applicant, url, PNG, 'image/png', 'scan').expect(201);
    expect(storage.objects.has(oldKey)).toBe(false);
    const after = await plat((tx) =>
      tx.storedFile.findMany({ where: { ownerId: k.appId }, orderBy: { createdAt: 'asc' } }),
    );
    expect(after.map((r) => [r.contentType, r.deletedAt !== null])).toEqual([
      ['application/pdf', true],
      ['image/png', false],
    ]);
    expect((await k.applicant.call('get', url).expect(200)).body.contentType).toBe('image/png');

    // A storage outage leaves no half-finished state.
    storage.failNextPut = true;
    await upload(k.applicant, url, PDF()).expect(503);
    expect(
      await plat((tx) => tx.storedFile.count({ where: { ownerId: k.appId, deletedAt: null } })),
    ).toBe(1);

    // Closed applications cannot change their CV.
    await k.applicant.call('post', `/applicant/applications/${k.appId}/withdraw`).expect(204);
    await upload(k.applicant, url, PDF()).expect(409);
  }, 600_000);

  /** A paid booking owned by a passenger who has opened a complaint about it. */
  async function complaintSetup(label: string) {
    const c = await company(label);
    const pax = await newClient(ctx.app, db, 'fl-pax');
    const trip = await plat(async (tx) => {
      const locs = await tx.location.createManyAndReturn({
        data: ['A', 'B'].map((n) => ({
          tenantId: c.tenantId,
          name: `${n}-${Date.now()}`,
          city: n,
        })),
      });
      const route = await tx.route.create({
        data: {
          tenantId: c.tenantId,
          name: `R-${Date.now()}`,
          originId: locs[0]!.id,
          destinationId: locs[1]!.id,
          distanceM: 1000,
          durationMin: 60,
          status: 'PUBLISHED',
        },
      });
      await tx.fare.create({
        data: { tenantId: c.tenantId, routeId: route.id, amountMinor: 10_000 },
      });
      const v = await tx.vehicle.create({
        data: {
          tenantId: c.tenantId,
          registration: `FL-${Date.now()}`.toUpperCase(),
          seatingCapacity: 8,
          type: 'BUS',
        },
      });
      const dep = new Date(Date.now() + 86_400_000);
      return tx.trip.create({
        data: {
          tenantId: c.tenantId,
          routeId: route.id,
          serviceDate: new Date(dep.toISOString().slice(0, 10)),
          departureAt: dep,
          arrivalAt: new Date(dep.getTime() + 3_600_000),
          vehicleId: v.id,
        },
      });
    });
    const booking = (
      await c.owner
        .call('post', `/tenants/${c.tenantId}/bookings`)
        .send({
          tripId: trip.id,
          contact: { name: 'Fanta C', phone: '+23277000333' },
          passengers: [{ fullName: 'Fanta C', seatLabel: '1' }],
        })
        .expect(201)
    ).body as { id: string };
    await plat((tx) =>
      tx.booking.update({ where: { id: booking.id }, data: { createdByUserId: pax.userId } }),
    );
    const { BookingService } = await import('../src/modules/booking/booking.service.js');
    await new BookingService(db).markPaid(c.tenantId, booking.id);
    const complaint = (
      await pax
        .call('post', '/passenger/complaints')
        .send({
          bookingId: booking.id,
          category: 'DELAY',
          subject: 'Late departure',
          body: 'We left an hour late.',
        })
        .expect(201)
    ).body as { id: string };
    const mine = `/passenger/complaints/${complaint.id}/attachments`;
    const staff = `/tenants/${c.tenantId}/complaints/${complaint.id}/attachments`;

    return { c, pax, complaint, mine, staff };
  }

  it('caps complaint attachments at four, even when uploaded at the same moment', async () => {
    const { c, pax, complaint, mine, staff } = await complaintSetup('fl-att');

    const burst = await Promise.all(
      Array.from({ length: 6 }, () => upload(pax, mine, PNG, 'image/png', 'photo')),
    );
    expect(burst.filter((r) => r.status === 201)).toHaveLength(4);
    expect(burst.filter((r) => r.status === 409)).toHaveLength(2);
    const live = await plat((tx) =>
      tx.storedFile.findMany({ where: { ownerId: complaint.id, deletedAt: null } }),
    );
    expect(live).toHaveLength(4);
    // The refused uploads left no orphaned objects behind.
    expect([...storage.objects.keys()].filter((key) => key.includes(complaint.id))).toHaveLength(4);

    await upload(c.owner, staff, JPG, 'image/jpeg').expect(409); // staff share the same limit
    const list = (await pax.call('get', mine).expect(200)).body.files;
    expect(list).toHaveLength(4);
    expect(list[0]).toMatchObject({ contentType: 'image/png', displayName: 'photo.png' });

    // Who can see them
    const link = (await pax.call('get', `${mine}/${list[0].id}/link`).expect(200)).body;
    expect(link.url).toContain(live[0]!.objectKey.split('/')[0]);
    expect((await c.owner.call('get', staff).expect(200)).body.files).toHaveLength(4);
    await c.owner.call('get', `${staff}/${list[0].id}/link`).expect(200);
    const other = await newClient(ctx.app, db, 'fl-pax-other');
    await other.call('get', mine).expect(404);
    await other.call('get', `${mine}/${list[0].id}/link`).expect(404);
    await upload(other, mine, PNG, 'image/png').expect(404);
    const agent = await member(c.tenantId, 'sales_agent');
    await agent.call('get', staff).expect(403);
    const outsider = await company('fl-att-outsider');
    await outsider.owner.call('get', staff.replace(c.tenantId, outsider.tenantId)).expect(404);
    await pax.call('get', `${mine}/00000000-0000-4000-8000-000000000000/link`).expect(404);

    // A closed complaint takes no more files.
    await c.owner
      .call('post', `/tenants/${c.tenantId}/complaints/${complaint.id}/status`)
      .send({ status: 'CLOSED' })
      .expect(204);
    await upload(pax, mine, PNG, 'image/png').expect(409);
  }, 600_000);

  it('takes photos, voice messages and video, shows media only when it may, and refuses the wrong things', async () => {
    const { pax, complaint, mine, staff, c } = await complaintSetup('fl-media');
    const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 7)]);
    const MP4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from('ftypisom'),
      Buffer.alloc(300, 3),
    ]);
    const WEBP = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([9, 9, 9, 9]),
      Buffer.from('WEBP'),
      Buffer.alloc(100, 1),
    ]);

    // A voice message (audio in a WebM container), a photo and a video.
    const voice = await upload(pax, mine, WEBM, 'audio/webm;codecs=opus', 'voice message').expect(
      201,
    );
    expect(voice.body).toMatchObject({
      media: 'audio',
      contentType: 'audio/webm',
      displayName: 'voice message.webm',
    });
    const photo = await upload(pax, mine, WEBP, 'image/webp', 'seat').expect(201);
    expect(photo.body).toMatchObject({ media: 'image', contentType: 'image/webp' });
    const video = await upload(pax, mine, MP4, 'video/mp4', 'clip').expect(201);
    expect(video.body).toMatchObject({ media: 'video', contentType: 'video/mp4' });

    // The same bytes declared as video are a video, not a voice message: the declared type only
    // chooses between the two readings of a container.
    const asVideo = await upload(c.owner, staff, WEBM, 'video/webm', 'screen').expect(201);
    expect(asVideo.body).toMatchObject({ media: 'video', contentType: 'video/webm' });

    // Wrong things stay out, whatever they claim to be.
    await upload(pax, mine, Buffer.from('<script>alert(1)</script>'), 'audio/webm').expect(415);
    await upload(pax, mine, Buffer.from('MZ\x90\x00 program'), 'video/mp4').expect(415);
    await upload(pax, mine, Buffer.from('GIF89a......'), 'image/gif').expect(415);

    // Size limits depend on what it is: audio 10 MB, video 25 MB, everything else 5 MB.
    await upload(
      pax,
      mine,
      Buffer.concat([WEBM, Buffer.alloc(10 * 1024 * 1024)]),
      'audio/webm',
    ).expect(413);
    await upload(
      pax,
      mine,
      Buffer.concat([WEBP, Buffer.alloc(5 * 1024 * 1024)]),
      'image/webp',
    ).expect(413);
    await upload(
      pax,
      mine,
      Buffer.concat([MP4, Buffer.alloc(26 * 1024 * 1024)]),
      'video/mp4',
    ).expect(413);

    // Links: media can be shown inline; documents never are.
    const inlineLink = (await pax.call('get', `${mine}/${voice.body.id}/link?inline=1`).expect(200))
      .body;
    expect(inlineLink.url).toContain('inline=1');
    expect(inlineLink.media).toBe('audio');
    const plainLink = (await pax.call('get', `${mine}/${voice.body.id}/link`).expect(200)).body;
    expect(plainLink.url).not.toContain('inline=1');

    // Staff can open the same recording.
    const staffList = (await c.owner.call('get', staff).expect(200)).body.files as {
      media: string;
    }[];
    expect(staffList.map((f) => f.media).sort()).toEqual(['audio', 'image', 'video', 'video']);
    await c.owner.call('get', `${staff}/${voice.body.id}/link?inline=1`).expect(200);

    // A CV is a document or a picture, never a recording.
    const k = await applicationSetup('fl-cv-media');
    await upload(k.applicant, `/applicant/applications/${k.appId}/cv`, WEBM, 'audio/webm').expect(
      415,
    );
    await upload(k.applicant, `/applicant/applications/${k.appId}/cv`, MP4, 'video/mp4').expect(
      415,
    );
    await upload(k.applicant, `/applicant/applications/${k.appId}/cv`, WEBP, 'image/webp').expect(
      201,
    );
    expect(complaint.id).toBeTruthy();
  }, 600_000);

  it('lets a passenger report a problem with a voice message instead of typing', async () => {
    const { pax, complaint } = await complaintSetup('fl-voice');
    // complaintSetup typed a description; here a second passenger-side complaint is voice-only.
    const booking = await plat((tx) =>
      tx.complaint.findFirstOrThrow({ where: { id: complaint.id } }),
    );
    const another = await pax
      .call('post', '/passenger/complaints')
      .send({
        bookingId: booking.bookingId,
        category: 'OTHER',
        subject: 'Driver was rude',
        voice: true,
      })
      .expect(201);
    const messages = await plat((tx) =>
      tx.complaintMessage.findMany({ where: { complaintId: another.body.id } }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain('Voice message');
    // Neither text nor voice: refused.
    await pax
      .call('post', '/passenger/complaints')
      .send({ bookingId: booking.bookingId, category: 'OTHER', subject: 'Nothing said' })
      .expect(400);
    await pax
      .call('post', '/passenger/complaints')
      .send({ bookingId: booking.bookingId, category: 'OTHER', subject: 'Too short', body: 'no' })
      .expect(400);
  }, 600_000);

  it('keeps the file index immutable and well-formed at the database level', async () => {
    const k = await applicationSetup('fl-db');
    await upload(k.applicant, `/applicant/applications/${k.appId}/cv`, PDF()).expect(201);
    const row = await plat((tx) => tx.storedFile.findFirstOrThrow({ where: { ownerId: k.appId } }));
    await expect(
      plat((tx) => tx.storedFile.deleteMany({ where: { id: row.id } })),
    ).rejects.toThrow(); // never removed
    const base = {
      tenantId: k.tenantId,
      kind: 'COMPLAINT_ATTACHMENT' as const,
      ownerId: k.appId,
      uploadedBy: k.applicant.userId,
      displayName: 'x.pdf',
    };
    const bad = (over: Record<string, unknown>) =>
      plat((tx) =>
        tx.storedFile.create({
          data: {
            ...base,
            objectKey: `k/${Math.random()}`,
            contentType: 'application/pdf',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
            ...over,
          },
        }),
      );
    await expect(bad({ sizeBytes: 0 })).rejects.toThrow();
    await expect(bad({ sizeBytes: 6 * 1024 * 1024 })).rejects.toThrow();
    await expect(bad({ contentType: 'audio/webm', sizeBytes: 11 * 1024 * 1024 })).rejects.toThrow();
    await expect(bad({ contentType: 'video/mp4', sizeBytes: 26 * 1024 * 1024 })).rejects.toThrow();
    await expect(bad({ contentType: 'image/gif' })).rejects.toThrow();
    await expect(bad({ contentType: 'text/html' })).rejects.toThrow();
    await expect(bad({ sha256: 'not-a-hash' })).rejects.toThrow();
    // Only one live CV per application, whatever the application code does.
    await expect(bad({ kind: 'APPLICATION_CV' })).rejects.toThrow();
    // Another company's context sees none of it.
    const other = await company('fl-db-other');
    expect(await withDb(db, { tenantId: other.tenantId }, (tx) => tx.storedFile.count())).toBe(0);
  }, 600_000);
});
