import { useEffect } from 'react';

const DEFAULT_TITLE = 'NTS Transport Platform';
const DEFAULT_ICON = '/nts-logo-small.jpg';

function setIcon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.removeAttribute('type'); // the logo may be PNG, JPEG or WebP
  link.href = href;
}

/**
 * On a company's pages the browser tab shows that company: its name as the title and its logo as
 * the tab icon. Leaving the company's pages puts the system's name and icon back.
 */
export function useDocumentBrand(
  company: { name: string; logoUrl: string | null } | null | undefined,
): void {
  const name = company?.name;
  const logo = company?.logoUrl ?? null;
  useEffect(() => {
    if (!name) return;
    document.title = name;
    setIcon(logo ?? DEFAULT_ICON);
    return () => {
      document.title = DEFAULT_TITLE;
      setIcon(DEFAULT_ICON);
    };
  }, [name, logo]);
}
