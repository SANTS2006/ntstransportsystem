import express, { type Router as ExpressRouter, type RouterOptions } from 'express';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export interface RouteInfo {
  method: HttpMethod;
  /** Full path pattern relative to the router's own mount point, Express style (`:id`). */
  path: string;
}

const METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];
const TRACKED = Symbol('trackedRoutes');
type Tracked = ExpressRouter & { [TRACKED]?: RouteInfo[] };
type Loose = Record<string, (...args: unknown[]) => unknown>;

/**
 * Drop-in replacement for `express.Router()` that records every route (and the routes of routers
 * mounted beneath it with a path prefix). The API documentation is generated from this registry
 * and a test fails if a route exists without documentation or the reverse, so the OpenAPI spec
 * cannot silently drift from the code.
 */
export function Router(options?: RouterOptions): ExpressRouter {
  const router = express.Router(options) as Tracked;
  const routes: RouteInfo[] = [];
  router[TRACKED] = routes;
  const loose = router as unknown as Loose;

  for (const method of METHODS) {
    const original = loose[method]!.bind(router);
    loose[method] = (...args: unknown[]) => {
      if (typeof args[0] === 'string') routes.push({ method, path: args[0] });
      return original(...args);
    };
  }

  const originalUse = loose.use!.bind(router);
  loose.use = (...args: unknown[]) => {
    const prefix = typeof args[0] === 'string' ? args[0] : '';
    for (const arg of args) {
      for (const child of routesOfAny(arg))
        routes.push({ method: child.method, path: joinPaths(prefix, child.path) });
    }
    return originalUse(...args);
  };
  return router;
}

function routesOfAny(value: unknown): RouteInfo[] {
  if (typeof value === 'function' && TRACKED in value) {
    return (value as Tracked)[TRACKED] ?? [];
  }
  return [];
}

const joinPaths = (prefix: string, path: string) =>
  `${prefix.replace(/\/$/, '')}${path === '/' ? '' : path}` || '/';

/** Every route registered on (or beneath) this router, with mount prefixes applied. */
export const routesOf = (router: ExpressRouter): RouteInfo[] => [
  ...((router as Tracked)[TRACKED] ?? []),
];
