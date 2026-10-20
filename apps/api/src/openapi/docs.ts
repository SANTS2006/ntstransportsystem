import express, { type Express } from 'express';
import swaggerUiDist from 'swagger-ui-dist';
import type { Router, RouteInfo } from '../platform/router.js';
import { buildOpenApi } from './build.js';

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NTS Transport Platform API</title>
    <link rel="stylesheet" href="/api/v1/docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api/v1/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/api/v1/docs/init.js"></script>
  </body>
</html>`;

// An external file (not inline) so it passes the default `script-src 'self'` policy.
const INIT_JS = `window.ui = SwaggerUIBundle({
  url: '/api/v1/openapi.json',
  dom_id: '#swagger-ui',
  withCredentials: true,
  persistAuthorization: false,
  requestInterceptor: function (req) {
    var m = document.cookie.match(/(?:^|; )csrf=([^;]+)/);
    if (m) req.headers['x-csrf-token'] = decodeURIComponent(m[1]);
    return req;
  },
});`;

/**
 * Registers the OpenAPI document and Swagger UI on `router` (the /api/v1 router). The spec is
 * built lazily from the live route table, so it always reflects the routes that really exist.
 */
export function mountApiDocs(app: Express, router: ReturnType<typeof Router>): void {
  let cached: unknown;
  router.get('/openapi.json', (_req, res) => {
    cached ??= buildOpenApi(app.locals.routeTable as RouteInfo[]);
    res.json(cached);
  });
  router.get('/docs', (_req, res) => {
    res.type('html').send(DOCS_HTML);
  });
  router.get('/docs/init.js', (_req, res) => {
    res.type('application/javascript').send(INIT_JS);
  });
  // Static assets are plain middleware, deliberately not part of the documented route table.
  router.use('/docs/assets', express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false }));
}
