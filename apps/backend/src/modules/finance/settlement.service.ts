import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorSettlementPeriod } from './entities/vendor-settlement-period.entity';
import { DriverSettlementPeriod } from './entities/driver-settlement-period.entity';
import { FinancialEvent } from './entities/financial-event.entity';
import { FinancialEventType } from './financial-event-type.enum';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
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

    const frequency = await this.businessConfigService.getVendorSettlementFrequency();

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
      .andWhere('s.created_at >= :start AND s.created_at < :end', { start: periodStart, end: periodEnd })
      .getMany();
    const grossSalesMinor = segments.reduce((sum, s) => sum + (s.subtotalMinor ?? 0), 0);

    return this.vendorPeriodsRepository.save(
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

    return this.driverPeriodsRepository.save(
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
