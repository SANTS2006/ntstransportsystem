import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../components/ui/ThemeToggle';

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  it('switches to dark and back, and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('nts-theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('nts-theme')).toBe('light');
  });
  it('starts dark when the person chose dark before', () => {
    localStorage.setItem('nts-theme', 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
