import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SettlementClosingService } from '../finance/settlement-closing.service';
import { DriverAllowanceService } from '../finance/driver-allowance.service';
import { DriverAuthorizationService } from './driver-authorization.service';
import { ACTIVE_DELIVERY_CONDITION, recomputeDriverAvailability } from './driver-capacity';

/** A shift open longer than this is flagged to Operations (owner decision 2026-11-22). */
export const LONG_SHIFT_HOURS = 14;

export interface ShiftView {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: 'DRIVER' | 'CLOSING' | 'SUPERVISOR' | null;
  minutes: number;
  closingPeriodId: string | null;
}

export interface ShiftState {
  onDuty: boolean;
  acceptingNewOrders: boolean;
  shift: ShiftView | null;
  /** Can the driver end the shift themselves right now, and if not, why (shown in the app). */
  canEnd: { ok: boolean; reason: 'HAS_ACTIVE_ORDERS' | 'NOT_SETTLED' | 'ALLOWANCE_OUT' | 'NO_OPEN_SHIFT' | null; activeOrders: number; unsettledOrders: number };
  /** Daily driver allowance he holds (cash for paying stores) — independent of shift closure. */
  allowanceOutMinor: number;
  longShift: boolean;
}

const view = (r: any): ShiftView => ({
  id: r.id,
  startedAt: new Date(r.started_at).toISOString(),
  endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  endedBy: r.ended_by ?? null,
  minutes: Math.max(0, Math.round(((r.ended_at ? new Date(r.ended_at) : new Date()).getTime() - new Date(r.started_at).getTime()) / 60_000)),
  closingPeriodId: r.closing_period_id ?? null,
});

/**
 * Driver shifts (owner decision 2026-11-22) — "Start shift / End shift" (on duty / off duty, في الخدمة / خارج الخدمة):
 *  - Start: opens a shift (one at a time), puts the driver on duty and taking new orders.
 *  - End (by the driver): only with no active responsibility. Financial liabilities carry forward independently.
 *  - "Stop new orders": the driver keeps their shift and current orders but receives nothing new (so they can finish and end).
 *  - Financial closing does not end shifts.
 *  - A supervisor can force-end a shift (lost phone, left without closing).
 * The old online switch (older driver apps) still works: switching online opens a shift if none is open.
 */
@Injectable()
export class DriverShiftService {
  constructor(
    private readonly ds: DataSource,
    private readonly driverAuthorizationService: DriverAuthorizationService,
    private readonly settlementClosingService: SettlementClosingService,
  ) {}

