import { withDb, type Db, type Tx } from '../../platform/db.js';
import { mapDbErrors } from '../../platform/db-errors.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { TenantScope } from '../tenants/tenant.guards.js';

export type DeductionKind = 'FIXED' | 'PERCENT';

export interface AllowanceInput {
  name: string;
  amountMinor: number;
}
export interface StructureInput {
  name: string;
  baseMinor: number;
  description?: string | undefined;
  allowances: AllowanceInput[];
}
export interface DeductionInput {
  name: string;
  kind: DeductionKind;
  /** FIXED: minor units. PERCENT: basis points of gross pay (100 = 1%). */
  value: number;
  description?: string | undefined;
}

export interface Breakdown {
  currency: string;
  structure: { id: string; name: string } | null;
  baseMinor: number;
  allowances: { id: string; name: string; amountMinor: number }[];
  totalAllowancesMinor: number;
  grossMinor: number;
  deductions: {
    id: string;
    name: string;
    kind: DeductionKind;
    value: number;
    amountMinor: number;
  }[];
  totalDeductionsMinor: number;
  netMinor: number;
}

const ctxOf = (s: TenantScope) => ({ tenantId: s.tenantId, userId: s.userId });

/** Pure arithmetic of a payslip: gross = base + allowances; percentage deductions are of gross. */
export function computeBreakdown(input: {
  currency: string;
  structure: { id: string; name: string; baseMinor: number } | null;
  allowances: { id: string; name: string; amountMinor: number }[];
  deductions: { id: string; name: string; kind: DeductionKind; value: number }[];
}): Breakdown {
  const baseMinor = input.structure?.baseMinor ?? 0;
  const totalAllowancesMinor = input.allowances.reduce((n, a) => n + a.amountMinor, 0);
  const grossMinor = baseMinor + totalAllowancesMinor;
  const deductions = input.deductions.map((d) => ({
    ...d,
    amountMinor: d.kind === 'FIXED' ? d.value : Math.round((grossMinor * d.value) / 10_000),
  }));
  const totalDeductionsMinor = deductions.reduce((n, d) => n + d.amountMinor, 0);
  return {
    currency: input.currency,
    structure: input.structure ? { id: input.structure.id, name: input.structure.name } : null,
    baseMinor,
    allowances: input.allowances,
    totalAllowancesMinor,
    grossMinor,
    deductions,
    totalDeductionsMinor,
    netMinor: grossMinor - totalDeductionsMinor,
  };
}

export class SalaryService {
  constructor(private readonly db: Db) {}

  private audit(
    tx: Tx,
    s: TenantScope,
    action: string,
    targetId: string,
    requestId?: string,
    summary?: Record<string, string | number | boolean | null>,
  ) {
    return writeAudit(tx, {
      action,
      outcome: 'SUCCESS',
      tenantId: s.tenantId,
      actorUserId: s.userId,
      targetType: 'salary',
      targetId,
      requestId,
      ...(summary ? { summary } : {}),
    });
  }

