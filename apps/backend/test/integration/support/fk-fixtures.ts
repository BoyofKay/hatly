import { randomUUID } from 'crypto';
import { DataSource, EntityMetadata } from 'typeorm';
import { TestData } from './test-data';
import { ADDED_FOREIGN_KEYS } from './referential-integrity';
import { Role } from '../../../src/common/enums/role.enum';
import { FinancialEvent } from '../../../src/modules/finance/entities/financial-event.entity';
import { EmployeeLoan } from '../../../src/modules/finance/entities/employee-loan.entity';

/** Builds fully valid rows (every reference column pointing at its OWN fresh parent row) for each table that received a foreign key. */
export function foreignKeyFixtures(getDs: () => DataSource, getData: () => TestData) {
  const unique = () => randomUUID();
  const meta = (table: string): EntityMetadata => getDs().entityMetadatas.find((m) => m.tableName === table)!;
  const prop = (table: string, column: string): string => meta(table).columns.find((c) => c.databaseName === column)!.propertyName;

  async function parentId(table: string): Promise<string> {
    switch (table) {
      case 'users':
        return (await getData().user()).id;
      case 'orders':
        return (await getData().order((await getData().user()).id)).id;
      case 'drivers':
        return (await getData().driver((await getData().user({ role: Role.DRIVER })).id)).id;
      case 'deliveries':
        return (await getData().delivery((await getData().order((await getData().user()).id)).id)).id;
      case 'vendor_branches':
        return (await getData().vendorBranch()).id;
      case 'order_vendor_segments': {
        const branch = await getData().vendorBranch();
        return (await getData().segment((await getData().order((await getData().user()).id)).id, branch.id)).id;
      }
      case 'payments':
        return (await getData().payment((await getData().order((await getData().user()).id)).id)).id;
      case 'financial_events':
        return (
          await getData().save<FinancialEvent>(FinancialEvent, { type: 'FAILED_DELIVERY_RECORDED', direction: 'INFORMATIONAL', idempotencyKey: `parent-${unique()}` } as never)
        ).id;
      default:
        throw new Error(`no parent factory for ${table}`);
    }
  }

  /** A fully valid property bag for `table`: every reference column filled with its OWN fresh parent row. */
  async function validProps(table: string): Promise<Record<string, unknown>> {
    const props: Record<string, unknown> = {};
    for (const fk of ADDED_FOREIGN_KEYS.filter((f) => f.table === table)) props[prop(table, fk.column)] = await parentId(fk.references);
    const now = new Date();
    switch (table) {
      case 'wallet_transactions':
        return { ...props, amountDeltaMinor: 100, type: 'ADMIN_CREDIT', reason: 'ri', idempotencyKey: `ri-${unique()}` };
      case 'loyalty_points_transactions':
        return { ...props, pointsDelta: 10, type: 'ADMIN_ADJUSTMENT', reason: 'ri', idempotencyKey: `ri-${unique()}` };
      case 'driver_cash_remainders':
        return { ...props, remainderAmountMinor: 500, submittedAt: now };
      case 'failed_delivery_resolutions':
        return { ...props, outcome: 'RESOLVED_NO_REFUND', resolvedAt: now };
      case 'financial_events':
        return { ...props, type: 'FAILED_DELIVERY_RECORDED', direction: 'INFORMATIONAL', idempotencyKey: `ri-${unique()}` };
      case 'vendor_settlement_periods':
      case 'driver_settlement_periods':
        return { ...props, frequency: 'MONTHLY', periodStart: now, periodEnd: new Date(now.getTime() + 1000) };
      case 'employee_loans':
        return { ...props, employeeUserId: (await getData().user()).id, borrowedAmountMinor: 1_000, issuedAt: now };
      case 'employee_loan_repayments': {
        const loan = await getData().save<EmployeeLoan>(EmployeeLoan, {
          employeeUserId: (await getData().user()).id, borrowedAmountMinor: 1_000, issuedAt: now, issuedByUserId: (await getData().user()).id,
        });
        return { ...props, employeeLoanId: loan.id, amountMinor: 100, repaidAt: now };
      }
      case 'ad_hoc_purchase_records': {
        const branch = await getData().vendorBranch();
        const order = await getData().order((await getData().user()).id);
        const item = await getData().item((await getData().segment(order.id, branch.id)).id);
        return { ...props, orderItemId: item.id, amountMinor: 250, recordedByRole: 'VENDOR' };
      }
      case 'device_tokens':
        return { ...props, token: `tok-${unique()}`, platform: 'android' };
      default:
        throw new Error(`no fixture for ${table}`);
    }
  }


  return { meta, prop, parentId, validProps, unique };
}
