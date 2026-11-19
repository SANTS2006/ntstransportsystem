import fs from 'node:fs';

import { fileURLToPath } from 'node:url';

/** Writes the site's HTML pages next to this script's folder: `node scripts/gen-pages.mjs`. */
const OUT = fileURLToPath(new URL('../', import.meta.url));
const EMAIL = 'hello@ntsdigitalsolutions.com';
const PHONE = '+232 31 034 604';

const ICONS = {
  ticket:
    '<path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1Z"/><path d="M13 5v14" stroke-dasharray="2 3"/>',
  route:
    '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v2M16 18v2"/><circle cx="8" cy="14.5" r=".6"/><circle cx="16" cy="14.5" r=".6"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  wallet:
    '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2.5"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3Z"/><path d="m15 9-3 3"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 13h18"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.5-2.2s.2-2.3 1.6-2.3H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3Z"/><circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7.5" r=".8"/><circle cx="15" cy="7.5" r=".8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  coins:
    '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7M15 11.5c3 .1 6 1.3 6 3v3c0 1.7-2.7 3-6 3-2.2 0-4.2-.6-5.2-1.5"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><path d="M9 4v14M15 6v14"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/>',
  zap: '<path d="M13 3 5 13h6l-1 8 8-10h-6Z"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z"/>',
};
const ico = (n) =>
  `<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg></span>`;

/** The address of a page: no .html, and the home page is just the site address. */
const clean = (f) => (f === 'index.html' ? '' : f.replace(/\.html$/, ''));

const ORG = {
  '@type': 'Organization',
  name: 'NTS Digital Solutions',
  url: '__SITE_URL__/',
  logo: '__SITE_URL__/icon-192.png',
  email: EMAIL,
  telephone: '+23231034604',
  contactPoint: [
    {
      '@type': 'ContactPoint',
      contactType: 'sales',
      telephone: '+23231034604',
      email: EMAIL,
      availableLanguage: ['English'],
    },
  ],
};

const jsonLd = (p) => {
  const url = `__SITE_URL__/${clean(p.file)}`;
  const graph = [
    ORG,
    {
      '@type': 'WebSite',
      name: 'NTS Transport',
      url: '__SITE_URL__/',
      publisher: { '@type': 'Organization', name: 'NTS Digital Solutions' },
    },
  ];
  if (p.file === 'index.html') {
    graph.push({
      '@type': 'SoftwareApplication',
      name: 'NTS Transport',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android, iOS',
      description: p.desc,
      url,
      publisher: { '@type': 'Organization', name: 'NTS Digital Solutions' },
      featureList: [
        'Online and desk booking',
        'QR and barcode tickets',
        'Dispatch and crew assignment',
        'Fleet and maintenance',
        'Recruitment and hiring',
        'Salary structures and deductions',
        'Company branding',
      ],
    });
  } else {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: '__SITE_URL__/' },
        { '@type': 'ListItem', position: 2, name: p.crumb ?? p.title.split(' | ')[0], item: url },
      ],
    });
  }
  if (p.faq) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: p.faq.map((q) => ({
        '@type': 'Question',
        name: q[0],
        acceptedAnswer: { '@type': 'Answer', text: q[1] },
      })),
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
};