  private async currency(tx: Tx, tenantId: string) {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });
    return t.defaultCurrency;
  }

  // ---- Structures ----------------------------------------------------------------------------

  private structureDto(st: {
    id: string;
    name: string;
    baseMinor: number;
    description: string | null;
    allowances: { id: string; name: string; amountMinor: number }[];
    _count?: { assignments: number };
  }) {
    const allowances = st.allowances.map((a) => ({
      id: a.id,
      name: a.name,
      amountMinor: a.amountMinor,
    }));
    return {
      id: st.id,
      name: st.name,
      baseMinor: st.baseMinor,
      description: st.description,
      allowances,
      grossMinor: st.baseMinor + allowances.reduce((n, a) => n + a.amountMinor, 0),
      staffCount: st._count?.assignments ?? 0,
    };
  }

  async listStructures(s: TenantScope) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const [rows, currency] = await Promise.all([
        tx.salaryStructure.findMany({
          where: { tenantId: s.tenantId },
          include: {
            allowances: { orderBy: { name: 'asc' } },
            _count: { select: { assignments: true } },
          },
          orderBy: { name: 'asc' },
        }),
        this.currency(tx, s.tenantId),
      ]);
      return { currency, structures: rows.map((r) => this.structureDto(r)) };
    });
  }

  async createStructure(s: TenantScope, input: StructureInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const st = await tx.salaryStructure.create({
            data: {
              tenantId: s.tenantId,
              name: input.name,
              baseMinor: input.baseMinor,
              description: input.description ?? null,
              allowances: {
                create: input.allowances.map((a) => ({
                  tenantId: s.tenantId,
                  name: a.name,
                  amountMinor: a.amountMinor,
                })),
              },
            },
            include: { allowances: true },
          });
          await this.audit(tx, s, 'salary.structure_created', st.id, requestId);
          return this.structureDto(st);
        }),
      {
        unique: 'A salary structure with this name already exists',
        check: 'The name or an amount is out of range',
      },
    );
  }

  async updateStructure(s: TenantScope, id: string, input: StructureInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const found = await tx.salaryStructure.findFirst({ where: { id, tenantId: s.tenantId } });
          if (!found) throw AppError.notFound();
          await tx.salaryAllowance.deleteMany({ where: { tenantId: s.tenantId, structureId: id } });
          const st = await tx.salaryStructure.update({
            where: { id },
            data: {
              name: input.name,
              baseMinor: input.baseMinor,
              description: input.description ?? null,
              allowances: {
                create: input.allowances.map((a) => ({
                  tenantId: s.tenantId,
                  name: a.name,
                  amountMinor: a.amountMinor,
                })),
              },
            },
            include: { allowances: true },
          });
          await this.audit(tx, s, 'salary.structure_updated', id, requestId);
          return this.structureDto(st);
        }),
      {
        unique: 'A salary structure with this name already exists',
        check: 'The name or an amount is out of range',
      },
    );
  }

  async deleteStructure(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const found = await tx.salaryStructure.findFirst({
        where: { id, tenantId: s.tenantId },
        include: { _count: { select: { assignments: true } } },
      });
      if (!found) throw AppError.notFound();
      if (found._count.assignments > 0) {
        throw AppError.conflict(
          `${found._count.assignments} staff member(s) use this structure. Give them another one first.`,
        );
      }
      await tx.salaryStructure.delete({ where: { id } });
      await this.audit(tx, s, 'salary.structure_deleted', id, requestId);
    });
  }

  // ---- Deductions ----------------------------------------------------------------------------

  async listDeductions(s: TenantScope) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const [rows, currency] = await Promise.all([
        tx.salaryDeduction.findMany({
          where: { tenantId: s.tenantId },
          include: { _count: { select: { assignments: true } } },
          orderBy: { name: 'asc' },
        }),
        this.currency(tx, s.tenantId),
      ]);
      return {
        currency,
        deductions: rows.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          value: d.value,
          description: d.description,
          staffCount: d._count.assignments,
        })),
      };
    });
  }

  async createDeduction(s: TenantScope, input: DeductionInput, requestId?: string) {
    return mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const d = await tx.salaryDeduction.create({
            data: {
              tenantId: s.tenantId,
              name: input.name,
              kind: input.kind,
              value: input.value,
              description: input.description ?? null,
            },
          });
          await this.audit(tx, s, 'salary.deduction_created', d.id, requestId);
          return { id: d.id };
        }),
      {
        unique: 'A deduction with this name already exists',
        check: 'The name or value is out of range (a percentage is at most 100%)',
      },
    );
  }

  async updateDeduction(s: TenantScope, id: string, input: DeductionInput, requestId?: string) {
    await mapDbErrors(
      () =>
        withDb(this.db, ctxOf(s), async (tx) => {
          const res = await tx.salaryDeduction.updateMany({
            where: { id, tenantId: s.tenantId },
            data: {
              name: input.name,
              kind: input.kind,
              value: input.value,
              description: input.description ?? null,
            },
          });
          if (res.count !== 1) throw AppError.notFound();
          await this.audit(tx, s, 'salary.deduction_updated', id, requestId);
        }),
      {
        unique: 'A deduction with this name already exists',
        check: 'The name or value is out of range (a percentage is at most 100%)',
      },
    );
  }

  async deleteDeduction(s: TenantScope, id: string, requestId?: string) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const res = await tx.salaryDeduction.deleteMany({ where: { id, tenantId: s.tenantId } });
      if (res.count !== 1) throw AppError.notFound();
      await this.audit(tx, s, 'salary.deduction_deleted', id, requestId);
    });
  }

  // ---- Assignment ----------------------------------------------------------------------------

  private async breakdownOf(tx: Tx, tenantId: string, staffId: string, currency: string) {
    const salary = await tx.staffSalary.findFirst({
      where: { tenantId, staffId },
      include: { structure: { include: { allowances: { orderBy: { name: 'asc' } } } } },
    });
    const deds = await tx.staffDeduction.findMany({
      where: { tenantId, staffId },
      include: { deduction: true },
    });
    return computeBreakdown({
      currency,
      structure: salary
        ? {
            id: salary.structure.id,
            name: salary.structure.name,
            baseMinor: salary.structure.baseMinor,
          }
        : null,
      allowances: salary?.structure.allowances ?? [],
      deductions: deds
        .map((d) => d.deduction)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ id: d.id, name: d.name, kind: d.kind, value: d.value })),
    });
  }

  /** Everyone on the staff register with what they are paid, for the finance officer. */
  async listStaff(s: TenantScope) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const currency = await this.currency(tx, s.tenantId);
      const people = await tx.staffProfile.findMany({
        where: { tenantId: s.tenantId, status: { not: 'TERMINATED' } },
        orderBy: { fullName: 'asc' },
        take: 500,
      });
      const staff = [];
      for (const p of people) {
        const b = await this.breakdownOf(tx, s.tenantId, p.id, currency);
        staff.push({
          id: p.id,
          staffNumber: p.staffNumber,
          fullName: p.fullName,
          job: p.role,
          structure: b.structure,
          deductionIds: b.deductions.map((d) => d.id),
          deductionNames: b.deductions.map((d) => d.name),
          grossMinor: b.grossMinor,
          netMinor: b.netMinor,
        });
      }
      return { currency, staff };
    });
  }

  async staffBreakdown(s: TenantScope, staffId: string) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const p = await tx.staffProfile.findFirst({ where: { id: staffId, tenantId: s.tenantId } });
      if (!p) throw AppError.notFound();
      const currency = await this.currency(tx, s.tenantId);
      return {
        staff: { id: p.id, fullName: p.fullName, staffNumber: p.staffNumber },
        ...(await this.breakdownOf(tx, s.tenantId, p.id, currency)),
      };
    });
  }

  /** Sets the structure (or none) and replaces the deductions a staff member has. */
  async assign(
    s: TenantScope,
    staffId: string,
    input: { structureId: string | null; deductionIds: string[] },
    requestId?: string,
  ) {
    await withDb(this.db, ctxOf(s), async (tx) => {
      const p = await tx.staffProfile.findFirst({ where: { id: staffId, tenantId: s.tenantId } });
      if (!p) throw AppError.notFound();
      if (p.status === 'TERMINATED') throw AppError.conflict('This person has left the company');
      if (input.structureId) {
        const st = await tx.salaryStructure.findFirst({
          where: { id: input.structureId, tenantId: s.tenantId },
          select: { id: true },
        });
        if (!st) throw AppError.validation('Salary structure not found');
      }
      const ids = [...new Set(input.deductionIds)];
      if (ids.length) {
        const n = await tx.salaryDeduction.count({
          where: { tenantId: s.tenantId, id: { in: ids } },
        });
        if (n !== ids.length) throw AppError.validation('A deduction was not found');
      }
      if (input.structureId) {
        await tx.staffSalary.upsert({
          where: { tenantId_staffId: { tenantId: s.tenantId, staffId } },
          update: { structureId: input.structureId },
          create: { tenantId: s.tenantId, staffId, structureId: input.structureId },
        });
      } else {
        await tx.staffSalary.deleteMany({ where: { tenantId: s.tenantId, staffId } });
      }
      await tx.staffDeduction.deleteMany({ where: { tenantId: s.tenantId, staffId } });
      if (ids.length) {
        await tx.staffDeduction.createMany({
          data: ids.map((deductionId) => ({ tenantId: s.tenantId, staffId, deductionId })),
        });
      }
      await this.audit(tx, s, 'salary.assigned', staffId, requestId, {
        structure: input.structureId,
        deductions: ids.length,
      });
    });
  }

  /** The signed-in staff member's own payslip breakdown. */
  async mine(s: TenantScope) {
    return withDb(this.db, ctxOf(s), async (tx) => {
      const p = await tx.staffProfile.findFirst({
        where: { tenantId: s.tenantId, userId: s.userId },
      });
      if (!p) return { assigned: false as const, reason: 'no-profile' as const };
      const currency = await this.currency(tx, s.tenantId);
      const b = await this.breakdownOf(tx, s.tenantId, p.id, currency);
      if (!b.structure) return { assigned: false as const, reason: 'no-structure' as const };
      return {
        assigned: true as const,
        staff: { fullName: p.fullName, staffNumber: p.staffNumber, job: p.role },
        ...b,
      };
    });
  }
}
