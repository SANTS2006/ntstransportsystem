import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDocumentBrand } from './document-brand';

function Probe({ company }: { company: { name: string; logoUrl: string | null } | null }) {
  useDocumentBrand(company);
  return null;
}

describe('browser tab branding', () => {
  it("shows the company's name and logo while on its pages, then puts the system's back", () => {
    const { rerender, unmount } = render(
      <Probe
        company={{ name: 'Sierra Express Coaches', logoUrl: '/api/v1/public/companies/s/logo?v=1' }}
      />,
    );
    expect(document.title).toBe('Sierra Express Coaches');
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain(
      '/public/companies/s/logo',
    );
    rerender(<Probe company={null} />);
    expect(document.title).toBe('NTS Transport Platform');
    unmount();
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain(
      '/nts-logo-small.jpg',
    );
  });
});
