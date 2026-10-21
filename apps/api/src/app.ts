import cors from 'cors';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { AuthService } from './modules/authentication/auth.service.js';
import { authRouter } from './modules/authentication/auth.routes.js';
import {
  GoogleAuthService,
  GoogleIdTokenVerifier,
  type GoogleVerifier,
} from './modules/authentication/google.service.js';
import { crewRouter } from './modules/crew/crew.routes.js';
import { CrewService } from './modules/crew/crew.service.js';
import { MaintenanceService } from './modules/crew/maintenance.service.js';
import { bookingRouter } from './modules/booking/booking.routes.js';
import { BookingService } from './modules/booking/booking.service.js';
import { CalendarService } from './modules/catalog/calendar.service.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { DispatchService } from './modules/catalog/dispatch.service.js';
import { dispatchRouter } from './modules/catalog/dispatch.routes.js';
import { SeatLayoutService } from './modules/catalog/seatlayout.service.js';
import { CatalogService } from './modules/catalog/catalog.service.js';
import { FleetService } from './modules/catalog/fleet.service.js';
import { ScheduleService } from './modules/catalog/schedule.service.js';
import { MembershipService } from './modules/tenants/membership.service.js';
import { platformRouter } from './modules/tenants/platform.routes.js';
import { RoleService } from './modules/tenants/role.service.js';
import { TenantService } from './modules/tenants/tenant.service.js';
import { tenantRouter } from './modules/tenants/tenant.routes.js';
import { MfaService } from './modules/authentication/mfa.service.js';
import { originGuard, sessionLoader } from './modules/authentication/session.middleware.js';
import { SecretBox } from './platform/secretbox.js';
import type { Mailer } from './modules/notifications/mailer.js';
import type { Db } from './platform/db.js';
import type { RateLimitStoreFactory } from './platform/redis.js';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes.js';
import { errorHandler, notFoundHandler, requestId } from './platform/http.js';
import { mountApiDocs } from './openapi/docs.js';
import { Router, routesOf, type RouteInfo } from './platform/router.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  readinessChecks?: ReadinessCheck[];
  db?: Db;
  mailer?: Mailer;
  /** Override for tests; otherwise built from GOOGLE_CLIENT_ID. */
  googleVerifier?: GoogleVerifier;
  /** Shared (Redis) rate-limit counters; in-memory counters are used when omitted. */
  rateLimitStores?: RateLimitStoreFactory;
}

export function createApp({
  env,
  logger,
  readinessChecks = [],
  db,
  mailer,
  googleVerifier,
  rateLimitStores,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      customProps: (req) => ({ requestId: (req as express.Request).id }),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const health = healthRouter(readinessChecks);
  app.use('/health', health);

  const v1 = Router();
  v1.use(originGuard(env));
  if (db && mailer) {
    const box = env.MFA_ENCRYPTION_KEY ? new SecretBox(env.MFA_ENCRYPTION_KEY) : undefined;
    const mfa = box ? new MfaService(db, box, 'NTS Transport') : undefined;
    const auth = new AuthService(db, mailer, env.APP_URL, mfa);
    const verifier =
      googleVerifier ??
      (env.GOOGLE_CLIENT_ID ? new GoogleIdTokenVerifier(env.GOOGLE_CLIENT_ID) : undefined);
    const google = verifier ? new GoogleAuthService(db, auth, verifier) : undefined;
    v1.use(sessionLoader(auth, env));
    // Credentials, codes and recovery codes pass through here: never cache.
    v1.use('/auth', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });
    v1.use('/auth', authRouter({ auth, db, env, mfa, google, rateLimitStores }));

    const tenants = new TenantService(db);
    const members = new MembershipService(db, mailer, env.APP_URL);
    v1.use(tenantRouter({ db, tenants, members, roles: new RoleService(db) }));
    v1.use('/platform', platformRouter(db, tenants));
    v1.use(
      catalogRouter({
        db,
        catalog: new CatalogService(db),
        fleet: new FleetService(db),
        schedules: new ScheduleService(db),
      }),
    );
    v1.use(
      dispatchRouter({
        db,
        calendar: new CalendarService(db),
        layouts: new SeatLayoutService(db),
        dispatch: new DispatchService(db),
      }),
    );
    v1.use(bookingRouter({ db, bookings: new BookingService(db) }));
    v1.use(crewRouter({ db, crew: new CrewService(db), maintenance: new MaintenanceService(db) }));
  }
  // Further feature modules are mounted here phase by phase.
  if (env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production') mountApiDocs(app, v1);
  app.use('/api/v1', v1);
  // Every registered route with its full path: the API documentation is generated from, and
  // tested against, this table so the two cannot drift apart.
  app.locals.routeTable = [
    ...routesOf(health).map((r) => ({ ...r, path: `/health${r.path}` })),
    ...routesOf(v1).map((r) => ({ ...r, path: `/api/v1${r.path}` })),
  ] satisfies RouteInfo[];

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