const page = (p) => {
  const { file, title, desc, scene = 'full', body } = p;
  const url = `__SITE_URL__/${clean(file)}`;
  const noindex = p.noindex
    ? '<meta name="robots" content="noindex, follow" />'
    : '<meta name="robots" content="index, follow, max-image-preview:large" />';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  ${noindex}
  <link rel="canonical" href="${url}" />
  <meta name="theme-color" content="#050d1f" />
  <meta name="author" content="NTS Digital Solutions" />
  <meta property="og:site_name" content="NTS Transport" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="__SITE_URL__/nts-logo.jpg" />
  <meta property="og:image:alt" content="NTS Transport logo" />
  <meta property="og:locale" content="en" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="__SITE_URL__/nts-logo.jpg" />
  <link rel="icon" href="/icon-192.png" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
  <script type="application/ld+json">${jsonLd(p)}</script>
  <script type="module" src="/src/main.js"></script>
</head>
<body data-scene="${scene}">
  <canvas id="scene" aria-hidden="true"></canvas>
  <div class="vignette" aria-hidden="true"></div>
  <a class="skip" href="#main">Skip to content</a>
  <main id="main">
${body}
  </main>
</body>
</html>
`;
};

const head = (crumb, h1, lead) => `
    <section class="phead" id="top" data-dot="Top">
      <div class="wrap">
        <h1 class="h1" style="font-size:clamp(36px,6vw,72px)" data-split>${h1}</h1>
        <p class="lead" data-reveal="up" data-delay="500">${lead}</p>
      </div>
    </section>`;

const secHead = (eyebrow, h2, lead = '', center = false) => `
        <div class="sec-head${center ? ' center' : ''}" data-reveal="up">
          <span class="eyebrow">${eyebrow}</span>
          <h2 class="h2">${h2}</h2>
          ${lead ? `<p class="lead">${lead}</p>` : ''}
        </div>`;

const card = (
  icon,
  title,
  text,
  items = [],
  { cls = '', tag = '', delay = 0, reveal = 'up' } = {},
) => `
          <article class="card tilt ${cls}" data-reveal="${reveal}" data-delay="${delay}">
            ${icon ? ico(icon) : ''}${tag ? `<span class="tag">${tag}</span>` : ''}
            <h3>${title}</h3>
            <p>${text}</p>
            ${items.length ? `<ul class="ticks">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}
          </article>`;

const cta = (h = 'Ready to run your routes on one system?') => `
    <section class="section">
      <div class="wrap">
        <div class="cta" data-reveal="zoom">
          <span class="eyebrow">Let us talk</span>
          <h2 class="h2">${h}</h2>
          <p class="lead">Tell us about your company and we will show you how NTS Transport fits it. A message on WhatsApp is the fastest way.</p>
          <div class="hero__cta">
            <a class="btn btn--wa" href="__WA__" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 32 32" class="wa-ico" aria-hidden="true"><use /></svg>Chat on WhatsApp</a>
            <a class="btn btn--primary" href="/demo.html">Request a demo</a>
            <a class="btn btn--ghost" href="/contact.html">Send us a message</a>
          </div>
        </div>
      </div>
    </section>`;

const pages = [];
const add = (p) => pages.push(p);

// ================================================================================ HOME
add({
  file: 'index.html',
  title: 'NTS Transport | The complete system for bus and coach companies',
  desc: 'NTS Transport brings online booking, QR tickets, dispatch, fleet care, recruitment and payroll together in one system that carries your company’s own brand.',
  body: `
    <section class="hero" id="top" data-dot="Welcome">
      <div class="wrap">
        <div class="hero__copy">
          <span class="eyebrow" data-reveal="up">Transport management platform</span>
          <h1 class="h1" data-split>Run every journey from one system.</h1>
          <p class="lead" data-reveal="up" data-delay="600">Bookings, QR tickets, dispatch, fleet care, people and payroll for bus and coach companies, wrapped in your own brand and ready on any phone.</p>
          <div class="hero__cta" data-reveal="up" data-delay="760">
            <a class="btn btn--primary" href="/demo.html">Request a demo</a>
            <a class="btn btn--ghost" href="/features.html">Explore the features</a>
          </div>
          <div class="hero__chips" data-reveal="up" data-delay="900">
            <span class="chip">Online + desk sales</span><span class="chip">QR &amp; barcode tickets</span><span class="chip">Your own web address</span><span class="chip">Works as an app</span>
          </div>
        </div>
      </div>
      <div class="scrollhint" aria-hidden="true"><i></i>Scroll</div>
    </section>

    <div class="marquee" aria-hidden="true"><div class="marquee__in">
      ${Array.from({ length: 2 }, () => ['Seat selection', 'QR tickets', 'Camera boarding', 'Dispatch board', 'Crew rules', 'Maintenance alerts', 'Desk payments', 'Recruitment', 'Salaries', 'Complaints &amp; ratings', 'Audit trail', 'Company branding'].map((t) => `<span>${t}</span>`).join('')).join('')}
    </div></div>

    <section class="section" id="numbers" data-dot="At a glance">
      <div class="wrap">
        <div class="stats">
          <div class="card stat" data-reveal="zoom"><b data-count="8">0</b><span>ready-made staff roles</span></div>
          <div class="card stat" data-reveal="zoom" data-delay="100"><b data-count="3">0</b><span>ways for passengers to sign in</span></div>
          <div class="card stat" data-reveal="zoom" data-delay="200"><b data-count="24" data-suffix="/7">0</b><span>online booking, any phone</span></div>
          <div class="card stat" data-reveal="zoom" data-delay="300"><b data-count="2">0</b><span>codes on every ticket: QR and barcode</span></div>
        </div>
      </div>
    </section>

    <section class="section section--glass" id="features" data-dot="Features">
      <div class="wrap">
        ${secHead('What it does', 'Everything a transport company runs on, in one place.', 'No more spreadsheets, paper tickets and scattered chats. Each part works with the others, so a seat sold at the desk is gone online in the same second.')}
        <div class="bento">
          <article class="card card--big tilt b4" data-reveal="up">
            ${ico('ticket')}<span class="tag">Booking</span>
            <h3>Seats sold online and at the desk, never twice.</h3>
            <p>Passengers pick their seat on a real seat map. Agents sell at the counter. Held seats expire on their own, and the database itself refuses a double booking.</p>
            <div class="mini-ui"><div class="seatgrid"><i></i><i class="t"></i><i></i><i></i><i class="o"></i><i></i><i class="t"></i><i></i><i class="t"></i><i></i><i></i><i></i><i class="o"></i><i class="t"></i><i></i><i></i></div><div class="row"><span>Freetown → Bo · 06:30</span><strong>3 seats left</strong></div></div>
          </article>
          ${card('scan', 'Tickets with QR and barcode', 'Every ticket carries both codes. Boarding staff scan with the phone camera and get an instant yes or no.', [], { cls: 'b2', delay: 100 })}
          ${card('bus', 'Dispatch board', 'See today’s trips, assign vehicles and crew, post delays and swap a bus. Passengers are told automatically.', [], { cls: 'b2', delay: 100 })}
          ${card('wallet', 'Payments', 'Online payments, cash and other methods at the desk, refunds and a daily cash-up, all reconciled.', [], { cls: 'b3', delay: 0 })}
          ${card('wrench', 'Fleet care', 'Maintenance jobs, vehicle documents and expiry alerts keep buses legal and on the road.', [], { cls: 'b3', delay: 100 })}
          ${card('users', 'People and payroll', 'Recruit with custom forms, hire, assign roles and set salary structures. Staff see their own pay.', [], { cls: 'b3', delay: 200 })}
          <article class="card card--warm tilt b3" data-reveal="up">
            ${ico('palette')}<h3>Your brand, your address</h3>
            <p>Your logo, your colours and your own web address. Passengers see your company, not ours.</p>
          </article>
          <article class="card tilt b3" data-reveal="up" data-delay="100">
            ${ico('chart')}<h3>Reports you can act on</h3>
            <p>Sales, trips and finance reports with CSV export, built from the same live data.</p>
          </article>
          <article class="card tilt b3" data-reveal="up" data-delay="200">
            ${ico('bell')}<h3>Notices that reach people</h3>
            <p>Email and in-app notices for bookings, delays, interviews and more, all in one notifications page.</p>
          </article>
        </div>
        <p class="center" style="margin-top:36px" data-reveal="up"><a class="btn btn--ghost" href="/features.html">See every feature →</a></p>
      </div>
    </section>

    <section class="hs" data-hscroll id="journey" data-dot="Journey">
      <div class="hs__sticky">
        <div class="wrap" style="margin-bottom:26px">
          <span class="eyebrow">The journey</span>
          <h2 class="h2" style="margin:0">From route to revenue, step by step.</h2>
        </div>
        <div class="hs__track">
          <article class="hs__panel"><div class="num">01</div><h3>Set up your network</h3><p>Add terminals, routes with stops and fares, vehicles and seat layouts. Reuse them for every trip.</p></article>
          <article class="hs__panel"><div class="num">02</div><h3>Schedule trips</h3><p>Weekly schedules create trips automatically, with a calendar and blackout days for holidays and breakdowns.</p></article>
          <article class="hs__panel"><div class="num">03</div><h3>Sell seats</h3><p>Passengers book on your page. Agents sell at the desk. Payment confirms the seat and sends the ticket.</p></article>
          <article class="hs__panel"><div class="num">04</div><h3>Run the day</h3><p>Dispatch assigns the crew, boarding scans tickets, and delays or bus swaps reach passengers at once.</p></article>
          <article class="hs__panel"><div class="num">05</div><h3>Look after people and cash</h3><p>Cash-up, refunds and reports for finance. Recruitment, hiring and salaries for HR. Every action on record.</p></article>
        </div>
        <div class="hs__bar" aria-hidden="true"><i></i></div>
      </div>
    </section>

    <section class="section" id="roles" data-dot="Roles">
      <div class="wrap">
        ${secHead('Made for every role', 'Each person sees exactly what their job needs.', 'Roles decide what shows in the menu and what the server allows. Staff who wear several hats can switch between them.', true)}
        <div class="fan">
          <article class="card tilt" data-reveal="up">${ico('phone')}<h3>Passengers</h3><p>Search trips, pick seats, pay, keep tickets on the phone, rate the ride and raise a complaint with photos or a voice note.</p></article>
          <article class="card tilt" data-reveal="up" data-delay="100">${ico('route')}<h3>Dispatch and drivers</h3><p>Dispatch builds the day and assigns crew with licence and rest rules checked. Drivers see their trips and scan tickets.</p></article>
          <article class="card tilt" data-reveal="up" data-delay="200">${ico('coins')}<h3>Sales and finance</h3><p>Agents sell and take payment at the desk. Finance cashes up, refunds, reads reports and manages salaries.</p></article>
          <article class="card tilt" data-reveal="up" data-delay="300">${ico('key')}<h3>Owners and HR</h3><p>Owners shape roles and branding. HR runs recruitment, hiring and staff records. Auditors read the activity log.</p></article>
        </div>
      </div>
    </section>

    <section class="section section--glass" id="mobile" data-dot="On the phone">
      <div class="wrap split2">
        <div data-reveal="left">
          <span class="eyebrow">Built for the phone</span>
          <h2 class="h2">Tickets that travel in your pocket.</h2>
          <p class="lead">The whole system installs like an app and keeps working on a weak connection. Passengers carry their tickets, staff scan with the camera, and nothing needs a separate download.</p>
          <ul class="ticks">
            <li>Installable on Android and iPhone, with an offline page</li>
            <li>Camera scanning at boarding, with a beep for the answer</li>
            <li>Light and dark themes that follow the phone</li>
          </ul>
        </div>
        <div data-reveal="right" data-parallax="0.08">
          <div class="device" aria-hidden="true"><div class="device__screen">
            <h4>My ticket</h4>
            <div class="tk"><strong>Freetown → Bo</strong>Fri 24 Oct · 06:30 · Seat 12A<div class="qr"></div></div>
            <div class="tk"><strong>Boarding opens 05:45</strong>Gate 2 · Coach SL-204</div>
            <div class="tk"><strong>Paid</strong>Reference NTS-48213</div>
          </div></div>
        </div>
      </div>
    </section>
${cta()}`,
});

// ================================================================================ FEATURES
const featureBlocks = [
  [
    'booking',
    'Booking & tickets',
    'Sell every seat, every way.',
    'From the first search to the boarding scan.',
    [
      [
        'ticket',
        'Online booking',
        'Passengers search trips, see live seat availability and book in a few taps on your own page.',
        [
          'Seat maps for each vehicle layout',
          'Seats held while paying, then released',
          'Bookings for several passengers at once',
        ],
      ],
      [
        'scan',
        'QR and barcode tickets',
        'Every ticket has a QR code and a Code 128 barcode, as a page and a PDF.',
        [
          'Scan with the phone camera',
          'USB and Bluetooth scanners work too',
          'Cancelled tickets stop working',
        ],
      ],
      [
        'users',
        'Desk sales',
        'Agents sell at the counter and take payment on the spot.',
        ['Cash and other methods recorded', 'Refunds with a reason', 'Daily cash-up per agent'],
      ],
    ],
  ],
  [
    'payments',
    'Payments',
    'Money in, money matched.',
    'Pay online or at the desk, and always know where every payment stands.',
    [
      [
        'wallet',
        'Online payments',
        'An integrated payment gateway confirms bookings automatically when payment lands.',
        [
          'Safe retries: a payment is never counted twice',
          'Late payments flagged for refund',
          'Per-company payment settings',
        ],
      ],
      [
        'coins',
        'Manual methods',
        'Companies can set up their own manual payment methods and let passengers claim payment.',
        [
          'Staff review and confirm claims',
          'Method details shown at checkout',
          'Everything on the audit trail',
        ],
      ],
      [
        'chart',
        'Finance reports',
        'Sales and payment reports for the finance team, exportable to CSV.',
        ['Per route, per day, per method', 'Refund and cash-up views', 'Built from live data'],
      ],
    ],
  ],
  [
    'operations',
    'Operations',
    'Plan the network, run the day.',
    'The tools dispatchers use every morning.',
    [
      [
        'map',
        'Routes, stops and fares',
        'Model your network with terminals, stops and fares, including fares between stops.',
        [
          'Locations and routes reused across trips',
          'Stop-to-stop fares',
          'Vehicle and route compatibility',
        ],
      ],
      [
        'clock',
        'Schedules and calendar',
        'Weekly schedules generate trips. A calendar shows the month at a glance.',
        ['Blackout days for holidays', 'Trips created ahead of time', 'Per-company time zone'],
      ],
      [
        'bus',
        'Dispatch board',
        'Assign vehicles and crew, post delays, swap a bus, cancel a trip.',
        [
          'Passengers notified automatically',
          'Cancelling releases crew',
          'Every change on the trip’s history',
        ],
      ],
    ],
  ],
  [
    'fleet',
    'Fleet & crew',
    'Keep buses legal and crews rested.',
    'Rules that protect people and the business.',
    [
      [
        'wrench',
        'Maintenance',
        'Schedule services, repairs and inspections and see what is due.',
        [
          'Vehicle off the road while in the workshop',
          'Odometer and cost on completion',
          'Overdue and upcoming alerts',
        ],
      ],
      [
        'file',
        'Vehicle documents',
        'Insurance, road licence and inspection certificates with expiry dates.',
        ['Alerts before things expire', 'Per-vehicle document list', 'Fleet-wide alert board'],
      ],
      [
        'shield',
        'Crew assignment',
        'Drivers and conductors are checked before they are put on a trip.',
        [
          'Valid licence on the service date',
          'No overlapping duty, enforced by the database',
          'Minimum rest between trips',
        ],
      ],
    ],
  ],
  [
    'people',
    'People & pay',
    'From first application to payslip.',
    'HR and finance tools that talk to the rest of the system.',
    [
      [
        'briefcase',
        'Recruitment',
        'Publish job postings for any company role except owner, with a form you build yourself.',
        [
          'Questions of ten kinds, including file upload',
          'Picture and licence photo from applicants',
          'Shortlist, interview and hire, with an email at each step',
        ],
      ],
      [
        'users',
        'Staff profiles and roles',
        'Hired applicants become staff with a role and a default password to change at first sign-in.',
        [
          'Staff can hold several roles and switch',
          'Roles and permissions you control',
          'Licence records for drivers',
        ],
      ],
      [
        'coins',
        'Salaries',
        'Finance builds salary structures with allowances, creates deductions and assigns them to staff.',
        [
          'Fixed or percentage deductions',
          'Detailed breakdown per person',
          'Each staff member sees their own: “My salary”',
        ],
      ],
    ],
  ],
  [
    'passengers',
    'Passenger care',
    'The part your customers remember.',
    'Clear information before, during and after the trip.',
    [
      [
        'bell',
        'Notifications',
        'Email and an in-app notifications page with a detail view for each notice.',
        [
          'Booking, delay and vehicle-change notices',
          'Interview and hiring notices for applicants',
          'Unread count on the bell',
        ],
      ],
      [
        'chat',
        'Complaints and ratings',
        'Passengers rate trips and raise complaints with photos, video or a voice note.',
        [
          'Support staff reply in a thread',
          'Attachments kept private',
          'Status from open to closed',
        ],
      ],
      [
        'lock',
        'Easy, safe sign-in',
        'Sign up with email, a phone number and a code, or Google.',
        [
          'Phone number accounts for passengers without email',
          'Password reset and email verification',
          'Optional two-step sign-in',
        ],
      ],
    ],
  ],
  [
    'platform',
    'Platform',
    'Many companies, one safe system.',
    'For the team that hosts it all.',
    [
      [
        'palette',
        'Your own brand',
        'Each company gets its logo, colours, name and web address on pages, emails and tickets.',
        ['Branded emails', 'Public company home page', 'Public job board'],
      ],
      [
        'shield',
        'Isolation and audit',
        'One company can never see another’s data, and every important action is recorded.',
        [
          'Row-level security in the database',
          'Activity log for owners and auditors',
          'Permission checks on the server',
        ],
      ],
      [
        'refresh',
        'Backups and care',
        'Platform tools for backups, maintenance mode and a platform-wide audit log.',
        ['Maintenance banner for everyone', 'Backup and restore tools', 'API documentation'],
      ],
    ],
  ],
];

add({
  file: 'features.html',
  title: 'Features | NTS Transport',
  desc: 'Every feature of NTS Transport: booking, QR tickets, payments, dispatch, fleet care, recruitment, salaries, notifications and more.',
  scene: 'soft',
  body: `${head('Features', 'Every feature, in plain words.', 'A tour of what NTS Transport does for passengers, staff and owners. Pick a topic or just scroll.')}
    <div class="wrap" style="padding-bottom:20px"><div class="hero__chips" data-reveal="up">${featureBlocks.map((f) => `<a class="chip" href="#${f[0]}">${f[1]}</a>`).join('')}</div></div>
    ${featureBlocks
      .map(
        (f, i) => `
    <section class="section${i % 2 ? ' section--glass' : ''}" id="${f[0]}" data-dot="${f[1]}">
      <div class="wrap">
        ${secHead(f[1], f[2], f[3])}
        <div class="grid grid--3">
          ${f[4].map((c, k) => card(c[0], c[1], c[2], c[3], { delay: k * 110, reveal: ['left', 'up', 'right'][k] })).join('')}
        </div>
      </div>
    </section>`,
      )
      .join('')}
${cta('Want to see these features working for your routes?')}`,
});

// ================================================================================ HOW IT WORKS
add({
  file: 'how-it-works.html',
  title: 'How it works | NTS Transport',
  desc: 'How a transport company goes live on NTS Transport: register, set up the network, invite staff, publish trips and start selling.',
  scene: 'soft',
  body: `${head('How it works', 'Live in a few simple steps.', 'No installation and no servers to look after. You sign in on the web and your company is ready to set up.')}
    <section class="section" id="steps" data-dot="Getting started">
      <div class="wrap split2">
        <div class="timeline">
          <div data-reveal="left"><h4>1. Register your company</h4><p>We register your company on the platform and make you its first administrator. You get a sign-in with a temporary password to change at first login.</p></div>
          <div data-reveal="left" data-delay="80"><h4>2. Add your brand</h4><p>Upload your logo, choose your colours and name. Pages, tickets and emails now look like yours, on your own web address.</p></div>
          <div data-reveal="left" data-delay="160"><h4>3. Build the network</h4><p>Add terminals, routes, stops and fares, vehicles and seat layouts.</p></div>
          <div data-reveal="left" data-delay="240"><h4>4. Bring in your people</h4><p>Create roles, add staff or recruit them through the job board. Everyone gets only the access their role allows.</p></div>
          <div data-reveal="left" data-delay="320"><h4>5. Publish schedules</h4><p>Weekly schedules create trips. Set blackout days, assign crew and vehicles.</p></div>
          <div data-reveal="left" data-delay="400"><h4>6. Start selling</h4><p>Passengers book online and agents sell at the desk. Tickets, payments and notices flow automatically.</p></div>
        </div>
        <div data-reveal="right" data-parallax="0.06">
          <article class="card tilt card--big">
            ${ico('zap')}<span class="tag">Typical first week</span>
            <h3>From sign-in to first ticket.</h3>
            <p>Most of the work is entering what you already know: your routes, fares and buses. After that the system does the repeating work for you.</p>
            <div class="mini-ui">
              <div class="row"><span>Network</span><strong>Day 1</strong></div><div class="bar"><b style="--w:30%"></b></div>
              <div class="row"><span>Staff and roles</span><strong>Day 2</strong></div><div class="bar"><b style="--w:55%"></b></div>
              <div class="row"><span>Schedules and trips</span><strong>Day 3</strong></div><div class="bar"><b style="--w:78%"></b></div>
              <div class="row"><span>First booking</span><strong>Day 4</strong></div><div class="bar"><b style="--w:100%"></b></div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="section section--glass" id="day" data-dot="A day on the system">
      <div class="wrap">
        ${secHead('A day on the system', 'What happens between 05:00 and midnight.', '', true)}
        <div class="grid grid--4">
          ${card('clock', 'Early morning', 'Dispatch checks the board, confirms crews and swaps a bus that failed inspection. Passengers on that trip get a notice.', [], { delay: 0 })}
          ${card('scan', 'Boarding', 'The conductor scans each ticket with a phone. Invalid or used tickets are refused on the spot.', [], { delay: 100 })}
          ${card('wallet', 'Daytime sales', 'Agents sell remaining seats and online bookings keep arriving. Seats update live everywhere.', [], { delay: 200 })}
          ${card('chart', 'Evening', 'Agents cash up, finance reviews the day and the owner reads the reports. Everything is logged.', [], { delay: 300 })}
        </div>
      </div>
    </section>
${cta('Ready to take the first step?')}`,
});

// ================================================================================ SOLUTIONS
add({
  file: 'solutions.html',
  title: 'Solutions | NTS Transport',
  desc: 'NTS Transport for operators, passengers and staff in every role, from dispatchers and drivers to finance, HR and owners.',
  scene: 'soft',
  body: `${head('Solutions', 'One system, built around the people who use it.', 'Operators get control, passengers get convenience and every staff role gets a workspace that fits.')}
    <section class="section" id="operators" data-dot="Operators">
      <div class="wrap split2">
        <div data-reveal="left"><span class="eyebrow">For operators</span><h2 class="h2">Grow without the paperwork.</h2>
          <p class="lead">Whether you run a handful of coaches or a regional network, the system scales with you and keeps every company’s data apart.</p>
          <ul class="ticks"><li>Online sales on your own page, 24 hours a day</li><li>Live seat counts shared between web and desk</li><li>Fleet and crew rules that prevent costly mistakes</li><li>Reports for the owner, finance and auditors</li></ul></div>
        <div class="grid" data-reveal="right">
          ${card('chart', 'See the business', 'Sales, trips and payments in clear reports you can export.')}
          ${card('palette', 'Look like yourself', 'Your logo, colours, web address and branded emails.', [], { delay: 100 })}
        </div>
      </div>
    </section>
    <section class="section section--glass" id="passengers" data-dot="Passengers">
      <div class="wrap split2 split2--rev">
        <div data-reveal="left" class="grid">
          ${card('phone', 'Book in minutes', 'Search, choose a seat, pay and get a ticket on the phone.')}
          ${card('bell', 'Stay informed', 'Delay, vehicle and cancellation notices by email and in the app.', [], { delay: 100 })}
        </div>
        <div data-reveal="right"><span class="eyebrow">For passengers</span><h2 class="h2">Travel with confidence.</h2>
          <p class="lead">Clear prices, real seats and a ticket you cannot lose. If something goes wrong, there is a place to say so and a team that replies.</p>
          <ul class="ticks"><li>Sign up with email, phone number or Google</li><li>Rate your trip and send complaints with photos or voice</li><li>Apply for jobs at the company and track the application</li></ul></div>
      </div>
    </section>
    <section class="section" id="roles" data-dot="Staff roles">
      <div class="wrap">
        ${secHead('Staff roles', 'Eight roles ready on day one.', 'Every company starts with these and can change them or add its own.', true)}
        <div class="grid grid--4">
          ${[
            ['key', 'Company owner', 'Everything, including roles, branding and salaries.'],
            ['shield', 'Administrator', 'Runs daily operations, people and settings.'],
            ['route', 'Dispatcher', 'Trips, vehicles, crews and the dispatch board.'],
            ['ticket', 'Sales agent', 'Sells seats and takes payment at the desk.'],
            ['bus', 'Driver', 'Sees trips and scans tickets at boarding.'],
            ['coins', 'Finance officer', 'Payments, refunds, reports and salaries.'],
            ['briefcase', 'HR manager', 'Recruitment, hiring and staff records.'],
            ['file', 'Auditor', 'Read-only view of activity and operations.'],
          ]
            .map((r, i) => card(r[0], r[1], r[2], [], { delay: (i % 4) * 90 }))
            .join('')}
        </div>
      </div>
    </section>
${cta('Which role are you? Tell us what you need.')}`,
});

// ================================================================================ SECURITY
add({
  file: 'security.html',
  title: 'Security & trust | NTS Transport',
  desc: 'How NTS Transport protects company data: isolated tenants, role-based access, two-step sign-in, audit logs, private files and backups.',
  scene: 'soft',
  body: `${head('Security', 'Your data stays yours.', 'Transport companies hold passenger, payment and staff information. We treat protecting it as part of the product, not an add-on.')}
    <section class="section" id="protect" data-dot="Protection">
      <div class="wrap">
        <div class="bento">
          <article class="card card--big tilt b4" data-reveal="up">${ico('shield')}<span class="tag">Isolation</span><h3>One company can never read another’s data.</h3><p>Every record belongs to a company and the database itself enforces it with row-level security. Even a mistake in the application cannot cross that line.</p>
            <div class="mini-ui"><div class="row"><span>Company A</span><strong>sees A</strong></div><div class="row"><span>Company B</span><strong>sees B</strong></div></div></article>
          ${card('key', 'Roles and permissions', 'Access is decided on the server. Nobody can hand out permissions they do not hold themselves.', [], { cls: 'b2', delay: 100 })}
          ${card('lock', 'Two-step sign-in', 'Optional authenticator app codes with recovery codes, and Google sign-in for those who prefer it.', [], { cls: 'b3' })}
          ${card('file', 'Private files', 'CVs, licence photos and attachments are never public. They open only through short-lived links, and staff access is logged.', [], { cls: 'b3', delay: 100 })}
          ${card('clock', 'Audit trail', 'Sign-ins, role changes, hires, refunds and more are written to a log that cannot be edited.', [], { cls: 'b3', delay: 200 })}
          ${card('zap', 'Safe by design', 'Rate limits on sensitive actions, safe retries so nothing is charged twice, and checks at the database as well as the screen.', [], { cls: 'b2' })}
          ${card('refresh', 'Backups', 'Platform administrators can take and restore backups, and maintenance mode shows a clear notice to everyone.', [], { cls: 'b4', delay: 100 })}
        </div>
      </div>
    </section>
    <section class="section section--glass" id="privacy" data-dot="Privacy">
      <div class="wrap center"><div class="sec-head center" data-reveal="up"><span class="eyebrow">Privacy</span><h2 class="h2">Personal data is used for the journey, nothing else.</h2><p class="lead">Applicant details are visible only to the company’s HR team. Passwords are stored as hashes and first passwords must be changed at first sign-in. Read the <a href="/privacy.html" class="grad">privacy policy</a> for the details.</p></div></div>
    </section>
${cta('Questions about security? Ask us directly.')}`,
});

// ================================================================================ ABOUT
add({
  file: 'about.html',
  title: 'About | NTS Digital Solutions',
  desc: 'NTS Digital Solutions builds NTS Transport, a complete platform for bus and coach companies.',
  scene: 'soft',
  body: `${head('About us', 'We build software that keeps journeys moving.', 'NTS Digital Solutions makes NTS Transport, a platform designed with transport operators in mind, from the ticket counter to the head office.')}
    <section class="section" id="story" data-dot="Our story">
      <div class="wrap split2">
        <div data-reveal="left"><span class="eyebrow">Our story</span><h2 class="h2">Why we built it.</h2>
          <p class="lead">Running buses means juggling seats, cash, crews, vehicles and people, usually across paper, phones and spreadsheets. We wanted one system where all of that is connected and simple enough for a busy counter on a Monday morning.</p>
          <p class="lead">So we built NTS Transport: one platform for passengers, staff and owners that works on a phone and carries each company’s own brand.</p></div>
        <div class="stats" style="grid-template-columns:1fr 1fr" data-reveal="right"><div class="card stat"><b data-count="1">0</b><span>platform for the whole operation</span></div><div class="card stat"><b data-count="8">0</b><span>roles ready out of the box</span></div></div>
      </div>
    </section>
    <section class="section section--glass" id="values" data-dot="Values">
      <div class="wrap">
        ${secHead('What guides us', 'How we work.', '', true)}
        <div class="grid grid--3">
          ${card('heart', 'Built for real work', 'We design around the counter, the depot and the road, not around a demo.')}
          ${card('shield', 'Trust first', 'Data isolation, audit trails and privacy are part of every feature.', [], { delay: 100 })}
          ${card('chat', 'Always reachable', `Message us on WhatsApp, call ${PHONE} or email ${EMAIL}. A real person replies.`, [], { delay: 200 })}
        </div>
      </div>
    </section>
${cta('Let us build your journey with you.')}`,
});

// ================================================================================ FAQ
const faqs = [
  [
    'What is NTS Transport?',
    'A web system for bus and coach companies. It handles online and desk booking, QR tickets, dispatch, fleet and crew, recruitment, salaries and reports, with each company’s own branding.',
  ],
  [
    'Do passengers need to install an app?',
    'No. It runs in the browser and can be installed to the home screen like an app. Tickets and notices are available on the phone.',
  ],
  [
    'Can each company have its own look and web address?',
    'Yes. Each company has its own logo, colours, name and page address, and emails carry its brand.',
  ],
  [
    'How do passengers pay?',
    'Online through an integrated payment gateway, at the desk with the methods your agents accept, or through manual methods your company sets up and confirms.',
  ],
  [
    'How are tickets checked at boarding?',
    'Each ticket has a QR code and a barcode. Staff scan with a phone camera or a USB or Bluetooth scanner and get an instant answer.',
  ],
  [
    'Can staff have more than one role?',
    'Yes. A person can hold several roles in the company and switch between them, and they can also act as a passenger.',
  ],
  [
    'How does recruitment work?',
    'Create a job posting for any company role except owner and build the application form with the questions you need. Applicants can add a picture and licence photo. You shortlist, send interview details, hire, or reject, and the applicant is emailed at each step.',
  ],
  [
    'What happens when someone is hired?',
    'A staff profile is created, they receive the company role and an email with their employment details and a default password they must change at first sign-in.',
  ],
  [
    'How do salaries work?',
    'Finance creates salary structures with allowances and deductions and assigns them to staff. Each staff member can see their own breakdown under My salary.',
  ],
  [
    'Is my data safe?',
    'Each company’s data is isolated at the database level, access follows roles, important actions are logged and files are private. See the Security page for more.',
  ],
  [
    'How do I get started?',
    `Message us on WhatsApp at ${PHONE}, call, or email ${EMAIL}. We will walk you through setting up your company.`,
  ],
];
add({
  file: 'faq.html',
  faq: faqs,
  crumb: 'FAQ',
  title: 'FAQ | NTS Transport',
  desc: 'Answers to common questions about NTS Transport: booking, payments, tickets, roles, recruitment, salaries and security.',
  scene: 'soft',
  body: `${head('FAQ', 'Questions, answered.', 'Cannot find yours? Message us on WhatsApp and we will answer it.')}
    <section class="section" id="questions" data-dot="Questions">
      <div class="wrap"><div class="faq">
        ${faqs.map((q, i) => `<details data-reveal="up" data-delay="${(i % 4) * 60}"><summary>${q[0]}</summary><p>${q[1]}</p></details>`).join('')}
      </div></div>
    </section>
${cta('Still have a question?')}`,
});

// ================================================================================ CONTACT
add({
  file: 'contact.html',
  title: 'Contact | NTS Transport',
  desc: `Contact NTS Digital Solutions: ${EMAIL}, ${PHONE}, or chat on WhatsApp.`,
  scene: 'soft',
  body: `${head('Contact', 'Let us talk about your routes.', 'The fastest way to reach us is WhatsApp. You can also call, email or use the form below.')}
    <section class="section" id="reach" data-dot="Reach us">
      <div class="wrap contact">
        <div class="cinfo">
          <a class="card tilt" href="__WA__" target="_blank" rel="noopener noreferrer" data-reveal="left"><span class="ico" style="background:#25d366"><svg viewBox="0 0 32 32" class="wa-ico" aria-hidden="true" style="color:#04210f"><use /></svg></span><span><small>WhatsApp</small><strong>${PHONE}</strong></span></a>
          <a class="card tilt" href="tel:+23231034604" data-reveal="left" data-delay="90">${ico('phone')}<span><small>Call us</small><strong>${PHONE}</strong></span></a>
          <a class="card tilt" href="mailto:${EMAIL}" data-reveal="left" data-delay="180">${ico('mail')}<span><small>Email</small><strong>${EMAIL}</strong></span></a>
          <div class="card" data-reveal="left" data-delay="270"><h3>Before you write</h3><p>Tell us how many vehicles you run, which routes you cover and what you want to improve. We will reply with how the system fits.</p></div>
        </div>
        <form class="card form" id="contact-form" data-kind="CONTACT" data-reveal="right" novalidate>
          <h3 style="margin:0">Send us a message</h3>
          <div class="form__row">
            <label>Your name<input name="name" required minlength="2" maxlength="120" autocomplete="name" /></label>
            <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email" /></label>
          </div>
          <div class="form__row">
            <label>Phone (optional)<input name="phone" type="tel" autocomplete="tel" /></label>
            <label>Company (optional)<input name="company" maxlength="120" autocomplete="organization" /></label>
          </div>
          <label>I am interested in
            <select name="topic"><option value="">Choose…</option><option>Setting up my company</option><option>Booking and ticketing</option><option>Dispatch and fleet</option><option>Recruitment and payroll</option><option>Something else</option></select>
          </label>
          <label>Message<textarea name="message" required minlength="10" maxlength="4000" placeholder="Tell us about your company and what you need"></textarea></label>
          <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off" /></label>
          <div class="form__btns">
            <button class="btn btn--primary" type="submit">Send message</button>
            <a class="btn btn--wa" href="__WA__" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 32 32" class="wa-ico" aria-hidden="true"><use /></svg>Or chat on WhatsApp</a>
          </div>
          <p class="form__status" role="status" aria-live="polite"></p>
          <p class="note">Your message goes straight to our team. We use your details only to reply.</p>
        </form>
      </div>
    </section>`,
});

// ================================================================================ DEMO
add({
  file: 'demo.html',
  title: 'Request a demo | NTS Transport',
  desc: 'Book a live walkthrough of NTS Transport for your bus or coach company. Tell us your fleet and when suits you and we will arrange the demo.',
  scene: 'soft',
  crumb: 'Request a demo',
  body: `${head('Request a demo', 'See NTS Transport on your own routes.', 'A short live walkthrough, shaped around your company. Tell us a little about it and when suits you.')}
    <section class="section" id="demo" data-dot="Request a demo">
      <div class="wrap contact">
        <div class="cinfo">
          <div class="card" data-reveal="left"><h3>What you will see</h3><ul class="ticks"><li>Booking, seat maps and QR tickets</li><li>Dispatch, crew rules and fleet care</li><li>Recruitment, hiring and salaries</li><li>Your own branding on pages and emails</li></ul></div>
          <div class="card" data-reveal="left" data-delay="90"><h3>How it goes</h3><p>We reply within one working day to confirm a time. The demo takes about 30 minutes, on a call or in person, and there is nothing to install.</p></div>
          <a class="card tilt" href="__WA__" target="_blank" rel="noopener noreferrer" data-reveal="left" data-delay="180"><span class="ico" style="background:#25d366"><svg viewBox="0 0 32 32" class="wa-ico" aria-hidden="true" style="color:#04210f"><use /></svg></span><span><small>Prefer WhatsApp?</small><strong>${PHONE}</strong></span></a>
        </div>
        <form class="card form" id="demo-form" data-kind="DEMO" data-reveal="right" novalidate>
          <h3 style="margin:0">Request a demo</h3>
          <div class="form__row">
            <label>Your name<input name="name" required minlength="2" maxlength="120" autocomplete="name" /></label>
            <label>Work email<input name="email" type="email" required maxlength="254" autocomplete="email" /></label>
          </div>
          <div class="form__row">
            <label>Phone or WhatsApp<input name="phone" type="tel" autocomplete="tel" /></label>
            <label>Company<input name="company" required minlength="2" maxlength="120" autocomplete="organization" /></label>
          </div>
          <div class="form__row">
            <label>Fleet size
              <select name="fleetSize"><option value="">Choose…</option><option value="1-5">1 to 5 vehicles</option><option value="6-20">6 to 20 vehicles</option><option value="21-50">21 to 50 vehicles</option><option value="51+">More than 50</option></select>
            </label>
            <label>Your role<input name="role" maxlength="80" placeholder="Owner, manager, dispatcher…" /></label>
          </div>
          <div class="form__row">
            <label>Preferred date<input name="preferredDate" type="date" /></label>
            <label>Preferred time<input name="preferredTime" type="time" /></label>
          </div>
          <label>Anything we should know? (optional)<textarea name="message" maxlength="4000" placeholder="Routes, number of agents, what you want to improve"></textarea></label>
          <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off" /></label>
          <div class="form__btns"><button class="btn btn--accent" type="submit">Request my demo</button></div>
          <p class="form__status" role="status" aria-live="polite"></p>
          <p class="note">We use these details only to arrange your demo and reply to you.</p>
        </form>
      </div>
    </section>`,
});

// ================================================================================ LEGAL
const legal = (file, title, h, blocks) =>
  add({
    file,
    title: `${title} | NTS Transport`,
    desc: `${title} for NTS Transport.`,
    scene: 'soft',
    body: `${head(title, h, 'Last updated: November 2026')}
    <section class="section" style="padding-top:0"><div class="wrap"><article class="card prose">${blocks}</article></div></section>`,
  });
legal(
  'privacy-policy.html',
  'Privacy policy',
  'How we handle personal data.',
  `<p>This page explains, in plain language, how NTS Digital Solutions handles personal information on this website and in the NTS Transport system.</p>
  <h2>This website</h2><p>This website does not use accounts and does not store what you type in the contact form. The form opens WhatsApp or your email app with your message, and what happens next is governed by those services.</p>
  <h2>The NTS Transport system</h2><p>Transport companies that use the system are responsible for the passenger, staff and applicant information they collect. We process it on their behalf to provide the service, keep each company’s data separate and do not sell it.</p>
  <h2>Security</h2><p>Access is limited by role, passwords are stored as hashes, files are private and important actions are logged.</p>
  <h2>Your choices</h2><p>To ask about, correct or remove personal information, contact the company you dealt with, or write to us at ${EMAIL}.</p>
  <h2>Contact</h2><p>${EMAIL} · ${PHONE}</p>`,
);
legal(
  'terms-of-use.html',
  'Terms of use',
  'The ground rules for using this site.',
  `<p>By using this website you agree to these terms.</p>
  <h2>Information only</h2><p>This website describes the NTS Transport system. Descriptions may change as the product improves and do not form a contract. A written agreement sets out the terms of any service we provide.</p>
  <h2>Acceptable use</h2><p>Do not misuse the site, attempt to disrupt it or access it unlawfully.</p>
  <h2>Intellectual property</h2><p>The NTS name, logo, design and content belong to NTS Digital Solutions unless stated otherwise.</p>
  <h2>Liability</h2><p>The site is provided as is, and to the extent allowed by law we are not liable for losses arising from its use.</p>
  <h2>Contact</h2><p>${EMAIL} · ${PHONE}</p>`,
);

// ================================================================================ 404
add({
  file: '404.html',
  title: 'Page not found | NTS Transport',
  noindex: true,
  desc: 'This page does not exist.',
  body: `<section class="err"><div><b class="grad">404</b><h1 class="h2">This route does not exist.</h1><p class="lead" style="margin-inline:auto">The page you looked for has moved or never existed. Let us get you back on the road.</p><div class="hero__cta" style="justify-content:center"><a class="btn btn--primary" href="/">Back to home</a><a class="btn btn--wa" href="__WA__" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 32 32" class="wa-ico" aria-hidden="true"><use /></svg>Chat on WhatsApp</a></div></div></section>`,
});

const WA = `https://wa.me/23231034604?text=${encodeURIComponent('Hello NTS Digital Solutions, I would like to know more about the NTS Transport system.')}`;
// The WhatsApp glyph inside buttons is drawn once and reused, so pages stay small.
const WA_PATH =
  'M16.04 3C9.4 3 4 8.4 4 15.04c0 2.12.55 4.18 1.6 6L4 29l8.14-1.56a12 12 0 0 0 3.9.65h.01C22.68 28.1 28 22.7 28 16.06 28 9.4 22.68 3 16.04 3Zm0 22.07h-.01a10 10 0 0 1-5.1-1.4l-.37-.22-4.83.93.96-4.7-.24-.38a9.98 9.98 0 0 1-1.53-5.3c0-5.52 4.5-10.02 10.04-10.02 5.52 0 10.02 4.5 10.02 10.04 0 5.53-4.5 10.05-10.04 10.05Zm5.5-7.5c-.3-.15-1.78-.88-2.06-.98-.27-.1-.47-.15-.67.15-.2.3-.77.98-.95 1.18-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5a9.1 9.1 0 0 1-1.68-2.08c-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.08-.8.38-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.5.7.3 1.26.48 1.7.62.72.23 1.37.2 1.88.12.57-.08 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35Z';

for (const p of pages) {
  let html = page(p)
    .replaceAll('__WA__', WA)
    .replace(/ data-dot="[^"]*"/g, '')
    .replace(/href="\/([a-z0-9-]+)\.html(#[^"]*)?"/g, 'href="/$1$2"')
    .replace(/href="\/privacy\.html"/g, 'href="/privacy-policy"')
    .replace(/href="\/terms\.html"/g, 'href="/terms-of-use"');
  html = html.replaceAll('<use />', `<path fill="currentColor" d="${WA_PATH}"/>`);
  fs.writeFileSync(OUT + p.file, html);
}
// eslint-disable-next-line no-console
console.log('wrote', pages.length, 'pages');
