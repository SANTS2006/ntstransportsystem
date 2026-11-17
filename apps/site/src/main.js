import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './site.css';
import { mountLayout } from './layout.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

mountLayout();
document.documentElement.classList.add('js');

// ---- 3D scene, driven by how far the page has been scrolled ---------------------------------------
let scene = null;
const canvas = document.getElementById('scene');
if (canvas) {
  const later = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
  later(() =>
    import('./scene.js')
      .then(({ initScene }) => {
        scene = initScene(canvas, { reduced });
        if (!scene) document.documentElement.classList.add('no-webgl');
        else {
          document.documentElement.classList.add('has-scene');
          onScroll();
        }
      })
      .catch(() => document.documentElement.classList.add('no-webgl')),
  );
}

// ---- Scroll rail + scroll-linked effects ----------------------------------------------------------
const rail = document.createElement('div');
rail.className = 'rail';
rail.innerHTML = '<i></i>';
document.body.append(rail);
const railBar = rail.firstElementChild;
const header = document.querySelector('.nav');

const parallax = [...document.querySelectorAll('[data-parallax]')];
const hscrolls = [...document.querySelectorAll('[data-hscroll]')];

function sizeHscroll(h) {
  const track = h.querySelector('.hs__track');
  const on = window.matchMedia('(min-width: 900px)').matches;
  h.classList.toggle('hs--on', on);
  if (!on) {
    h.style.height = '';
    track.style.transform = '';
    return;
  }
  const extra = track.scrollWidth - window.innerWidth + 120;
  h.style.height = `${window.innerHeight + Math.max(extra, 0)}px`;
  h._extra = Math.max(extra, 0);
}

function onScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const p = max > 0 ? clamp(window.scrollY / max) : 0;
  railBar.style.transform = `scaleY(${p})`;
  header?.classList.toggle('nav--solid', window.scrollY > 24);
  scene?.setProgress(p);

  const vh = window.innerHeight;
  if (!reduced) {
    for (const el of parallax) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      const f = Number(el.dataset.parallax) || 0.15;
      el.style.setProperty('--py', `${((r.top + r.height / 2 - vh / 2) * f * -1).toFixed(1)}px`);
    }
  }
  for (const h of hscrolls) {
    if (!h.classList.contains('hs--on')) continue;
    const r = h.getBoundingClientRect();
    const q = clamp(-r.top / Math.max(r.height - vh, 1));
    h.querySelector('.hs__track').style.transform =
      `translate3d(${(-q * h._extra).toFixed(1)}px,0,0)`;
    h.style.setProperty('--hp', q.toFixed(3));
  }
  setActiveDot();
}

let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      onScroll();
    });
  },
  { passive: true },
);
window.addEventListener('resize', () => {
  hscrolls.forEach(sizeHscroll);
  onScroll();
});
hscrolls.forEach(sizeHscroll);
window.addEventListener('load', () => {
  hscrolls.forEach(sizeHscroll);
  onScroll();
});

// ---- Section dots (a custom scroll navigator) ------------------------------------------------------
const dotSections = [...document.querySelectorAll('[data-dot]')];
let dots = [];
if (dotSections.length > 1) {
  const nav = document.createElement('nav');
  nav.className = 'dots';
  nav.setAttribute('aria-label', 'Sections on this page');
  dots = dotSections.map((s) => {
    const a = document.createElement('a');
    a.href = `#${s.id}`;
    a.setAttribute('aria-label', s.dataset.dot);
    a.dataset.label = s.dataset.dot;
    nav.append(a);
    return a;
  });
  document.body.append(nav);
}
function setActiveDot() {
  if (!dots.length) return;
  const mid = window.innerHeight * 0.5;
  let active = 0;
  dotSections.forEach((s, i) => {
    if (s.getBoundingClientRect().top <= mid) active = i;
  });
  dots.forEach((d, i) => d.classList.toggle('on', i === active));
}

// ---- Words that rise one by one ---------------------------------------------------------------------
document.querySelectorAll('[data-split]').forEach((el) => {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute('aria-label', words.join(' '));
  el.innerHTML = words
    .map(
      (w, i) =>
        `<span class="w" aria-hidden="true" style="--i:${i}"><span>${w.replace(/&/g, '&amp;')}</span></span>`,
    )
    .join(' ');
  requestAnimationFrame(() => el.classList.add('split--go'));
});

// ---- Reveal on scroll + counters --------------------------------------------------------------------
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.dataset.count !== undefined) count(e.target);
      io.unobserve(e.target);
    }
  },
  { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
);
document.querySelectorAll('[data-reveal], [data-count]').forEach((el) => {
  const d = el.dataset.delay;
  if (d) el.style.setProperty('--d', `${d}ms`);
  if (reduced) el.classList.add('in');
  io.observe(el);
});

function count(el) {
  const end = Number(el.dataset.count);
  const suffix = el.dataset.suffix ?? '';
  if (reduced) {
    el.textContent = `${end}${suffix}`;
    return;
  }
  const t0 = performance.now();
  const dur = 1400;
  const step = (now) => {
    const k = clamp((now - t0) / dur);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = `${Math.round(end * eased)}${suffix}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- 3D tilt and a light that follows the pointer on cards -----------------------------------------
if (fine && !reduced) {
  document.querySelectorAll('.tilt').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });
}

// ---- Contact and demo forms: sent to the platform administrators ----------------------------------------
document.querySelectorAll('form[data-kind]').forEach((form) => {
  const status = form.querySelector('.form__status');
  const say = (text, ok) => {
    status.textContent = text;
    status.dataset.state = ok ? 'ok' : 'error';
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const body = { kind: form.dataset.kind };
    for (const [k, v] of new FormData(form)) {
      const t = String(v).trim();
      if (t) body[k] = t;
    }
    button.disabled = true;
    say('Sending…', true);
    try {
      const res = await fetch('/api/v1/public/inquiries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.reset();
        say(
          form.dataset.kind === 'DEMO'
            ? 'Thank you. We have your request and will reply within one working day to confirm a time.'
            : 'Thank you. Your message has been sent and we will reply soon.',
          true,
        );
      } else {
        const data = await res.json().catch(() => null);
        say(
          data?.error?.message ?? 'We could not send that. Please check the form and try again.',
          false,
        );
      }
    } catch {
      say('We could not reach the server. Please try again, or message us on WhatsApp.', false);
    } finally {
      button.disabled = false;
    }
  });
});
