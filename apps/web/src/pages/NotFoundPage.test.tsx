import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Dialog } from '../components/ui/Dialog';
import NotFoundPage from './NotFoundPage';

describe('not found page', () => {
  it('offers a way home and a way to sign in', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
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
