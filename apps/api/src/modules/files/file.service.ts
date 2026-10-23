import { createHash, randomUUID } from 'node:crypto';
import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { MAX_UPLOAD_BYTES, detectFileType, safeFilename } from '../../platform/file-types.js';
import type { FileStorage } from '../../platform/storage.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export const MAX_ATTACHMENTS_PER_COMPLAINT = 3;
export const LINK_TTL_SECONDS = 300;

type Kind = 'APPLICATION_CV' | 'COMPLAINT_ATTACHMENT';
export type Actor = { kind: 'passenger'; userId: string } | { kind: 'staff'; scope: TenantScope };

export interface FileDto {
  id: string;
  displayName: string;
  contentType: string;
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
  sizeBytes: f.sizeBytes,
  createdAt: f.createdAt.toISOString(),
});

const unsupported = () =>
  new AppError(415, 'VALIDATION_ERROR', 'Only PDF, PNG and JPEG files are accepted');

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
    bytes: Buffer;
    rawName: string | undefined;
    fallbackName: string;
    /** Runs inside the same transaction, before the row is inserted (limits, retiring an old file). */
    prepare: (tx: Tx) => Promise<string[]>;
    auditAction: string;
    requestId: string | undefined;
  }): Promise<FileDto> {
    const { bytes } = args;
    if (bytes.length === 0) throw AppError.validation('The file is empty');
    if (bytes.length > MAX_UPLOAD_BYTES)
      throw new AppError(413, 'VALIDATION_ERROR', 'The file is larger than 5 MB');
    const type = detectFileType(bytes);
    if (!type) throw unsupported();

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

  private async link(f: {
    objectKey: string;
    displayName: string;
    contentType: string;
    sizeBytes: number;
  }) {
    const url = await this.storage.signedGetUrl(f.objectKey, {
      expiresSec: LINK_TTL_SECONDS,
      filename: f.displayName,
      contentType: f.contentType,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(),
      filename: f.displayName,
      contentType: f.contentType,
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

  async attachmentLink(actor: Actor, complaintId: string, fileId: string) {
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
    return this.link(f);
  }
}
