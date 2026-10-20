import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Accept a well-formed inbound correlation ID, otherwise generate one. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  req.id = inbound && REQUEST_ID_RE.test(inbound) ? inbound : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound('Route not found'));
};

/** Uniform error envelope. Never leaks stack traces, SQL, or internal messages. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let status = 500;
    let code: string = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (err instanceof AppError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      status = 413;
      code = 'VALIDATION_ERROR';
      message = 'Request body too large';
    } else if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Malformed request body';
    }

    if (status >= 500) logger.error({ err, requestId: req.id }, 'unhandled request error');

    res.status(status).json({
      error: { code, message, requestId: req.id, ...(details !== undefined ? { details } : {}) },
    });
  };
}
