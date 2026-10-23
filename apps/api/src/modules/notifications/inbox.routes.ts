import type { Request, Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { Router } from '../../platform/router.js';
import { requireAuth } from '../authentication/session.middleware.js';
import type { InboxService } from './inbox.service.js';

const listQuery = z.object({ unread: z.enum(['0', '1']).optional() });

/** The signed-in user's own in-app notifications. */
export function inboxRouter({ inbox }: { inbox: InboxService }): ExpressRouter {
  const r = Router();
  const userId = (req: Request) => {
    if (!req.auth) throw AppError.unauthenticated();
    return req.auth.userId;
  };
  r.get('/me/notifications', requireAuth, async (req, res) => {
    const q = listQuery.parse(req.query);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await inbox.list(userId(req), q.unread === '1'));
  });
  r.get('/me/notifications/unread-count', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ unread: await inbox.unreadCount(userId(req)) });
  });
  r.post('/me/notifications/read-all', requireAuth, async (req, res) => {
    res.json({ marked: await inbox.markAllRead(userId(req)) });
  });
  r.post('/me/notifications/:id/read', requireAuth, async (req, res) => {
    await inbox.markRead(userId(req), z.uuid().parse(req.params.id));
    res.status(204).end();
  });
  return r;
}
