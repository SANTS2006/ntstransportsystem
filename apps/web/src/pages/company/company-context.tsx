import { createContext, useContext } from 'react';

export interface CompanyAccess {
  role: { key: string };
  tenantStatus: string;
  permissions: string[];
}

export const AccessContext = createContext<{ tenantId: string; access: CompanyAccess } | null>(
  null,
);

export function useCompany() {
  const c = useContext(AccessContext);
  if (!c) throw new Error('Outside company layout');
  return c;
}

/** UI gating only: the API independently enforces every permission. */
export const can = (access: CompanyAccess, permission: string) =>
  access.permissions.includes(permission);
