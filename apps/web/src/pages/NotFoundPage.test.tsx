import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Dialog } from '../components/ui/Dialog';
import NotFoundPage from './NotFoundPage';

describe('not found page', () => {
  it("the system's page offers only the main sign-in page", () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
  });

  it("a company's page wears the company and leads only to its own sign-in page", () => {
    render(
      <MemoryRouter>
        <NotFoundPage
          company={{
            name: 'Acme Coaches',
            slug: 'acme',
            logoUrl: '/api/v1/public/companies/acme/logo?v=1',
            primaryColor: '#0b6e4f',
            accentColor: null,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('img', { name: 'Acme Coaches' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute(
      'href',
      '/acme/login',
    );
    expect(document.title).toBe('Acme Coaches');
  });
});

describe('dialog', () => {
  it('is forty percent of the screen wide on large screens, and closable', () => {
    render(
      <Dialog open={false} title="Add an employee" onClose={() => undefined}>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = document.querySelector('dialog');
    expect(dialog?.className).toContain('md:w-[40vw]');
    expect(dialog?.className).toContain('w-[94vw]');
  });
});
