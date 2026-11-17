import { createHash, randomUUID } from 'node:crypto';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import {
  MAX_UPLOAD_BYTES,
  detectFileType,
  maxBytesFor,
  mediaOf,
  safeFilename,
  type DetectedFile,
  type MediaClass,
} from '../../platform/file-types.js';
import type { FileStorage } from '../../platform/storage.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export const MAX_ATTACHMENTS_PER_COMPLAINT = 4;
export const LINK_TTL_SECONDS = 300;

type Kind =
  | 'APPLICATION_CV'
  | 'COMPLAINT_ATTACHMENT'
  | 'APPLICATION_LICENCE'
  | 'APPLICATION_PHOTO'
  | 'APPLICATION_FORM_FILE';

/** One of an application's uploads: its licence photo, its picture, or a file a form question asks for. */
export type ApplicantSlot =
  | { kind: 'APPLICATION_LICENCE' | 'APPLICATION_PHOTO' }
  | { kind: 'APPLICATION_FORM_FILE'; fieldKey: string };
export type Actor = { kind: 'passenger'; userId: string } | { kind: 'staff'; scope: TenantScope };

export interface FileDto {
  id: string;
  displayName: string;
  contentType: string;
  /** document, image, audio or video: tells the app how to show it. */
  media: MediaClass;
  sizeBytes: number;
  createdAt: string;
}
const dto = (f: {
  id: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}): FileDto => ({
  id: f.id,
  displayName: f.displayName,
  contentType: f.contentType,
  media: mediaOf(f.contentType),
  sizeBytes: f.sizeBytes,
  createdAt: f.createdAt.toISOString(),
});

const unsupported = (what = 'a PDF, an image (PNG, JPEG, WebP), audio or video') =>
  new AppError(415, 'VALIDATION_ERROR', `Only ${what} can be uploaded`);

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/**
 * Uploaded documents. The bytes go to object storage under an unguessable key built from ids; the
 * database row records who may see them (company, owner) and is the only way to get a download
 * link. Content is identified by its signature, never by the name or Content-Type the client sent.
 */
export class FileService {
  constructor(
    private readonly db: Db,
    private readonly storage: FileStorage,
  ) {}

  // ---- Shared pipeline ---------------------------------------------------------------------------