  async stateForUser(userId: string): Promise<ShiftState> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    return this.state(driver.id);
  }

  async state(driverId: string): Promise<ShiftState> {
    const [d] = await this.ds.query(`SELECT is_online, accepting_new_orders FROM drivers WHERE id = $1`, [driverId]);
    if (!d) throw new NotFoundException('Driver not found.');
    const [open] = await this.ds.query(`SELECT * FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL`, [driverId]);
    const activeOrders = await this.activeOrders(driverId);
    const unsettledOrders = await this.unsettledOrders(driverId);
    const allowanceOutMinor = await DriverAllowanceService.outstandingMinor(this.ds, driverId);
    const shift = open ? view(open) : null;
    const reason = !shift
      ? 'NO_OPEN_SHIFT'
      : activeOrders > 0
        ? 'HAS_ACTIVE_ORDERS'
        : null;
    return {
      onDuty: Boolean(shift),
      acceptingNewOrders: Boolean(shift) && d.is_online === true && d.accepting_new_orders !== false,
      shift,
      canEnd: { ok: reason === null, reason, activeOrders, unsettledOrders },
      allowanceOutMinor,
      longShift: Boolean(shift && shift.minutes >= LONG_SHIFT_HOURS * 60),
    };
  }

  /** Start shift: opens one (or returns the open one), on duty, taking new orders. */
  async start(userId: string): Promise<ShiftState> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    if (driver.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException({ message: 'Your account is not approved yet. Contact Hatly operations.', details: { code: 'DRIVER_NOT_APPROVED' } });
    }
    await this.openShift(driver.id);
    return this.state(driver.id);
  }

  /** Opens a shift if none is open, and puts the driver on duty (also used by the older apps' online switch). */
  async openShift(driverId: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      await m.query('SELECT id FROM drivers WHERE id = $1 FOR UPDATE', [driverId]);
      await m.query(`INSERT INTO driver_shifts (driver_id) VALUES ($1) ON CONFLICT DO NOTHING`, [driverId]);
      await m.query(
        `UPDATE drivers SET is_online = true, accepting_new_orders = true, online_changed_at = CASE WHEN is_online THEN online_changed_at ELSE now() END WHERE id = $1`,
        [driverId],
      );
      await recomputeDriverAvailability(m, [driverId]);
    });
  }

  /** End shift by the driver: refused only while an active order is with them. */
  async end(userId: string): Promise<ShiftState> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    await this.closeShift(driver.id, 'DRIVER', userId);
    return this.state(driver.id);
  }

  /** Supervisor force-end (lost phone, left without closing). Orders still with the driver stay with them — Operations reassign them. */
  async forceEnd(driverId: string, actorUserId: string): Promise<ShiftState> {
    const [open] = await this.ds.query(`SELECT id FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL`, [driverId]);
    if (!open) throw new ConflictException({ message: 'This driver has no open shift.', details: { code: 'NO_OPEN_SHIFT' } });
    await this.closeShift(driverId, 'SUPERVISOR', actorUserId);
    return this.state(driverId);
  }

  /** "Stop new orders" (false) / "take new orders again" (true), keeping the shift and the orders already carried. */
  async setAcceptingNewOrders(userId: string, accepting: boolean): Promise<ShiftState> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    await this.ds.query(`UPDATE drivers SET accepting_new_orders = $2 WHERE id = $1`, [driver.id, accepting]);
    return this.state(driver.id);
  }

  /** The driver's shifts, newest first (for the app's Previous tab and the admin). */
  async history(driverId: string, limit = 30): Promise<ShiftView[]> {
    const rows = await this.ds.query(`SELECT * FROM driver_shifts WHERE driver_id = $1 ORDER BY started_at DESC LIMIT $2`, [driverId, Math.min(Math.max(limit, 1), 200)]);
    return rows.map(view);
  }

  private async closeShift(driverId: string, by: 'DRIVER' | 'SUPERVISOR', actorUserId: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      // Assignment paths lock the driver row too. Recheck under that lock,
      // rather than trusting an earlier UI preview.
      await m.query('SELECT id FROM drivers WHERE id = $1 FOR UPDATE', [driverId]);
      const [open] = await m.query('SELECT id FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL', [driverId]);
      if (!open) throw new ConflictException({ message: 'No open shift.', details: { code: 'NO_OPEN_SHIFT' } });
      if (by === 'DRIVER') {
        const [r] = await m.query(`SELECT count(*)::int AS n FROM deliveries x JOIN orders o ON o.id = x.order_id WHERE x.driver_id = $1 AND x.deleted_at IS NULL AND ${ACTIVE_DELIVERY_CONDITION('x', 'o')}`, [driverId]);
        if (Number(r?.n ?? 0) > 0) throw new ConflictException({
          message: 'Finish or hand over active orders before ending your shift.',
          details: { code: 'SHIFT_HAS_ACTIVE_ORDERS', activeOrders: Number(r.n) },
        });
      }
      await m.query(`UPDATE driver_shifts SET ended_at = now(), ended_by = $2, ended_by_user_id = $3, updated_at = now() WHERE driver_id = $1 AND ended_at IS NULL`, [driverId, by, actorUserId]);
      await m.query(`UPDATE drivers SET is_online = false, online_changed_at = now(), accepting_new_orders = true WHERE id = $1`, [driverId]);
    });
  }

  private async activeOrders(driverId: string): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT count(*)::int AS n FROM deliveries x JOIN orders o ON o.id = x.order_id WHERE x.driver_id = $1 AND x.deleted_at IS NULL AND ${ACTIVE_DELIVERY_CONDITION('x', 'o')}`,
      [driverId],
    );
    return Number(r?.n ?? 0);
  }

  /**
   * Delivered orders not settled yet — those the next closing would settle AND those it cannot settle yet (e.g. no commission rate set):
   * informational only; not a shift-ending restriction.
   */
  private async unsettledOrders(driverId: string): Promise<number> {
    const preview = await this.settlementClosingService.courierPreview(driverId);
    return preview.lines.length + (preview.unresolved?.length ?? 0);
  }
}
