import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Pages that search engines should index, with how often they change and how much they matter. */
const PAGES = [
  ['', 1.0, 'weekly'],
  ['features.html', 0.9, 'monthly'],
  ['demo.html', 0.9, 'monthly'],
  ['how-it-works.html', 0.8, 'monthly'],
  ['solutions.html', 0.8, 'monthly'],
  ['security.html', 0.7, 'monthly'],
  ['about.html', 0.6, 'yearly'],
  ['faq.html', 0.7, 'monthly'],
  ['contact.html', 0.8, 'yearly'],
  ['privacy-policy.html', 0.3, 'yearly'],
  ['terms-of-use.html', 0.3, 'yearly'],
];
const INPUTS = [...PAGES.map(([p]) => p.replace(/\.html$/, '') || 'index'), '404'];

/**
 * The address the site is published at (used in canonical links, social previews, structured data
 * and the sitemap). Set SITE_URL when building; this is only the fallback.
 */
const SITE_URL = (process.env.SITE_URL ?? 'https://ntstransport.onrender.com').replace(/\/$/, '');

function seoFiles() {
  return {
    name: 'nts-seo',
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', SITE_URL),
    generateBundle() {
      const day = new Date().toISOString().slice(0, 10);
      const urls = PAGES.map(
        ([p, priority, freq]) =>
          `  <url><loc>${SITE_URL}/${p.replace(/\.html$/, '')}</loc><lastmod>${day}</lastmod><changefreq>${freq}</changefreq><priority>${priority.toFixed(1)}</priority></url>`,
      ).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: [
          'User-agent: *',
          'Allow: /',
          // The system itself (sign-in, dashboards, API) is not for search results.
          'Disallow: /platform-admin',
          'Disallow: /platform',
          'Disallow: /api/',
          '',
          `Sitemap: ${SITE_URL}/sitemap.xml`,
          '',
        ].join('\n'),
      });
    },
  };
}

/** Clean addresses while developing: /about is the file about.html, like on the live site. */
function cleanUrls() {
  const rewrite = (req, _res, next) => {
    const [path, query = ''] = (req.url ?? '').split('?');
    if (/^\/[a-z0-9-]+$/.test(path) && INPUTS.includes(path.slice(1))) {
      req.url = `${path}.html${query ? `?${query}` : ''}`;
    }
    next();
  };
  return {
    name: 'nts-clean-urls',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  plugins: [seoFiles(), cleanUrls()],
  server: {
    port: 5180,
    // The forms post to the API; during development it runs on its own port.
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    // Files of the site live under /site-assets so they never mix with the web app's /assets.
    assetsDir: 'site-assets',
    rollupOptions: {
      input: Object.fromEntries(INPUTS.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
    },
  },
});
