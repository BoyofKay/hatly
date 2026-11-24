import { driverRiskLimits } from '../delivery/driver-financial-risk';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export interface DriverAllowanceView {
  id: string;
  amountMinor: number;
  status: 'OUT' | 'RETURNED' | 'CANCELLED';
  note: string | null;
  handedAt: string;
  handedBy: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  closingReference: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
/** TypeORM returns `[rows, count]` for UPDATE … RETURNING on Postgres and plain rows for SELECT/INSERT. */
const affected = <T = unknown>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as T[]) : Array.isArray(r) ? (r as T[]) : []);
const MAX_ALLOWANCE_MINOR = 10_000_000; // 100,000 EGP — a typo guard, not a business limit

/**
 * Daily driver allowance (owner decision 2026-11-23, "العهدة اليومية"): cash handed to a driver so he can pay stores for orders. It is his
 * liability: it carries across operational shifts; it is returned at the office ("Allowance returned") or
 * by the courier closing, which returns it together with the orders' money. Kept as its own ledger — the closing's order figures
 * (net payable, lines) are never changed by it.
 */
@Injectable()
export class DriverAllowanceService {
  constructor(private readonly ds: DataSource) {}

  /** What the driver holds right now (sum of OUT allowances). */
  static async outstandingMinor(m: Pick<EntityManager, 'query'>, driverId: string): Promise<number> {
    const [r] = await m.query(`SELECT coalesce(sum(amount_minor), 0) AS s FROM driver_allowances WHERE driver_id = $1 AND status = 'OUT'`, [driverId]).catch(() => [{ s: 0 }]);
    return Number(r?.s ?? 0);
  }

  async list(driverId: string, limit = 30): Promise<{ outstandingMinor: number; items: DriverAllowanceView[] }> {
    await this.mustBeDriver(driverId);
    const rows = await this.ds.query(
      `SELECT a.*, hb.full_name AS handed_by, rb.full_name AS returned_by, p.reference AS closing_reference
         FROM driver_allowances a
         LEFT JOIN users hb ON hb.id = a.handed_by_user_id
         LEFT JOIN users rb ON rb.id = a.returned_by_user_id
         LEFT JOIN driver_settlement_periods p ON p.id = a.closing_period_id
        WHERE a.driver_id = $1 ORDER BY a.handed_at DESC LIMIT $2`,
      [driverId, Math.min(Math.max(limit, 1), 200)],
    );
    return { outstandingMinor: await DriverAllowanceService.outstandingMinor(this.ds, driverId), items: rows.map(this.view) };
  }

