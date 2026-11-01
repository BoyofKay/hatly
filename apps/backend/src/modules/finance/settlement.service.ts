import { SettlementFrequency } from './settlement-frequency.enum';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorSettlementPeriod } from './entities/vendor-settlement-period.entity';
import { DriverSettlementPeriod } from './entities/driver-settlement-period.entity';
import { FinancialEvent } from './entities/financial-event.entity';
import { FinancialEventType } from './financial-event-type.enum';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { BusinessConfigService } from '../business-config/business-config.service';

/**
 * CONFIRMED (Phase F, decision 5 & §M): "aggregate ledger events, do
 * not recreate financial events... closing a settlement freezes its
 * contents/configuration... prevent double closing."
 *
 * Double-counting across periods is prevented BY CONSTRUCTION, not by
 * tagging individual FinancialEvent rows (which would mean mutating
 * an immutable row — never done here): each new period's
 * `periodStart` is exactly the previous CLOSED period's `periodEnd`
 * for that same vendor/driver (or, for the very first period, the
 * earliest relevant event's own timestamp). Periods are therefore
 * always contiguous, non-overlapping time ranges — the same event can
 * never fall inside two different periods.
 *
 * No scheduler exists anywhere in this codebase (confirmed in the
 * Dispatch-phase review) — periods are opened and closed on demand by
 * an Admin action, not on an automatic timer. This is the same honest,
 * buildable pattern already used for automatic-dispatch retry.
 *
 * M2 (Launch-Readiness Gap Audit, G-13). Two fixes, both additive to
 * the architecture above:
 *
 *  1. The vendor gross-sales query below now excludes CANCELLED
 *     segments — a cancelled segment was never fulfilled and already
 *     earns no `VENDOR_COMMISSION_RECOGNIZED` event (see
 *     `OrderFinancialEventsService.handlePickedUp`'s own identical
 *     `status !== CANCELLED` filter), so `totalCommissionOwedMinor`
 *     here was already correct; only the raw-segment `grossSalesMinor`
 *     query lacked the same filter, silently overstating a vendor's
 *     gross sales (and, since payable = gross sales - commission,
 *     overstating the payable too) whenever a segment was cancelled
 *     within a period.
 *
 *  2. `closeVendorPeriod`/`closeDriverPeriod` are now idempotent under
 *     a genuine concurrent race, using this codebase's own established
 *     "pre-check, then race-fallback on a unique-constraint violation"
 *     shape (see `FinancialEventService.record`'s own doc comment,
 *     which this mirrors exactly). Two concurrent closes for the SAME
 *     vendor branch / driver read the SAME `previous` row before
 *     either commits, so both compute the SAME `periodStart` — the
 *     overlap the audit flagged. A real database-level guarantee (a
 *     UNIQUE index on `(vendorBranchId, periodStart)` /
 *     `(driverId, periodStart)` — see the
 *     `SettlementPeriodConcurrencyIndex` migration) makes the second
 *     INSERT impossible rather than merely unlikely; its failure
 *     (Postgres `23505`) is caught here and the already-closed period
 *     is returned instead of a raw DB error or a duplicate/overlapping
 *     row — exactly `DriverCashRemainderService.submit`'s own pattern.
 *     A legitimate sequential close is unaffected: its `periodStart`
 *     is always the previous period's `periodEnd`, a value no earlier
 *     period for that vendor branch / driver already used.
 */
