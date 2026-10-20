import { randomBytes } from 'node:crypto';
import type { CookieOptions, RequestHandler, Response } from 'express';
import type { Env } from '../../config/env.js';
import { safeEqual } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors.js';
import type { AuthService } from './auth.service.js';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; sessionToken: string };
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function cookieBase(env: Pick<Env, 'NODE_ENV'>): CookieOptions {
  return { secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

export function setSessionCookies(res: Response, env: Pick<Env, 'NODE_ENV'>, token: string) {
  const maxAge = 30 * 24 * 3600_000;
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(env), httpOnly: true, maxAge });
  // Double-submit CSRF token: readable by the SPA, which echoes it in a header.
  res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    ...cookieBase(env),
    httpOnly: false,
    maxAge,
  });
}

export function clearSessionCookies(res: Response, env: Pick<Env, 'NODE_ENV'>) {
  res.clearCookie(SESSION_COOKIE, { ...cookieBase(env), httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...cookieBase(env), httpOnly: false });
}

/** Rejects unsafe cross-site requests whose Origin is not on the allowlist. */
export function originGuard(env: Pick<Env, 'CORS_ORIGINS'>): RequestHandler {
  return (req, _res, next) => {
    const origin = req.header('origin');
    if (!SAFE_METHODS.has(req.method) && origin && !env.CORS_ORIGINS.includes(origin)) {
      return next(AppError.forbidden('Cross-origin request rejected'));
    }
    next();
  };
}

/** Loads the session (if any) and enforces CSRF for unsafe methods on authenticated requests. */
export function sessionLoader(auth: AuthService, env: Pick<Env, 'NODE_ENV'>): RequestHandler {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) return next();
    const result = await auth.authenticate(token, {
      requestId: req.id,
      userAgent: req.header('user-agent'),
    });
    if (!result) {
      clearSessionCookies(res, env);
      return next();
    }
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header(CSRF_HEADER);
      const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
      if (!header || !cookie || !safeEqual(header, cookie)) {
        return next(AppError.forbidden('CSRF validation failed'));
      }
    }
    let effective = token;
    if (result.rotatedToken) {
      setSessionCookies(res, env, result.rotatedToken);
      effective = result.rotatedToken;
    }
    req.auth = { userId: result.userId, sessionToken: effective };
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(AppError.unauthenticated());
  next();
};
