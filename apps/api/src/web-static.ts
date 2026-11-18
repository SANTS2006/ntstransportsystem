import express, { type Express } from 'express';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where private files are delivered from; images, audio and video shown in the app come from here. */
const FILE_HOSTS =
  'https://api.cloudinary.com https://res.cloudinary.com https://*.r2.cloudflarestorage.com';

/**
 * Policy for the single-page app. Fonts are bundled, so nothing is loaded from other sites except
 * Google's sign-in script and frame, and files shown in the app from the file hosts above.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "font-src 'self'",
  `img-src 'self' data: blob: https://*.googleusercontent.com ${FILE_HOSTS}`,
  `media-src 'self' blob: ${FILE_HOSTS}`,
  "connect-src 'self' https://accounts.google.com",
  'frame-src https://accounts.google.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Policy for the public website: its own scripts and styles only, and its forms post to this origin. */
export const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const isApiPath = (p: string) => /^\/(api|health)(\/|$)/.test(p);

/**
 * The public website is the home page of the system: "/" and its own pages (/features ...),
 * its fingerprinted files under /site-assets, sitemap.xml and robots.txt. Everything else is the
 * web app. Company addresses never contain a dot, so the pages cannot be mistaken for one.
 */
function mountSite(app: Express, dir: string): void {
  const root = resolve(dir);
  const home = resolve(root, 'index.html');
  if (!existsSync(home)) throw new Error(`SITE_DIST_DIR has no index.html: ${root}`);
  app.get('/', (_req, res) => {
    res.setHeader('Content-Security-Policy', SITE_CSP);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(home);
  });
  // Pages have clean addresses: /about serves about.html, and the old /about.html goes to /about.
  const pages = readdirSync(root)
    .filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== '404.html')
    .map((f) => f.slice(0, -5));
  app.get(['/index.html', '/index'], (_req, res) => res.redirect(301, '/'));
  for (const name of pages) {
    app.get(`/${name}.html`, (_req, res) => res.redirect(301, `/${name}`));
    app.get(`/${name}`, (_req, res) => {
      res.setHeader('Content-Security-Policy', SITE_CSP);
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(root, `${name}.html`));
    });
  }
  app.use(
    express.static(root, {
      index: false,
      setHeaders(res, file) {
        if (/\.html$/.test(file)) res.setHeader('Content-Security-Policy', SITE_CSP);
        res.setHeader(
          'Cache-Control',
          /[\\/]site-assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );
}

/**
 * Serves the built web app from this process, so one origin hosts the app and the API (the app
 * uses same-origin cookies). Mount it AFTER the API routes: anything under /api or /health that
 * no route handled keeps its JSON 404, and a missing file (anything with an extension) is a 404
 * rather than the app shell, so a bad script path cannot be mistaken for HTML.
 */
export function mountWeb(app: Express, dir: string, siteDir?: string): void {
  const root = resolve(dir);
  const index = resolve(root, 'index.html');
  if (!existsSync(index)) throw new Error(`WEB_DIST_DIR has no index.html: ${root}`);

  if (siteDir) mountSite(app, siteDir);

  app.use(
    express.static(root, {
      index: false,
      setHeaders(res, file) {
        // Build output under /assets is fingerprinted; everything else must be revalidated.
        res.setHeader(
          'Cache-Control',
          /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(req.path)) return next();
    if (/\.[A-Za-z0-9]+$/.test(req.path)) return next();
    res.setHeader('Content-Security-Policy', WEB_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(index);
  });
}

/**
 * The built website that sits beside the built web app (apps/site/dist next to apps/web/dist), so a
 * deployment that builds both shows the website as the home page without any extra setting.
 */
export function siblingSiteDir(webDir: string): string | undefined {
  const guess = resolve(webDir, '..', '..', 'site', 'dist');
  return existsSync(resolve(guess, 'index.html')) ? guess : undefined;
}
