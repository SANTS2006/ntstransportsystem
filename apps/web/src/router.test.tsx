import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { router } from './router';

/** The layout path (the outermost match) and the page path (the innermost) for an address. */
const where = (path: string) => {
  const m = matchRoutes(router.routes, path);
  return { layout: m?.[0]?.route.path, page: m?.[m.length - 1]?.route.path };
};

describe('company addresses', () => {
  it('serves every role from the company web address, without /app or /c/<id>', () => {
    for (const page of ['dashboard', 'bookings', 'complaints', 'members', 'dispatch', 'profile']) {
      const w = where(`/acme/${page}`);
      expect(w.layout).toBe('/:slug');
      expect(w.page).toBe(page);
    }
    expect(where('/acme/bookings/abc').page).toBe('bookings/:id');
  });

  it('keeps the public site and the sign-in pages on the same address', () => {
    expect(where('/acme').page).toBeUndefined();
    expect(where('/acme/trips').page).toBe('trips');
    expect(where('/acme/jobs').page).toBe('jobs');
    expect(where('/acme/login').page).toBe('/:slug/login');
    expect(where('/acme/forgot-password').page).toBe('/:slug/forgot-password');
    expect(where('/acme/change-password').page).toBe('/:slug/change-password');
  });

  it('sends old addresses to the new ones', () => {
    expect(where('/c/11111111/dashboard').layout).toBe('/c/:tenantId/*');
    expect(where('/acme/app/bookings').layout).toBe('/:slug/app/*');
  });
});