  /** The office hands cash to the driver (linked to his open shift, if any). */
  async hand(driverId: string, amountMinor: number, actorUserId: string, note?: string): Promise<DriverAllowanceView> {
    await this.mustBeDriver(driverId);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_ALLOWANCE_MINOR) {
      throw new BadRequestException({ message: 'Enter the amount handed to the driver (more than 0).', details: { code: 'INVALID_AMOUNT' } });
    }
    const row = await this.ds.transaction(async m=>{
      await m.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE',[driverId]);
      const {allowanceCapMinor}=await driverRiskLimits(m);
      const [balance]=await m.query("SELECT coalesce(sum(amount_minor),0) AS total FROM driver_allowances WHERE driver_id=$1 AND status='OUT'",[driverId]);
      const outstanding=Number(balance?.total??0);
      if(allowanceCapMinor!==null&&outstanding+amountMinor>allowanceCapMinor) throw new ConflictException({
        message:'This allowance would exceed the configured maximum outstanding allowance.',
        details:{code:'DRIVER_ALLOWANCE_CAP',outstandingMinor:outstanding,capMinor:allowanceCapMinor}
      });
      const [saved]=await m.query(
      `INSERT INTO driver_allowances (driver_id, amount_minor, note, handed_by_user_id, shift_id)
       VALUES ($1, $2, $3, $4, (SELECT id FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL))
       RETURNING id`,
      [driverId, amountMinor, note?.trim().slice(0, 200) || null, actorUserId],
      );
      return saved;
    });
    return this.one(row.id);
  }

  /** The driver handed the allowance back at the office (in full). */
  async markReturned(allowanceId: string, actorUserId: string): Promise<DriverAllowanceView> {
    const rows = await this.ds.query(
      `UPDATE driver_allowances SET status = 'RETURNED', returned_at = now(), returned_by_user_id = $2, updated_at = now() WHERE id = $1 AND status = 'OUT' RETURNING id`,
      [allowanceId, actorUserId],
    );
    if (affected(rows).length === 0) await this.notOut(allowanceId);
    return this.one(allowanceId);
  }

  /** Recorded by mistake (never handed): cancelled with a reason. */
  async cancel(allowanceId: string, actorUserId: string, reason: string): Promise<DriverAllowanceView> {
    if (!reason?.trim()) throw new BadRequestException({ message: 'Give the reason for cancelling.', details: { code: 'REASON_REQUIRED' } });
    const rows = await this.ds.query(
      `UPDATE driver_allowances SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_user_id = $2, cancel_reason = $3, updated_at = now() WHERE id = $1 AND status = 'OUT' RETURNING id`,
      [allowanceId, actorUserId, reason.trim().slice(0, 200)],
    );
    if (affected(rows).length === 0) await this.notOut(allowanceId);
    return this.one(allowanceId);
  }

  /** Used by the courier closing (same transaction): every OUT allowance is returned with the closing. Returns the amount. */
  static async returnWithClosing(m: EntityManager, driverId: string, periodId: string, actorUserId: string): Promise<number> {
    const rows: Array<{ amount_minor: string }> = await m.query(
      `UPDATE driver_allowances SET status = 'RETURNED', returned_at = now(), returned_by_user_id = $3, closing_period_id = $2, updated_at = now()
        WHERE driver_id = $1 AND status = 'OUT' RETURNING amount_minor`,
      [driverId, periodId, actorUserId],
    );
    return affected<{ amount_minor: string }>(rows).reduce((s, r) => s + Number(r.amount_minor), 0);
  }

  private async notOut(id: string): Promise<never> {
    const [r] = await this.ds.query(`SELECT status FROM driver_allowances WHERE id = $1`, [id]);
    if (!r) throw new NotFoundException('Allowance not found.');
    throw new ConflictException({ message: `This allowance is already ${String(r.status).toLowerCase()}.`, details: { code: 'ALLOWANCE_NOT_OUT', status: r.status } });
  }

  private async mustBeDriver(driverId: string): Promise<void> {
    const [d] = await this.ds.query(`SELECT 1 FROM drivers WHERE id = $1 AND deleted_at IS NULL`, [driverId]);
    if (!d) throw new NotFoundException('Driver not found.');
  }

  private async one(id: string): Promise<DriverAllowanceView> {
    const [r] = await this.ds.query(
      `SELECT a.*, hb.full_name AS handed_by, rb.full_name AS returned_by, p.reference AS closing_reference
         FROM driver_allowances a LEFT JOIN users hb ON hb.id = a.handed_by_user_id LEFT JOIN users rb ON rb.id = a.returned_by_user_id
         LEFT JOIN driver_settlement_periods p ON p.id = a.closing_period_id WHERE a.id = $1`,
      [id],
    );
    return this.view(r);
  }

  private view = (r: any): DriverAllowanceView => ({
    id: r.id,
    amountMinor: Number(r.amount_minor),
    status: r.status,
    note: r.note ?? null,
    handedAt: iso(r.handed_at)!,
    handedBy: r.handed_by ?? null,
    returnedAt: iso(r.returned_at),
    returnedBy: r.returned_by ?? null,
    closingReference: r.closing_reference ?? null,
    cancelledAt: iso(r.cancelled_at),
    cancelReason: r.cancel_reason ?? null,
  });
}
