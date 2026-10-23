import { toJSONSchema } from 'zod';
import type { RouteInfo } from '../platform/router.js';
import { operations as defaultOperations, type Operation } from './operations.js';

type Json = Record<string, unknown>;

const STATUS_TEXT: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  202: 'Accepted (the same response is returned whether or not the account exists)',
  204: 'Success, no content',
};
const UNSAFE = new Set(['post', 'put', 'patch', 'delete']);
const toBraces = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const UUID_PARAMS = new Set(['tenantId', 'id', 'employeeId']);

const errorResponse = (description: string): Json => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

function schemaFor(zod: Operation['body']): Json {
  if (!zod) return {};
  const json = toJSONSchema(zod, { unrepresentable: 'any', io: 'input' }) as Json;
  delete json.$schema;
  return json;
}

function parametersFor(path: string, op: Operation): Json[] {
  const params: Json[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string', ...(UUID_PARAMS.has(m[1]!) ? { format: 'uuid' } : {}) },
  }));
  if (op.paged) {
    params.push(
      {
        name: 'limit',
        in: 'query',
        description: 'Page size (1-100, default 25)',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
      {
        name: 'offset',
        in: 'query',
        description: 'Rows to skip',
        schema: { type: 'integer', minimum: 0, default: 0 },
      },
    );
  }
  for (const q of op.query ?? []) {
    params.push({
      name: q.name,
      in: 'query',
      description: q.description,
      schema: {
        type: 'string',
        ...(q.enum ? { enum: [...q.enum] } : {}),
        ...(q.format ? { format: q.format } : {}),
      },
    });
  }
  return params;
}

function responsesFor(method: string, path: string, op: Operation): Json {
  const ok: Json = { description: op.okDescription ?? STATUS_TEXT[op.ok] ?? 'Success' };
  if (op.ok !== 204)
    ok.content = { 'application/json': { schema: { type: 'object', additionalProperties: true } } };
  const responses: Json = { [String(op.ok)]: ok };
  if (op.body || op.query || op.paged)
    responses['400'] = errorResponse('Validation failed. `error.details` lists each problem.');
  if (op.access !== 'public')
    responses['401'] = errorResponse('Not signed in, or the session expired.');
  if (op.permission)
    responses['403'] = errorResponse(
      'Signed in but not permitted (missing permission, failed safety rule, CSRF token missing or invalid, or MFA required for platform access).',
    );
  if (/\{\w+\}/.test(path) || op.access === 'tenant' || op.access === 'platform') {
    responses['404'] = errorResponse(
      op.access === 'tenant'
        ? 'Not found. A company you are not a member of is indistinguishable from one that does not exist.'
        : 'Not found.',
    );
  }
  if (UNSAFE.has(method) && op.access !== 'public')
    responses['409'] = errorResponse(
      'Conflicts with the current state or a safety rule (duplicate, illegal transition, overlap, in use, …).',
    );
  if (method === 'post' && op.access === 'public' && path.startsWith('/api/v1/auth'))
    responses['429'] = errorResponse('Rate limited. Retry later.');
  return responses;
}

const operationId = (method: string, path: string) =>
  method +
  path
    .replace(/^\/api\/v1/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[{}]/g, ''))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

/**
 * Builds the OpenAPI 3.1 document from the live route table and the operation metadata.
 * Throws if a route is undocumented or a documented operation has no route.
 */
export function buildOpenApi(
  routeTable: RouteInfo[],
  ops: Record<string, Operation> = defaultOperations,
): Json {
  const missing: string[] = [];
  const seen = new Set<string>();
  const paths: Record<string, Json> = {};

  for (const r of routeTable) {
    const fullPath = toBraces(r.path);
    const key = `${r.method.toUpperCase()} ${fullPath}`;
    seen.add(key);
    const op = ops[key];
    if (!op) {
      missing.push(key);
      continue;
    }
    const isHealth = fullPath.startsWith('/health');
    const relPath = isHealth ? fullPath : fullPath.replace(/^\/api\/v1/, '') || '/';
    const item = (paths[relPath] ??= isHealth ? { servers: [{ url: '/' }] } : {});
    const security =
      op.access === 'public'
        ? []
        : [UNSAFE.has(r.method) ? { sessionCookie: [], csrfToken: [] } : { sessionCookie: [] }];
    item[r.method] = {
      operationId: operationId(r.method, fullPath),
      tags: [op.tag],
      summary: op.summary,
      description:
        [op.description, op.permission ? `Requires permission: \`${op.permission}\`.` : undefined]
          .filter(Boolean)
          .join('\n\n') || undefined,
      parameters: parametersFor(fullPath, op),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schemaFor(op.body) } },
            },
          }
        : {}),
      responses: responsesFor(r.method, fullPath.replace(/\{/g, '{'), op),
      security,
      'x-access': op.access,
      ...(op.permission ? { 'x-required-permission': op.permission } : {}),
    };
  }

  const extra = Object.keys(ops).filter((k) => !seen.has(k) && !ops[k]?.optional);
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      [
        missing.length ? `Routes without documentation:\n  ${missing.sort().join('\n  ')}` : '',
        extra.length
          ? `Documented operations without a route:\n  ${extra.sort().join('\n  ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'NTS Transport Platform API',
      version: '1.0.0',
      description: [
        'Multi-tenant transportation, fleet, ticketing and operations platform.',
        '',
        '**Authentication.** Browser sessions use an HttpOnly `sid` cookie. For state-changing requests (POST, PUT, PATCH, DELETE) echo the readable `csrf` cookie in the `x-csrf-token` header. Cross-origin unsafe requests from origins outside the allowlist are rejected.',
        '',
        "**Tenancy.** Company routes live under `/tenants/{tenantId}`. The ID only selects a company; access comes from the caller's own active membership. A company you do not belong to returns 404, identical to one that does not exist.",
        '',
        '**Errors.** Every error uses the same envelope (`error.code`, `error.message`, `error.requestId`, optional `error.details`). Quote `requestId` to support.',
        '',
        '**Pagination.** List endpoints accept `limit` (1-100, default 25) and `offset`.',
        '',
        '**Not yet available.** Idempotency keys for sensitive creates (arrive with bookings/payments), webhooks, and OAuth for third parties.',
      ].join('\n'),
    },
    servers: [{ url: '/api/v1', description: 'This server' }],
    tags: [
      'Auth',
      'Companies',
      'Team and roles',
      'Platform',
      'Catalog',
      'Fleet',
      'Maintenance',
      'Trips',
      'Crew and HR',
      'System',
    ].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'sid',
          description: 'HttpOnly session cookie set by sign-in.',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'x-csrf-token',
          description: 'Value of the `csrf` cookie; required with the session on unsafe methods.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId'],
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'VALIDATION_ERROR',
                    'UNAUTHENTICATED',
                    'FORBIDDEN',
                    'NOT_FOUND',
                    'CONFLICT',
                    'RATE_LIMITED',
                    'SERVICE_UNAVAILABLE',
                    'PAYMENT_PROVIDER_ERROR',
                    'MAINTENANCE',
                    'PHONE_NOT_VERIFIED',
                    'EMAIL_NOT_VERIFIED',
                    'INTERNAL_ERROR',
                  ],
                },
                message: { type: 'string' },
                requestId: { type: 'string' },
                details: { description: 'Present on validation errors.' },
              },
            },
          },
        },
      },
    },
  };
}