  private async store(args: {
    tenantId: string;
    userId: string;
    kind: Kind;
    ownerId: string;
    fieldKey?: string | undefined;
    bytes: Buffer;
    rawName: string | undefined;
    /** The Content-Type the client sent: only used to tell audio from video. */
    declared?: string | undefined;
    /** Which kinds of file this upload may be (default: anything we store). */
    allow?: (t: DetectedFile) => boolean;
    allowMessage?: string;
    fallbackName: string;
    /** Runs inside the same transaction, before the row is inserted (limits, retiring an old file). */
    prepare: (tx: Tx) => Promise<string[]>;
    auditAction: string;
    requestId: string | undefined;
  }): Promise<FileDto> {
    const { bytes } = args;
    if (bytes.length === 0) throw AppError.validation('The file is empty');
    if (bytes.length > MAX_UPLOAD_BYTES)
      throw new AppError(
        413,
        'VALIDATION_ERROR',
        `The file is larger than ${mb(MAX_UPLOAD_BYTES)}`,
      );
    const type = detectFileType(bytes, args.declared);
    if (!type) throw unsupported();
    if (args.allow && !args.allow(type)) throw unsupported(args.allowMessage);
    if (bytes.length > maxBytesFor(type)) {
      throw new AppError(
        413,
        'VALIDATION_ERROR',
        `A ${type.media === 'document' ? 'document' : type.media} can be at most ${mb(maxBytesFor(type))}`,
      );
    }

    const key = `tenants/${args.tenantId}/${args.kind.toLowerCase()}/${args.ownerId}/${randomUUID()}.${type.ext}`;
    try {
      await this.storage.put(key, bytes, type.contentType);
    } catch {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'File storage is unavailable. Please try again.',
      );
    }
    let retired: string[] = [];
    try {
      const row = await mapDbErrors(
        () =>
          withDb(this.db, { tenantId: args.tenantId, userId: args.userId }, async (tx) => {
            retired = await args.prepare(tx);
            const f = await tx.storedFile.create({
              data: {
                tenantId: args.tenantId,
                kind: args.kind,
                ownerId: args.ownerId,
                fieldKey: args.fieldKey ?? null,
                objectKey: key,
                contentType: type.contentType,
                sizeBytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                displayName: safeFilename(args.rawName, args.fallbackName, type.ext),
                uploadedBy: args.userId,
              },
            });
            await writeAudit(tx, {
              action: args.auditAction,
              outcome: 'SUCCESS',
              tenantId: args.tenantId,
              actorUserId: args.userId,
              targetType: 'file',
              targetId: f.id,
              requestId: args.requestId,
              summary: { kind: args.kind, bytes: bytes.length },
            });
            return f;
          }),
        { unique: 'Another upload for this item was in progress. Please try again.' },
      );
      // The old files are no longer reachable through the database; remove the bytes too.
      for (const k of retired) await this.storage.delete(k).catch(() => undefined);
      return dto(row);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined); // never leave an orphan behind
      throw err;
    }
  }

  private async link(
    f: { objectKey: string; displayName: string; contentType: string; sizeBytes: number },
    inline = false,
  ) {
    // Only things a browser can show safely are ever delivered for viewing; documents always download.
    const show = inline && mediaOf(f.contentType) !== 'document';
    const url = await this.storage.signedGetUrl(f.objectKey, {
      expiresSec: LINK_TTL_SECONDS,
      filename: f.displayName,
      contentType: f.contentType,
      inline: show,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(),
      filename: f.displayName,
      contentType: f.contentType,
      media: mediaOf(f.contentType),
      sizeBytes: f.sizeBytes,
    };
  }

  // ---- CVs ---------------------------------------------------------------------------------------

  private async ownApplication(userId: string, applicationId: string) {
    const a = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobApplication.findFirst({
        where: { id: applicationId, userId },
        select: { id: true, tenantId: true, status: true },
      }),
    );
    if (!a) throw AppError.notFound(); // someone else's application looks like a missing one
    return a;
  }

  async uploadCv(
    userId: string,
    applicationId: string,
    bytes: Buffer,
    rawName: string | undefined,
    requestId?: string,
    declared?: string,
  ) {
    const a = await this.ownApplication(userId, applicationId);
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.status)) {
      throw AppError.conflict('This application is closed, so the CV can no longer be changed');
    }
    return this.store({
      tenantId: a.tenantId,
      userId,
      kind: 'APPLICATION_CV',
      ownerId: a.id,
      bytes,
      rawName,
      declared,
      allow: (t) => t.media === 'document' || t.media === 'image',
      allowMessage: 'a PDF or an image (PNG, JPEG, WebP)',
      fallbackName: 'cv',
      auditAction: 'file.cv_uploaded',
      requestId,
      prepare: async (tx) => {
        const old = await tx.storedFile.findMany({
          where: { tenantId: a.tenantId, kind: 'APPLICATION_CV', ownerId: a.id, deletedAt: null },
          select: { id: true, objectKey: true },
        });
        if (old.length) {
          await tx.storedFile.updateMany({
            where: { id: { in: old.map((o) => o.id) } },
            data: { deletedAt: new Date() },
          });
        }
        return old.map((o) => o.objectKey);
      },
    });
  }

  private async liveCv(tenantId: string, userId: string | undefined, applicationId: string) {
    const f = await withDb(this.db, userId ? { tenantId, userId } : { tenantId }, (tx) =>
      tx.storedFile.findFirst({
        where: { tenantId, kind: 'APPLICATION_CV', ownerId: applicationId, deletedAt: null },
      }),
    );
    if (!f) throw AppError.notFound('No CV has been uploaded');
    return f;
  }

  async cvLinkForApplicant(userId: string, applicationId: string) {
    const a = await this.ownApplication(userId, applicationId);
    return this.link(await this.liveCv(a.tenantId, userId, a.id));
  }

  /** HR opening an applicant's CV is access to personal data, so it is audited. */
  async cvLinkForStaff(s: TenantScope, applicationId: string, requestId?: string) {
    const app = await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, (tx) =>
      tx.jobApplication.findFirst({
        where: { id: applicationId, tenantId: s.tenantId },
        select: { id: true },
      }),
    );
    if (!app) throw AppError.notFound();
    const f = await this.liveCv(s.tenantId, s.userId, app.id);
    await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, (tx) =>
      writeAudit(tx, {
        action: 'file.cv_accessed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'file',
        targetId: f.id,
        requestId,
      }),
    );
    return this.link(f);
  }

  async cvInfo(tenantId: string, userId: string, applicationId: string): Promise<FileDto | null> {
    const f = await withDb(this.db, { tenantId, userId }, (tx) =>
      tx.storedFile.findFirst({
        where: { tenantId, kind: 'APPLICATION_CV', ownerId: applicationId, deletedAt: null },
      }),
    );
    return f ? dto(f) : null;
  }

  // ---- Licence photo, picture and custom form files ------------------------------------------------

  private slotWhere(tenantId: string, appId: string, slot: ApplicantSlot) {
    return {
      tenantId,
      kind: slot.kind,
      ownerId: appId,
      deletedAt: null,
      ...(slot.kind === 'APPLICATION_FORM_FILE' ? { fieldKey: slot.fieldKey } : {}),
    };
  }

  /** A form question that asks for a file must exist on the posting: nothing else is accepted. */
  private async assertFileField(tenantId: string, appId: string, fieldKey: string) {
    const job = await withDb(this.db, { platform: true }, (tx) =>
      tx.jobApplication.findFirst({
        where: { id: appId, tenantId },
        select: { job: { select: { formFields: true } } },
      }),
    );
    const fields = (job?.job.formFields ?? []) as { id?: string; type?: string }[];
    if (!Array.isArray(fields) || !fields.some((f) => f.id === fieldKey && f.type === 'file'))
      throw AppError.notFound();
  }

  async uploadApplicantFile(
    userId: string,
    applicationId: string,
    slot: ApplicantSlot,
    bytes: Buffer,
    rawName: string | undefined,
    requestId?: string,
    declared?: string,
  ) {
    const a = await this.ownApplication(userId, applicationId);
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.status)) {
      throw AppError.conflict('This application is closed, so its files can no longer be changed');
    }
    if (slot.kind === 'APPLICATION_FORM_FILE')
      await this.assertFileField(a.tenantId, a.id, slot.fieldKey);
    const photoOnly = slot.kind !== 'APPLICATION_FORM_FILE';
    return this.store({
      tenantId: a.tenantId,
      userId,
      kind: slot.kind,
      ownerId: a.id,
      fieldKey: slot.kind === 'APPLICATION_FORM_FILE' ? slot.fieldKey : undefined,
      bytes,
      rawName,
      declared,
      allow: (t) =>
        photoOnly ? t.media === 'image' : t.media === 'document' || t.media === 'image',
      allowMessage: photoOnly
        ? 'a picture (PNG, JPEG, WebP)'
        : 'a PDF or an image (PNG, JPEG, WebP)',
      fallbackName:
        slot.kind === 'APPLICATION_LICENCE'
          ? 'licence'
          : slot.kind === 'APPLICATION_PHOTO'
            ? 'photo'
            : 'file',
      auditAction: 'file.applicant_file_uploaded',
      requestId,
      prepare: async (tx) => {
        const old = await tx.storedFile.findMany({
          where: this.slotWhere(a.tenantId, a.id, slot),
          select: { id: true, objectKey: true },
        });
        if (old.length) {
          await tx.storedFile.updateMany({
            where: { id: { in: old.map((o) => o.id) } },
            data: { deletedAt: new Date() },
          });
        }
        return old.map((o) => o.objectKey);
      },
    });
  }

  private async liveSlot(
    tenantId: string,
    userId: string | undefined,
    appId: string,
    slot: ApplicantSlot,
  ) {
    const f = await withDb(this.db, userId ? { tenantId, userId } : { tenantId }, (tx) =>
      tx.storedFile.findFirst({ where: this.slotWhere(tenantId, appId, slot) }),
    );
    if (!f) throw AppError.notFound('Nothing has been uploaded');
    return f;
  }

  async applicantFileLinkForApplicant(
    userId: string,
    applicationId: string,
    slot: ApplicantSlot,
    inline = false,
  ) {
    const a = await this.ownApplication(userId, applicationId);
    return this.link(await this.liveSlot(a.tenantId, userId, a.id, slot), inline);
  }

  /** HR opening an applicant's licence photo, picture or form file is access to personal data: audited. */
  async applicantFileLinkForStaff(
    s: TenantScope,
    applicationId: string,
    slot: ApplicantSlot,
    inline = false,
    requestId?: string,
  ) {
    const app = await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, (tx) =>
      tx.jobApplication.findFirst({
        where: { id: applicationId, tenantId: s.tenantId },
        select: { id: true },
      }),
    );
    if (!app) throw AppError.notFound();
    const f = await this.liveSlot(s.tenantId, s.userId, app.id, slot);
    await withDb(this.db, { tenantId: s.tenantId, userId: s.userId }, (tx) =>
      writeAudit(tx, {
        action: 'file.applicant_file_accessed',
        outcome: 'SUCCESS',
        tenantId: s.tenantId,
        actorUserId: s.userId,
        targetType: 'file',
        targetId: f.id,
        requestId,
      }),
    );
    return this.link(f, inline);
  }

  // ---- Complaint attachments ---------------------------------------------------------------------

  /** Who may touch a complaint's files: its passenger, or support staff of the same company. */
  private async complaintFor(actor: Actor, complaintId: string) {
    if (actor.kind === 'passenger') {
      const c = await withDb(this.db, { platform: true }, (tx) =>
        tx.complaint.findFirst({
          where: { id: complaintId, userId: actor.userId },
          select: { id: true, tenantId: true, status: true },
        }),
      );
      if (!c) throw AppError.notFound();
      return { ...c, userId: actor.userId };
    }
    const c = await withDb(
      this.db,
      { tenantId: actor.scope.tenantId, userId: actor.scope.userId },
      (tx) =>
        tx.complaint.findFirst({
          where: { id: complaintId, tenantId: actor.scope.tenantId },
          select: { id: true, tenantId: true, status: true },
        }),
    );
    if (!c) throw AppError.notFound();
    return { ...c, userId: actor.scope.userId };
  }

  async uploadAttachment(
    actor: Actor,
    complaintId: string,
    bytes: Buffer,
    rawName: string | undefined,
    requestId?: string,
    declared?: string,
  ) {
    const c = await this.complaintFor(actor, complaintId);
    if (c.status === 'CLOSED') throw AppError.conflict('This complaint is closed');
    return this.store({
      tenantId: c.tenantId,
      userId: c.userId,
      kind: 'COMPLAINT_ATTACHMENT',
      ownerId: c.id,
      bytes,
      rawName,
      declared,
      fallbackName: 'attachment',
      auditAction: 'file.attachment_uploaded',
      requestId,
      prepare: async (tx) => {
        // Serialise uploads to one complaint so two at once cannot both pass the limit.
        await tx.$queryRaw`SELECT id FROM complaints WHERE id = ${c.id}::uuid AND tenant_id = ${c.tenantId}::uuid FOR UPDATE`;
        const n = await tx.storedFile.count({
          where: {
            tenantId: c.tenantId,
            kind: 'COMPLAINT_ATTACHMENT',
            ownerId: c.id,
            deletedAt: null,
          },
        });
        if (n >= MAX_ATTACHMENTS_PER_COMPLAINT) {
          throw AppError.conflict(
            `A complaint can have at most ${MAX_ATTACHMENTS_PER_COMPLAINT} attachments`,
          );
        }
        return [];
      },
    });
  }

  async listAttachments(actor: Actor, complaintId: string): Promise<FileDto[]> {
    const c = await this.complaintFor(actor, complaintId);
    const rows = await withDb(this.db, { tenantId: c.tenantId, userId: c.userId }, (tx) =>
      tx.storedFile.findMany({
        where: {
          tenantId: c.tenantId,
          kind: 'COMPLAINT_ATTACHMENT',
          ownerId: c.id,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(dto);
  }

  async attachmentLink(actor: Actor, complaintId: string, fileId: string, inline = false) {
    const c = await this.complaintFor(actor, complaintId);
    const f = await withDb(this.db, { tenantId: c.tenantId, userId: c.userId }, (tx) =>
      tx.storedFile.findFirst({
        where: {
          id: fileId,
          tenantId: c.tenantId,
          kind: 'COMPLAINT_ATTACHMENT',
          ownerId: c.id,
          deletedAt: null,
        },
      }),
    );
    if (!f) throw AppError.notFound();
    return this.link(f, inline);
  }
}
