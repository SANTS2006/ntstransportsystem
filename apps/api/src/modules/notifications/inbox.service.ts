import { withDb, type Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

const PAGE = 30;

/**
 * A user's in-app notifications. Rows are written by the notification handlers; this class only
 * reads them and marks them read. Reads run in platform scope because a person's inbox spans
 * companies, so every query is fixed to the caller's own user id.
 */
export class InboxService {
  constructor(private readonly db: Db) {}

  async list(userId: string, unreadOnly: boolean) {
    return withDb(this.db, { platform: true }, async (tx) => {
      const [unread, rows] = await Promise.all([
        tx.inboxNotification.count({ where: { userId, readAt: null } }),
        tx.inboxNotification.findMany({
          where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
          orderBy: { createdAt: 'desc' },
          take: PAGE,
        }),
      ]);
      return {
        unread,
        items: rows.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          link: n.link,
          createdAt: n.createdAt.toISOString(),
          read: n.readAt !== null,
        })),
      };
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return withDb(this.db, { platform: true }, (tx) =>
      tx.inboxNotification.count({ where: { userId, readAt: null } }),
    );
  }

  async markRead(userId: string, id: string): Promise<void> {
    await withDb(this.db, { platform: true }, async (tx) => {
      const own = await tx.inboxNotification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!own) throw AppError.notFound();
      await tx.inboxNotification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
    });
  }

  async markAllRead(userId: string): Promise<number> {
    const r = await withDb(this.db, { platform: true }, (tx) =>
      tx.inboxNotification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    return r.count;
  }
}
