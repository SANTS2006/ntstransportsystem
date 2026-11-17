import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { Mailer } from '../notifications/mailer.js';

export interface InquiryInput {
  kind: 'CONTACT' | 'DEMO';
  name: string;
  email: string;
  phone?: string | undefined;
  company?: string | undefined;
  message?: string | undefined;
  details?: Record<string, string> | undefined;
}

const DETAIL_LABEL: Record<string, string> = {
  fleetSize: 'Fleet size',
  role: 'Role',
  preferredDate: 'Preferred date',
  preferredTime: 'Preferred time',
  topic: 'Interested in',
};

/** Messages and demo requests from the public website, for the platform administrators. */
export class InquiryService {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer | undefined,
    /** Where a notice of each new enquiry is e-mailed. */
    private readonly inbox: string | undefined,
  ) {}

  async create(input: InquiryInput): Promise<void> {
    await withDb(this.db, {}, (tx) =>
      tx.siteInquiry.createMany({
        data: [
          {
            kind: input.kind,
            name: input.name,
            email: input.email,
            phone: input.phone ?? null,
            company: input.company ?? null,
            message: input.message ?? null,
            details: input.details ?? {},
          },
        ],
      }),
    );
    if (!this.mailer || !this.inbox) return;
    const lines = [
      `${input.kind === 'DEMO' ? 'Demo request' : 'Message'} from the website`,
      '',
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      input.phone ? `Phone: ${input.phone}` : '',
      input.company ? `Company: ${input.company}` : '',
      ...Object.entries(input.details ?? {}).map(([k, v]) => `${DETAIL_LABEL[k] ?? k}: ${v}`),
      input.message ? `\n${input.message}` : '',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    try {
      await this.mailer.send({
        to: this.inbox,
        template: 'platform-message',
        data: {
          subject: `${input.kind === 'DEMO' ? 'Demo request' : 'New message'}: ${input.name}`,
          message: lines.join('\n'),
        },
      });
    } catch {
      // The enquiry is saved and shows in the platform area; a failed notice must not lose it.
    }
  }

  async list(status: 'NEW' | 'HANDLED' | undefined, page: { limit: number; offset: number }) {
    const rows = await withDb(this.db, { platform: true }, (tx) =>
      tx.siteInquiry.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: page.limit,
        skip: page.offset,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      email: r.email,
      phone: r.phone,
      company: r.company,
      message: r.message,
      details: r.details as Record<string, string>,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      handledAt: r.handledAt?.toISOString() ?? null,
    }));
  }

  async setHandled(actorUserId: string, id: string, handled: boolean, requestId?: string) {
    await withDb(this.db, { platform: true, userId: actorUserId }, async (tx) => {
      const res = await tx.siteInquiry.updateMany({
        where: { id },
        data: handled
          ? { status: 'HANDLED', handledBy: actorUserId, handledAt: new Date() }
          : { status: 'NEW', handledBy: null, handledAt: null },
      });
      if (res.count !== 1) throw AppError.notFound();
      await writeAudit(tx, {
        action: handled ? 'platform.inquiry_handled' : 'platform.inquiry_reopened',
        outcome: 'SUCCESS',
        actorUserId,
        targetType: 'inquiry',
        targetId: id,
        requestId,
      });
    });
  }
}
