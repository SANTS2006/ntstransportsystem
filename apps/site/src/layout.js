import { SITE, whatsappLink } from './config.js';

const NAV = [
  ['/', 'Home'],
  ['/features.html', 'Features'],
  ['/how-it-works.html', 'How it works'],
  ['/solutions.html', 'Solutions'],
  ['/security.html', 'Security'],
  ['/about.html', 'About'],
  ['/faq.html', 'FAQ'],
];

const WA_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true" class="wa-ico"><path fill="currentColor" d="M16.04 3C9.4 3 4 8.4 4 15.04c0 2.12.55 4.18 1.6 6L4 29l8.14-1.56a12 12 0 0 0 3.9.65h.01C22.68 28.1 28 22.7 28 16.06 28 9.4 22.68 3 16.04 3Zm0 22.07h-.01a10 10 0 0 1-5.1-1.4l-.37-.22-4.83.93.96-4.7-.24-.38a9.98 9.98 0 0 1-1.53-5.3c0-5.52 4.5-10.02 10.04-10.02 5.52 0 10.02 4.5 10.02 10.04 0 5.53-4.5 10.05-10.04 10.05Zm5.5-7.5c-.3-.15-1.78-.88-2.06-.98-.27-.1-.47-.15-.67.15-.2.3-.77.98-.95 1.18-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5a9.1 9.1 0 0 1-1.68-2.08c-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.08-.8.38-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.5.7.3 1.26.48 1.7.62.72.23 1.37.2 1.88.12.57-.08 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35Z"/></svg>`;

const here = () => {
  const p = location.pathname.replace(/index\.html$/, '');
  return p.endsWith('/') || p === '' ? '/' : p;
};

export function mountLayout() {
  const path = here();
  const links = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === path || (href !== '/' && path.startsWith(href.replace('.html', ''))) ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  const header = document.createElement('header');
  header.className = 'nav';
  header.innerHTML = `
    <div class="nav__in">
      <a class="brand" href="/" aria-label="${SITE.name} home">
        <img src="/icon-192.png" alt="" width="36" height="36" />
        <span>NTS <b>Transport</b></span>
      </a>
      <nav class="nav__links" id="site-nav" aria-label="Main">${links}</nav>
      <div class="nav__cta">
        <a class="btn btn--ghost btn--sm" href="/contact.html">Contact</a>
        <a class="btn btn--primary btn--sm" href="/demo.html">Request a demo</a>
        <a class="btn btn--wa btn--sm" href="${whatsappLink()}" target="_blank" rel="noopener noreferrer">${WA_ICON}<span>WhatsApp</span></a>
        <button class="burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav"><i></i><i></i><i></i></button>
      </div>
    </div>`;
  document.body.prepend(header);

  // Five quick clicks on an empty part of the bar open the platform administrators' sign-in. There is
  // no visible link to it anywhere on the site.
  let taps = 0;
  let last = 0;
  header.addEventListener('click', (e) => {
    if (e.target.closest('a, button, .brand, .nav__links')) return;
    const now = Date.now();
    taps = now - last > 2500 ? 1 : taps + 1;
    last = now;
    if (taps >= 5) {
      taps = 0;
      location.assign('/platform-admin/login');
    }
  });

  const burger = header.querySelector('.burger');
  burger.addEventListener('click', () => {
    const open = header.classList.toggle('nav--open');
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  header.querySelectorAll('.nav__links a').forEach((a) =>
    a.addEventListener('click', () => {
      header.classList.remove('nav--open');
      burger.setAttribute('aria-expanded', 'false');
    }),
  );

  const footer = document.createElement('footer');
  footer.className = 'foot';
  footer.innerHTML = `
    <div class="foot__in">
      <div class="foot__brand">
        <a class="brand" href="/"><img src="/icon-192.png" alt="" width="36" height="36" /><span>NTS <b>Transport</b></span></a>
        <p>One system for bus and coach companies: bookings, tickets, dispatch, fleet, people and payroll, branded as your own.</p>
        <p class="foot__tag">Built by ${SITE.company}</p>
      </div>
      <div>
        <h4>Explore</h4>
        <a href="/features.html">Features</a>
        <a href="/how-it-works.html">How it works</a>
        <a href="/solutions.html">Solutions</a>
        <a href="/security.html">Security</a>
        <a href="/demo.html">Request a demo</a>
      </div>
      <div>
        <h4>Company</h4>
        <a href="/about.html">About us</a>
        <a href="/faq.html">FAQ</a>
        <a href="/contact.html">Contact</a>
        <a href="/privacy.html">Privacy policy</a>
        <a href="/terms.html">Terms of use</a>
      </div>
      <div>
        <h4>Talk to us</h4>
        <a href="mailto:${SITE.email}">${SITE.email}</a>
        <a href="tel:${SITE.phoneTel}">${SITE.phoneDisplay}</a>
        <a href="${whatsappLink()}" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>
      </div>
    </div>
    <div class="foot__bar">
      <span>© ${new Date().getFullYear()} ${SITE.company}. All rights reserved.</span>
      <span>Made for transport operators.</span>
    </div>`;
  document.body.append(footer);

  const fab = document.createElement('a');
  fab.className = 'wa-fab';
  fab.href = whatsappLink();
  fab.target = '_blank';
  fab.rel = 'noopener noreferrer';
  fab.setAttribute('aria-label', `Chat with us on WhatsApp, ${SITE.phoneDisplay}`);
  fab.innerHTML = `${WA_ICON}<span class="wa-fab__tip">Chat on WhatsApp<small>${SITE.phoneDisplay}</small></span>`;
  document.body.append(fab);
}
