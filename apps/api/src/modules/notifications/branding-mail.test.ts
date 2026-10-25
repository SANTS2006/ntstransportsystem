import { describe, expect, it } from 'vitest';
import type { MailBrand } from './mailer.js';
import { platformEmailSchema } from './platform-email.routes.js';
import { renderMail, systemBrand } from './templates.js';

const acme: MailBrand = {
  name: 'Acme Coaches',
  logoUrl: 'https://app.test/api/v1/public/companies/acme/logo?v=1',
  primary: '#aa1122',
  accent: '#22bb33',
  siteUrl: 'https://app.test/acme',
};

describe('branded e-mail', () => {
  it('a company message carries the company name, logo, colours and page', () => {
    const out = renderMail({
      template: 'password-reset',
      data: { link: 'https://app.test/acme/reset-password?token=t' },
      brand: acme,
    });
    expect(out.html).toContain('Acme Coaches');
    expect(out.html).toContain('#aa1122');
    expect(out.html).toContain('/public/companies/acme/logo');
    expect(out.html).toContain('app.test/acme');
    expect(out.html).not.toContain('NTS Transport');
    expect(out.text).toContain('Acme Coaches');
  });

  it('a message with no brand comes from the system', () => {
    const out = renderMail({
      template: 'password-reset',
      data: { link: 'https://app.test/reset-password?token=t' },
      brand: systemBrand('https://app.test'),
    });
    expect(out.html).toContain('NTS Transport');
    expect(out.html).toContain('#0075df');
    expect(out.html).toContain('/nts-wordmark.png');
  });

  it('refuses a colour that is not a plain hex value', () => {
    const out = renderMail({
      template: 'password-reset',
      data: { link: 'https://app.test/x' },
      brand: { ...acme, primary: 'red;}</style><script>x</script>' },
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('#0075df');
  });

  it('the staff welcome lists the details, the first password and the sign-in link', () => {
    const out = renderMail({
      template: 'staff-added',
      brand: acme,
      data: {
        company: 'Acme Coaches',
        name: 'Ada <b>Lovelace</b>',
        email: 'ada@example.com',
        phone: '+23276123456',
        employeeNumber: 'E-12',
        job: 'Driver',
        password: 'Temp-Pass-123',
        link: 'https://app.test/acme/login',
      },
    });
    expect(out.subject).toContain('Acme Coaches');
    expect(out.html).toContain('Temp-Pass-123');
    expect(out.html).toContain('E-12');
    expect(out.html).toContain('https://app.test/acme/login');
    expect(out.html).not.toContain('<b>Lovelace</b>');
    expect(out.text).toContain('Temp-Pass-123');
  });

  it('the staff welcome for an existing account has no password', () => {
    const out = renderMail({
      template: 'staff-added',
      brand: acme,
      data: {
        company: 'Acme Coaches',
        name: 'Ada',
        email: 'a@b.co',
        password: '',
        link: 'https://app.test/acme/login',
      },
    });
    expect(out.html).not.toContain('Temporary password');
    expect(out.text).toContain('usual password');
  });

  it('a platform message escapes the text and uses its subject', () => {
    const out = renderMail({
      template: 'platform-message',
      data: { subject: 'Maintenance', message: 'Line one\n\n<script>alert(1)</script>' },
      brand: systemBrand('https://app.test'),
    });
    expect(out.subject).toBe('Maintenance');
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

describe('platform e-mail request', () => {
  const ok = {
    tenantId: '2f6f3f7e-5d5b-4b4e-9d57-6c3d4a2d1f10',
    subject: 'Hello',
    message: 'Body',
  };
  it('accepts a message with documents, photos and videos', () => {
    const parsed = platformEmailSchema.parse({
      ...ok,
      attachments: [
        { name: 'terms.pdf', contentBase64: 'QUJD' },
        { name: 'photo.jpg', contentBase64: 'QUJD' },
        { name: 'clip.mp4', contentBase64: 'QUJD' },
      ],
    });
    expect(parsed.attachments).toHaveLength(3);
  });
  it('refuses programs and path tricks', () => {
    for (const name of ['run.exe', '../x.pdf', 'a/b.pdf', 'noext']) {
      expect(
        platformEmailSchema.safeParse({ ...ok, attachments: [{ name, contentBase64: 'QUJD' }] })
          .success,
      ).toBe(false);
    }
  });
});