@Injectable()
export class SettlementService {
  constructor(
    @InjectRepository(VendorSettlementPeriod)
    private readonly vendorPeriodsRepository: Repository<VendorSettlementPeriod>,
    @InjectRepository(DriverSettlementPeriod)
    private readonly driverPeriodsRepository: Repository<DriverSettlementPeriod>,
    @InjectRepository(FinancialEvent) private readonly financialEventsRepository: Repository<FinancialEvent>,
    @InjectRepository(OrderVendorSegment)
    private readonly segmentsRepository: Repository<OrderVendorSegment>,
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  async closeVendorPeriod(vendorBranchId: string, closedByUserId: string): Promise<VendorSettlementPeriod> {
    const previous = await this.vendorPeriodsRepository.findOne({
      where: { vendorBranchId, status: 'CLOSED' },
      order: { periodEnd: 'DESC' },
    });
    const periodEnd = new Date();
    const periodStart = previous?.periodEnd ?? (await this.earliestVendorEventDate(vendorBranchId)) ?? periodEnd;

    if (periodStart >= periodEnd) {
      throw new BadRequestException('No new activity to settle since the last closed period.');
    }

    // The vendor's contractual term (set by Hatly per vendor) wins; without one the platform-wide setting is used exactly as before.
    const [term] = await this.vendorPeriodsRepository.manager.query(
      `SELECT t.frequency FROM vendor_settlement_terms t JOIN vendor_branches b ON b.vendor_id = t.vendor_id WHERE b.id = $1`,
      [vendorBranchId],
    );
    const frequency = (term?.frequency as SettlementFrequency | undefined) ?? (await this.businessConfigService.getVendorSettlementFrequency());

    const commissionEvents = await this.financialEventsRepository
      .createQueryBuilder('e')
      .where('e.vendor_branch_id = :vendorBranchId', { vendorBranchId })
      .andWhere('e.type = :type', { type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED })
      .andWhere('e.created_at >= :start AND e.created_at < :end', { start: periodStart, end: periodEnd })
      .getMany();
    const totalCommissionOwedMinor = commissionEvents.reduce((sum, e) => sum + (e.amountMinor ?? 0), 0);

    const segments = await this.segmentsRepository
      .createQueryBuilder('s')
      .where('s.vendor_branch_id = :vendorBranchId', { vendorBranchId })
      .andWhere('s.group_type = :groupType', { groupType: CartGroupType.CATALOG })
      // M2 (audit G-13): a cancelled segment was never fulfilled and
      // already earns no commission (see this file's own top comment)
      // — excluded here too, so it can never inflate gross sales.
      .andWhere('s.status != :cancelledStatus', { cancelledStatus: OrderVendorSegmentStatus.CANCELLED })
      .andWhere('s.created_at >= :start AND s.created_at < :end', { start: periodStart, end: periodEnd })
      .getMany();
    const grossSalesMinor = segments.reduce((sum, s) => sum + (s.subtotalMinor ?? 0), 0);

    // M2 (audit G-13): pre-check, mirroring FinancialEventService.record — a
    // period for this exact (vendorBranchId, periodStart) may already exist
    // if an earlier concurrent call already won the race below.
    const alreadyClosed = await this.vendorPeriodsRepository.findOne({ where: { vendorBranchId, periodStart } });
    if (alreadyClosed) {
      return alreadyClosed;
    }

    try {
      return await this.vendorPeriodsRepository.save(
        this.vendorPeriodsRepository.create({
          vendorBranchId,
          frequency,
          periodStart,
          periodEnd,
          status: 'CLOSED',
          grossSalesMinor,
          totalCommissionOwedMinor,
          closedAt: periodEnd,
          closedByUserId,
        }),
      );
    } catch (error: any) {
      // Race-fallback: a concurrent call for this same vendor branch committed
      // first and won the `idx_vendor_settlement_periods_branch_start_unique`
      // constraint — return ITS period rather than a raw DB error or a
      // duplicate/overlapping row (see this file's own top comment).
      if (error?.code === '23505') {
        const winner = await this.vendorPeriodsRepository.findOne({ where: { vendorBranchId, periodStart } });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async closeDriverPeriod(driverId: string, closedByUserId: string): Promise<DriverSettlementPeriod> {
    const previous = await this.driverPeriodsRepository.findOne({
      where: { driverId, status: 'CLOSED' },
      order: { periodEnd: 'DESC' },
    });
    const periodEnd = new Date();
    const periodStart = previous?.periodEnd ?? (await this.earliestDriverEventDate(driverId)) ?? periodEnd;

    if (periodStart >= periodEnd) {
      throw new BadRequestException('No new activity to settle since the last closed period.');
    }

    const frequency = await this.businessConfigService.getDriverSettlementFrequency();

    const events = await this.financialEventsRepository
      .createQueryBuilder('e')
      .where('e.driver_id = :driverId', { driverId })
      .andWhere('e.created_at >= :start AND e.created_at < :end', { start: periodStart, end: periodEnd })
      .getMany();

    const commissionEvents = events.filter((e) => e.type === FinancialEventType.DRIVER_COMMISSION_RECOGNIZED);
    const totalCommissionOwedMinor = commissionEvents.reduce((sum, e) => sum + (e.amountMinor ?? 0), 0);
    const totalReimbursementsOwedMinor = events
      .filter((e) => e.type === FinancialEventType.DRIVER_REIMBURSEMENT_OWED)
      .reduce((sum, e) => sum + (e.amountMinor ?? 0), 0);
    // Reads the full pre-commission earning directly from each
    // commission event's own rateSnapshot.baseAmountMinor (stored at
    // recognition time — see OrderFinancialEventsService) rather than
    // back-calculating from (commissionMinor, rate), which breaks at
    // an exact 0% rate.
    const totalEarningsMinor = commissionEvents.reduce((sum, e) => {
      const base = (e.rateSnapshot as { baseAmountMinor?: number } | null)?.baseAmountMinor;
      return sum + (base ?? 0);
    }, 0);

    const netPayableMinor = totalEarningsMinor - totalCommissionOwedMinor + totalReimbursementsOwedMinor;

    // M2 (audit G-13): same pre-check/race-fallback shape as closeVendorPeriod above.
    const alreadyClosed = await this.driverPeriodsRepository.findOne({ where: { driverId, periodStart } });
    if (alreadyClosed) {
      return alreadyClosed;
    }

    try {
      return await this.driverPeriodsRepository.save(
        this.driverPeriodsRepository.create({
          driverId,
          frequency,
          periodStart,
          periodEnd,
          status: 'CLOSED',
          totalEarningsMinor,
          totalCommissionOwedMinor,
          totalReimbursementsOwedMinor,
          netPayableMinor,
          closedAt: periodEnd,
          closedByUserId,
        }),
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        const winner = await this.driverPeriodsRepository.findOne({ where: { driverId, periodStart } });
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async earliestVendorEventDate(vendorBranchId: string): Promise<Date | null> {
    const first = await this.financialEventsRepository.findOne({
      where: { vendorBranchId },
      order: { createdAt: 'ASC' },
    });
    return first?.createdAt ?? null;
  }

  private async earliestDriverEventDate(driverId: string): Promise<Date | null> {
    const first = await this.financialEventsRepository.findOne({
      where: { driverId },
      order: { createdAt: 'ASC' },
    });
    return first?.createdAt ?? null;
  }
}
