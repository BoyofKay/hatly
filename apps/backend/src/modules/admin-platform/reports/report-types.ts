import { Permission } from '../../permissions/permission.enum';

export type ColType = 'text' | 'int' | 'money' | 'percent' | 'date' | 'datetime' | 'enum' | 'bool';

export interface ReportColumn {
  key: string;
  en: string;
  ar: string;
  type: ColType;
  /** Customer personal data: masked unless the caller holds VIEW_CUSTOMER_PII (identically in the preview and in every export). */
  pii?: 'name' | 'phone';
  /** Totals row: `sum` adds the column over the WHOLE filtered set (computed by the database, never from the visible page). */
  total?: 'sum';
}

export interface ReportParam {
  key: string;
  type: 'date' | 'enum' | 'uuid' | 'text';
  en: string;
  ar: string;
  options?: string[];
}

export interface ReportContext {
  /** Runs a SELECT and returns the rows. */
  query: (sql: string, values: unknown[]) => Promise<any[]>;
}

export interface ReportDefinition {
  id: string;
  family: 'EXECUTIVE' | 'SALES' | 'OPERATIONS' | 'CATALOG' | 'CUSTOMERS' | 'FLEET' | 'FINANCE' | 'MARKETING' | 'SECURITY';
  en: string;
  ar: string;
  descriptionEn: string;
  descriptionAr: string;
  /** ALL of these (plus VIEW_REPORTS where listed) are required to view the report. */
  view: Permission[];
  /** Money columns are returned only to a caller holding this (default VIEW_FINANCIALS). */
  moneyPermission: Permission;
  exportPermission: Permission;
  params: ReportParam[];
  columns: ReportColumn[];
  /** SQL producing the FULL ordered row set, columns aliased to `columns[].key`. Values are positional ($1..). Params are pre-validated. */
  build?: (params: Record<string, string>) => { sql: string; values: unknown[] };
  /** Alternative for reports that are not a single SELECT (e.g. the executive KPI snapshot). */
  rows?: (params: Record<string, string>, ctx: ReportContext) => Promise<Array<Record<string, unknown>>>;
  /** SUPER_ADMIN only (cannot be granted by permission). */
  superAdminOnly?: boolean;
  /** Largest row count accepted for an export of this report. */
  maxRows?: number;
}
